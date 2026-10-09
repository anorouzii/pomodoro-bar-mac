# Pomodoro

A dead-minimal Pomodoro timer for the macOS menu bar, built with Electron.

- Click the menu bar icon to open it. Press **Space** to start or pause, **Esc** to close.
- Add tasks and click one to make it current. Focus time goes to the current task. If you switch tasks mid-session, the time is split between them.
- The chart button opens the report: today or the last 7 days, broken down by task.
- The `•••` button (or right-clicking the menu bar icon) holds the durations, Open at Login, and Quit.

Focus 25 min → short break 5 min. Every 4th break is a long break (15 min). A focus session you stop early is logged if it ran at least 30 seconds.

Data is stored in `~/Library/Application Support/Pomodoro/data.json`.

## Develop

```bash
npm install
npm start
```

## Build

```bash
npm run package
```

This builds `dist/Pomodoro-darwin-arm64/Pomodoro.app`. Drag it to `/Applications`.

`npm run icons` regenerates the SF Symbol assets and the app icon (requires Xcode).
