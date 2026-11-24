import React, { useEffect, useState, useRef } from 'react';
import { hostFrameStyle } from './host-style';

const { pluginFetch } = window.__HS_SDK__ || {};
const VERSION = '1.0.10';

function formatDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
}

function formatTimeOnly(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return null;
  }
}

function priorityColor(p) {
  if (p >= 5) return '#ef4444';
  if (p >= 3) return '#f59e0b';
  if (p >= 1) return '#3b82f6';
  return 'transparent';
}
const ROTATING_PALETTE = [
  '#60a5fa', // blue
  '#2dd4bf', // teal
  '#fde047', // yellow
  '#9ca3af', // gray
  '#fdba74', // peach
  '#7dd3fc', // light blue
  '#fb923c', // orange
];

function formatCountdown(iso, now) {
  if (!iso || !now) return null;
  try {
    const target = new Date(iso);
    const diffMs = target.getTime() - now.getTime();
    if (diffMs <= 0) return null;

    const diffMin = Math.max(0, Math.round(diffMs / 60000));
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    const sameDay = target.toDateString() === now.toDateString();

    if (diffMin < 60) return `${diffMin}m`;
    if (sameDay) return `${diffHours}h`;
    if (diffMs < 24 * 3600000) {
      const remHours = diffHours % 24;
      return remHours > 0 ? `${diffDays}d ${remHours}h` : `${Math.max(1, diffDays)}d`;
    }
    return `${diffDays}d`;
  } catch {
    return null;
  }
}


function getAgendaLabel(iso) {
  if (!iso) return 'No date';
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateOnly = new Date(d);
  dateOnly.setHours(0, 0, 0, 0);

  if (dateOnly.getTime() === today.getTime()) return 'Today';
  if (dateOnly.getTime() === tomorrow.getTime()) return 'Tomorrow';

  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${weekday}, ${mm}/${dd}`;
}

function formatTime(d) {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function parseTagFilter(raw) {
  if (!raw) return { or: [], and: [], not: [] };
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const or = [];
  const and = [];
  const not = [];

  parts.forEach((part) => {
    if (part.startsWith('-') || part.startsWith('!')) {
      not.push(part.slice(1).toLowerCase());
    } else if (part.includes('+') || part.includes('&')) {
      const andTags = part.split(/[+&]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
      if (andTags.length) and.push(andTags);
    } else {
      or.push(part.toLowerCase());
    }
  });

  return { or, and, not };
}

function taskMatchesFilter(task, filter) {
  const taskTags = (task.tags || []).map((t) => String(t).toLowerCase());
  if (filter.not.some((n) => taskTags.includes(n))) return false;
  if (filter.or.length > 0 && !filter.or.some((t) => taskTags.includes(t))) return false;
  for (const group of filter.and) {
    if (!group.every((t) => taskTags.includes(t))) return false;
  }
  return true;
}

function getMinutesSinceMidnight(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function isOverdue(task) {
  const due = task.dueDate || task.startDate;
  if (!due) return false;
  try {
    return new Date(due).getTime() < Date.now();
  } catch {
    return false;
  }
}

function isCompleted(task) {
  // TickTick keeps completedTime even after a task is unchecked.
  // Only status 2 (or 1) means currently completed.
  const s = Number(task && task.status);
  return s === 2 || s === 1;
}

function buildQrUrl(projectId, tagFilter, idList) {
  if (projectId && projectId.trim().toLowerCase() !== 'all' && idList.length === 0) {
    return `https://ticktick.com/#p/${encodeURIComponent(projectId.trim())}/tasks`;
  }
  if (tagFilter && tagFilter.trim()) {
    return `https://ticktick.com/#q/${encodeURIComponent(tagFilter.trim())}`;
  }
  return null;
}

