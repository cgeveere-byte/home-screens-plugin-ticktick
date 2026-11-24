# TickTick — Home Screens Plugin

Displays TickTick tasks in list, kanban, agenda, or timeline view.

## Features
- List / Kanban / Agenda / Timeline views
- Tag filtering (OR, AND, NOT)
- Priority-colored checkboxes
- Multi-project timeline with color coding
- Live current time bar on timeline
- Last synced timestamp
- Full Home Screens Style panel support (including frosted glass / backdrop blur via hostFrameStyle)

## Setup
1. Get an API token from TickTick: Avatar → Settings → Account → API Token
2. In Home Screens, add the module and paste the token into Secrets
3. Set a Project ID or use Project IDs for timeline multi-list

## Style / Frosted Glass
The module fully implements the host Style panel using `hostFrameStyle`.
- Use the Style panel (select the module) to set **Backdrop blur**, opacity, background color, border, shadow, font, etc.
- Opacity is automatically baked into the background alpha when blur is active so the frosted glass effect renders correctly.

## Build
```bash
npm install
npm run build
```

Copy `manifest.json` and `dist/bundle.js` to your plugins folder on the Pi, then restart the home-screens service (and chown if needed).
