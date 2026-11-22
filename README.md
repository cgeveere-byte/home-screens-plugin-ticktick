# TickTick — Home Screens Plugin

Displays TickTick tasks in list, kanban, agenda, or timeline view.

## Features
- List / Kanban / Agenda / Timeline views
- Tag filtering (OR, AND, NOT)
- Priority-colored checkboxes
- Multi-project timeline with color coding
- Live red time bar on timeline (fixed window, no manual scroll)
- Last synced timestamp

## Setup
1. Get an API token from TickTick: Avatar → Settings → Account → API Token
2. In Home Screens, add the module and paste the token into Secrets
3. Set a Project ID or use Project IDs for timeline multi-list

## Build
```bash
npm install
npm run build
```

Copy `manifest.json` and `dist/bundle.js` to your plugins folder.