export default function TickTickList({ config = {}, style = {} }) {
  const {
    projectId = '',
    title = 'Tasks',
    maxItems = 30,
    showDue = true,
    showCompleted = false,
    hideOverdue = false,
    greyOutOverdueAgenda = false,
    viewMode = 'list',
    tagFilter = '',
    showPriority = true,
    showTimes = false,
    timelineHoursVisible = 8,
    projectIds = '',
    projectColors = '',
    showQrCode = false,
    qrSize = 72,
    titleFontSize = 0,
    hourLabelFontSize = 11,
    currentTimeBadgeFontSize = 10,
    timelineGutterWidth = 0,
    useRotatingPalette = false,
    showTimelineCheckboxes = false,
  } = config;

  const [tasks, setTasks] = useState([]);
  const [columns, setColumns] = useState([]);
  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [now, setNow] = useState(new Date());
  const [timelineHeight, setTimelineHeight] = useState(0);
  const timelineRef = useRef(null);

  const tagFilterParsed = parseTagFilter(tagFilter);
  const isAllProjects = projectId.trim().toLowerCase() === 'all';
  const idList = projectIds.split(',').map((s) => s.trim()).filter(Boolean);

  const qrTarget = showQrCode ? buildQrUrl(projectId, tagFilter, idList) : null;
  const qrImageSrc = qrTarget
    ? `https://api.qrserver.com/v1/create-qr-code/?size=${Math.max(48, Math.min(160, qrSize))}x${Math.max(48, Math.min(160, qrSize))}&margin=4&data=${encodeURIComponent(qrTarget)}`
    : null;

  useEffect(() => {
    if (viewMode !== 'timeline' || !timelineRef.current) return;
    const measure = () => {
      if (timelineRef.current) setTimelineHeight(timelineRef.current.clientHeight || 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(timelineRef.current);
    return () => ro.disconnect();
  }, [viewMode]);

  const fetchTasks = async () => {
    if (!pluginFetch) return;

    if (!projectId && !tagFilter && idList.length === 0) {
      setTasks([]);
      setColumns([]);
      setProjectName('');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let allTasks = [];
      let allColumns = [];
      let name = '';

      if (viewMode === 'timeline' && idList.length > 0) {
        const body = {
          status: [0, 2],
          projectIds: idList,
        };
        const res = await pluginFetch('ticktick', {
          url: 'https://api.ticktick.com/open/v1/task/filter',
          method: 'POST',
          payload: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
          secretInjections: { header: { Authorization: 'Bearer {{api_token}}' } },
          cacheTtlMs: 30000,
        });
        if (res.status === 429) throw new Error('Rate limited (429)');
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Filter ${res.status}: ${text.slice(0, 80)}`);
        }
        allTasks = await res.json();
        name = `${idList.length} lists`;
      } else if (tagFilterParsed.or.length > 0) {
        const body = {
          status: showCompleted ? [0, 2] : [0],
          tag: tagFilterParsed.or,
        };

        const res = await pluginFetch('ticktick', {
          url: 'https://api.ticktick.com/open/v1/task/filter',
          method: 'POST',
          payload: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
          secretInjections: { header: { Authorization: 'Bearer {{api_token}}' } },
          cacheTtlMs: 30000,
        });

        if (res.status === 429) throw new Error('Rate limited (429)');
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Filter ${res.status}: ${text.slice(0, 80)}`);
        }

        allTasks = await res.json();
        name = tagFilter;
      } else if (projectId && !isAllProjects) {
        const res = await pluginFetch('ticktick', {
          url: `https://api.ticktick.com/open/v1/project/${encodeURIComponent(projectId)}/data`,
          secretInjections: { header: { Authorization: 'Bearer {{api_token}}' } },
          cacheTtlMs: 30000,
        });
        if (res.status === 429) throw new Error('Rate limited (429)');
        if (!res.ok) throw new Error(`API ${res.status}`);
        const data = await res.json();
        allTasks = data.tasks || [];
        allColumns = data.columns || [];
        name = data.project?.name || '';
      }

      if (viewMode === 'timeline') {
        try {
          const nowIso = new Date();
          const start = new Date(nowIso.getTime() - 24 * 3600000);
          const end = new Date(nowIso.getTime() + 48 * 3600000);
          const projIds = idList.length > 0
            ? idList
            : (projectId && !isAllProjects ? [projectId] : []);
          if (projIds.length > 0) {
            const cRes = await pluginFetch('ticktick', {
              url: 'https://api.ticktick.com/open/v1/task/completed',
              method: 'POST',
              payload: JSON.stringify({
                projectIds: projIds,
                startDate: start.toISOString(),
                endDate: end.toISOString(),
              }),
              headers: { 'Content-Type': 'application/json' },
              secretInjections: { header: { Authorization: 'Bearer {{api_token}}' } },
              cacheTtlMs: 30000,
            });
            if (cRes.ok) {
              const completedTasks = await cRes.json();
              const seen = new Set(allTasks.map((t) => t.id));
              (Array.isArray(completedTasks) ? completedTasks : []).forEach((ct) => {
                if (ct && ct.id && !seen.has(ct.id)) {
                  allTasks.push(ct);
                  seen.add(ct.id);
                }
              });
            }
          }
        } catch {
          // completed fetch is best-effort
        }
      }

      if (!showCompleted && viewMode !== 'timeline') {
        allTasks = allTasks.filter((t) => !isCompleted(t));
      }

      if (tagFilter && (tagFilterParsed.and.length > 0 || tagFilterParsed.not.length > 0)) {
        allTasks = allTasks.filter((t) => taskMatchesFilter(t, tagFilterParsed));
      }

      if (hideOverdue && viewMode === 'list') {
        allTasks = allTasks.filter((t) => !isOverdue(t));
      }

      allTasks.sort((a, b) => {
        const da = a.dueDate || a.startDate || '';
        const db = b.dueDate || b.startDate || '';
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da.localeCompare(db);
      });

      setTasks(allTasks.slice(0, maxItems));
      setColumns(allColumns.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
      setProjectName(name);
      setLastSynced(new Date());
    } catch (err) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 60000);
    return () => clearInterval(interval);
  }, [projectId, maxItems, showCompleted, hideOverdue, tagFilter, projectIds, viewMode]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const header = title || projectName || (isAllProjects ? 'All Tasks' : 'TickTick');

  const tasksByColumn = {};
  const unassigned = [];
  tasks.forEach((t) => {
    const cid = t.columnId || t.column_id;
    if (cid) {
      if (!tasksByColumn[cid]) tasksByColumn[cid] = [];
      tasksByColumn[cid].push(t);
    } else {
      unassigned.push(t);
    }
  });

  const agendaGroups = {};
  tasks.forEach((t) => {
    const key = getAgendaLabel(t.dueDate || t.startDate);
    if (!agendaGroups[key]) agendaGroups[key] = [];
    agendaGroups[key].push(t);
  });

  const renderTask = (t, index = 0) => {
    const due = showDue ? formatDate(t.dueDate || t.startDate) : null;
    const prio = t.priority || 0;
    const boxColor = priorityColor(prio);

    const startTime = formatTimeOnly(t.startDate);
    let timeLabel = null;

    if (viewMode === 'agenda' && showTimes) {
      const end = formatTimeOnly(t.dueDate);
      if (startTime && end && startTime !== end) timeLabel = `${startTime}–${end}`;
      else if (startTime) timeLabel = startTime;
      else if (end) timeLabel = end;
    } else if (startTime) {
      timeLabel = startTime;
    }

    const countdown = viewMode === 'agenda'
      ? formatCountdown(t.startDate || t.dueDate, now)
      : null;

    const overdue = viewMode === 'agenda' && greyOutOverdueAgenda && isOverdue(t);
    const completed = isCompleted(t);
    const paletteColor = useRotatingPalette ? ROTATING_PALETTE[index % ROTATING_PALETTE.length] : null;
    const greyTimeline = viewMode === 'timeline' && completed;

    return (
      <div
        key={t.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: '0.9em',
          lineHeight: 1.3,
          padding: '4px 6px',
          opacity: overdue || greyTimeline ? 0.45 : 1,
          color: overdue || greyTimeline ? '#9ca3af' : undefined,
          background: paletteColor ? `${paletteColor}22` : undefined,
          borderRadius: paletteColor ? 4 : undefined,
          borderLeft: paletteColor ? `3px solid ${boxColor === 'transparent' ? paletteColor : boxColor}` : undefined,
        }}
      >
        {viewMode === 'timeline' && showTimelineCheckboxes ? (
          <span
            style={{
              width: 14,
              height: 14,
              border: '1.5px solid currentColor',
              borderRadius: 3,
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              opacity: 0.8,
            }}
          >
            {completed ? '✓' : ''}
          </span>
        ) : (
          <span
            style={{
              width: 15,
              height: 15,
              border: `1.5px solid ${boxColor === 'transparent' ? 'currentColor' : boxColor}`,
              borderRadius: 3,
              opacity: overdue ? 0.5 : 0.85,
              flexShrink: 0,
              background: boxColor === 'transparent' ? 'transparent' : `${boxColor}22`,
            }}
          />
        )}
        <span style={{ flex: 1 }}>{t.title || '(untitled)'}</span>
        {countdown && (
          <span style={{ opacity: overdue ? 0.4 : 0.75, fontSize: '0.8em', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{countdown}</span>
        )}
        {timeLabel && (
          <span style={{ opacity: overdue ? 0.4 : 0.65, fontSize: '0.8em', whiteSpace: 'nowrap' }}>{timeLabel}</span>
        )}
        {due && viewMode !== 'agenda' && (
          <span style={{ opacity: 0.55, fontSize: '0.8em', whiteSpace: 'nowrap' }}>{due}</span>
        )}
      </div>
    );
  };

  const baseFont = (style && style.fontSize) || 16;
  const timelineGutter = timelineGutterWidth > 0
    ? Math.max(40, Math.min(200, timelineGutterWidth))
    : Math.max(64, Math.round(baseFont * 3.6));

  const hoursVisible = timelineHoursVisible;
  const nowMin = getMinutesSinceMidnight(now);
  const totalMin = hoursVisible * 60;
  const pxPerMin = timelineHeight > 0 ? timelineHeight / totalMin : 1.8;
  const totalHeight = timelineHeight || totalMin * pxPerMin;
  const nowTop = totalHeight / 6;
  const windowStartMin = nowMin - nowTop / pxPerMin;

  const windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);
  windowStart.setMinutes(windowStartMin);

  const windowEnd = new Date(windowStart.getTime() + totalMin * 60000);

  const timedTasks = tasks.filter((t) => {
    if (!t.startDate) return false;
    const start = new Date(t.startDate);
    return start >= windowStart && start < windowEnd;
  });

  const untimed = tasks.filter((t) => {
    if (t.startDate) return false;
    const d = t.dueDate;
    if (!d) return false;
    const taskDate = new Date(d);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const taskDay = new Date(taskDate);
    taskDay.setHours(0, 0, 0, 0);
    return taskDay.getTime() === today.getTime();
  });

  const colorList = projectColors.split(',').map((s) => s.trim()).filter(Boolean);
  const defaultPalette = ['#60a5fa', '#f59e0b', '#ef4444', '#10b981', '#a78bfa', '#ec4899'];
  const projectColorMap = {};
  idList.forEach((id, i) => {
    projectColorMap[id] = colorList[i] || defaultPalette[i % defaultPalette.length];
  });

  const titleStyle = titleFontSize > 0
    ? { fontWeight: 600, fontSize: `${titleFontSize}px`, opacity: 0.95, lineHeight: 1.2 }
    : { fontWeight: 600, fontSize: '1.15em', opacity: 0.95 };

  return (
    <div
      style={{
        ...hostFrameStyle(style),
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={titleStyle}>{header}</div>
        {qrImageSrc && (
          <img
            src={qrImageSrc}
            alt="TickTick link"
            style={{
              width: Math.max(48, Math.min(160, qrSize)),
              height: Math.max(48, Math.min(160, qrSize)),
              borderRadius: 4,
              flexShrink: 0,
              background: '#fff',
              padding: 2,
            }}
          />
        )}
      </div>

      {!projectId && !tagFilter && idList.length === 0 && (
        <div style={{ opacity: 0.7, fontSize: '0.9em' }}>Set a Project ID or Tag filter.</div>
      )}
      {error && <div style={{ color: '#f87171', fontSize: '0.9em' }}>{error}</div>}
      {loading && tasks.length === 0 && (projectId || tagFilter || idList.length > 0) && (
        <div style={{ opacity: 0.6 }}>Loading…</div>
      )}

      {viewMode === 'timeline' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {untimed.length > 0 && (
            <div style={{ marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
              <div style={{ fontSize: '0.75em', opacity: 0.6, marginBottom: 4 }}>No time</div>
              {untimed.map(renderTask)}
            </div>
          )}
          <div
            ref={timelineRef}
            style={{
              flex: 1,
              overflow: 'hidden',
              position: 'relative',
              background: 'rgba(0,0,0,0.15)',
              borderRadius: 6,
              minHeight: 0,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '100%',
              }}
            >
              {(() => {
                const lines = [];
                const firstHour = Math.ceil(windowStartMin / 60);
                const lastHour = Math.floor((windowStartMin + totalMin) / 60);
                for (let h = firstHour; h <= lastHour; h++) {
                  const top = (h * 60 - windowStartMin) * pxPerMin;
                  const hour = ((h % 24) + 24) % 24;
                  const isMidnight = hour === 0;
                  lines.push(
                    <div
                      key={h}
                      style={{
                        position: 'absolute',
                        top,
                        left: 0,
                        width: timelineGutter - 4,
                        borderTop: isMidnight
                          ? '2px solid rgba(255,255,255,0.25)'
                          : '1px solid rgba(255,255,255,0.08)',
                        paddingLeft: 4,
                        fontSize: `${Math.max(8, Math.min(24, hourLabelFontSize))}px`,
                        opacity: 0.5,
                        pointerEvents: 'none',
                        lineHeight: 1,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                      }}
                    >
                      {String(hour).padStart(2, '0')}:00
                    </div>
                  );
                }
                return lines;
              })()}

              {timedTasks.map((t) => {
                const start = new Date(t.startDate);
                const end = t.dueDate ? new Date(t.dueDate) : new Date(start.getTime() + 45 * 60000);
                const sMin = (start - windowStart) / 60000;
                const eMin = (end - windowStart) / 60000;
                const top = sMin * pxPerMin + 1;
                const rawHeight = (eMin - sMin) * pxPerMin;
                const height = Math.max(20, rawHeight - 3);
                const prio = t.priority || 0;
                const priorityCol = priorityColor(prio);
                const projectColor = projectColorMap[t.projectId] || '#60a5fa';
                const taskIndex = timedTasks.indexOf(t);
                const paletteColor = useRotatingPalette
                  ? ROTATING_PALETTE[taskIndex % ROTATING_PALETTE.length]
                  : null;
                const bgColor = paletteColor || (priorityCol !== 'transparent' ? priorityCol : projectColor);
                const leftBarColor = priorityCol !== 'transparent' ? priorityCol : (paletteColor || projectColor);
                const completed = isCompleted(t);
                const titleText = t.title || '(untitled)';
                const timeStr = `${formatTimeOnly(t.startDate)}${t.dueDate && t.dueDate !== t.startDate ? `–${formatTimeOnly(t.dueDate)}` : ''}`;
                const durationMin = Math.max(0, eMin - sMin);
                const singleLine = titleText.length <= 28 && (height < 52 || durationMin <= 30);

                return (
                  <div
                    key={t.id}
                    style={{
                      position: 'absolute',
                      top,
                      left: timelineGutter,
                      right: 8,
                      height,
                      background: completed ? 'rgba(156,163,175,0.18)' : `${bgColor}40`,
                      borderLeft: `3px solid ${completed ? '#6b7280' : leftBarColor}`,
                      border: completed ? '1px solid rgba(156,163,175,0.35)' : `1px solid ${bgColor}55`,
                      borderLeftWidth: 3,
                      borderRadius: 4,
                      padding: '2px 6px',
                      fontSize: '0.8em',
                      overflow: 'hidden',
                      boxSizing: 'border-box',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                      opacity: completed ? 0.55 : 1,
                      color: completed ? '#9ca3af' : undefined,
                      display: 'flex',
                      flexDirection: singleLine ? 'row' : 'column',
                      flexWrap: 'nowrap',
                      alignItems: singleLine ? 'center' : 'stretch',
                      justifyContent: singleLine ? 'flex-start' : undefined,
                      gap: singleLine ? 8 : 0,
                      lineHeight: 1.2,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: singleLine ? '1 1 auto' : undefined }}>
                      {showTimelineCheckboxes && (
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            border: '1.5px solid currentColor',
                            borderRadius: 2,
                            flexShrink: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 9,
                            lineHeight: 1,
                          }}
                        >
                          {completed ? '✓' : ''}
                        </span>
                      )}
                      <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: completed ? 'line-through' : undefined, minWidth: 0 }}>
                        {titleText}
                      </div>
                    </div>
                    <div style={{ opacity: 0.7, fontSize: '0.85em', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {timeStr}
                    </div>
                  </div>
                );
              })}

              <div
                style={{
                  position: 'absolute',
                  top: nowTop,
                  left: 0,
                  right: 0,
                  height: 0,
                  borderTop: '2px solid #ef4444',
                  zIndex: 10,
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 2,
                    top: -8,
                    background: '#ef4444',
                    color: 'white',
                    fontSize: `${Math.max(8, Math.min(20, currentTimeBadgeFontSize))}px`,
                    padding: '1px 4px',
                    borderRadius: 3,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatTime(now)}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : viewMode === 'kanban' && columns.length > 0 && !isAllProjects ? (
        <div style={{ flex: 1, display: 'flex', gap: 12, overflow: 'auto', paddingBottom: 4 }}>
          {columns.map((col) => (
            <div
              key={col.id}
              style={{
                minWidth: 180,
                maxWidth: 260,
                flex: '1 0 180px',
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 8,
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.85em', opacity: 0.8, marginBottom: 4 }}>
                {col.name}
              </div>
              {(tasksByColumn[col.id] || []).map(renderTask)}
              {(tasksByColumn[col.id] || []).length === 0 && (
                <div style={{ opacity: 0.4, fontSize: '0.8em' }}>Empty</div>
              )}
            </div>
          ))}
          {unassigned.length > 0 && (
            <div
              style={{
                minWidth: 180,
                maxWidth: 260,
                flex: '1 0 180px',
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 8,
                padding: '8px 10px',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.85em', opacity: 0.8, marginBottom: 4 }}>
                Unassigned
              </div>
              {unassigned.map(renderTask)}
            </div>
          )}
        </div>
      ) : viewMode === 'agenda' ? (
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Object.keys(agendaGroups).map((label) => (
            <div key={label}>
              <div style={{ fontWeight: 600, fontSize: '0.85em', opacity: 0.75, margin: '6px 0 2px' }}>
                {label}
              </div>
              {agendaGroups[label].map(renderTask)}
            </div>
          ))}
          {tasks.length === 0 && !loading && <div style={{ opacity: 0.65 }}>No open tasks</div>}
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tasks.map(renderTask)}
          {!loading && (projectId || tagFilter || idList.length > 0) && tasks.length === 0 && !error && (
            <div style={{ opacity: 0.65 }}>No open tasks</div>
          )}
        </div>
      )}

      {lastSynced && (
        <div style={{ fontSize: '10px', opacity: 0.45, textAlign: 'right', marginTop: 4 }}>
          Synced {formatTime(lastSynced)}
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          bottom: 4,
          left: 8,
          fontSize: '10px',
          opacity: 0.35,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        v{VERSION}
      </div>
    </div>
  );
}
