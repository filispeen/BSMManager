# BSMManager

Electron wrapper for BeatSaver that downloads maps and playlists directly into
your Beat Saber CustomLevels folder.

## Features

- Prompts for the Beat Saber root folder on first launch and saves it to config
- Intercepts map downloads, extracts ZIPs, and deletes archives
- Auto-imports `.bplist` playlists and downloads maps by hash
- "Installed" panel that lists local maps and supports delete
- Progress indicator in the window and taskbar

## Requirements

- Windows
- Beat Saber installed
- Node.js (for development)

## Development

```bash
npm install
npm start
```

## Build

```bash
npm run build
```

`npm run pack` creates a directory build without an installer.