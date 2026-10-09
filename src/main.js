const {
  app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage,
  screen, systemPreferences, powerSaveBlocker,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');

const CYCLE = 4;            // focus sessions before a long break
const MIN_PARTIAL = 30_000; // interrupted focus shorter than this isn't logged
const PHASE_TITLES = { focus: 'Focus', short: 'Short Break', long: 'Long Break' };
const DURATIONS = { focus: [15, 20, 25, 30, 45, 50, 60], short: [3, 5, 10], long: [10, 15, 20, 30] };
const WIDTH = 280;

const asset = (name) => path.join(__dirname, '..', 'assets', name);

let tray, win, quitting = false, lastHide = 0, trayIcon = '';

// ---------- Data ----------

let storePath;
let data = { tasks: [], sessions: [], selectedTaskId: null, settings: { focus: 25, short: 5, long: 15 } };

function load() {
  storePath = process.env.POMODORO_DATA || path.join(app.getPath('userData'), 'data.json');
  try {
    const saved = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    data = { ...data, ...saved, settings: { ...data.settings, ...saved.settings } };
  } catch (err) {
    // Keep an unreadable file aside instead of overwriting it on the next save.
    if (err.code !== 'ENOENT') try { fs.renameSync(storePath, `${storePath}.corrupt-${Date.now()}`); } catch {}
  }
}

function save() {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(`${storePath}.tmp`, JSON.stringify(data));
  fs.renameSync(`${storePath}.tmp`, storePath);
}

// ---------- Timer ----------

const t = {
  phase: 'focus',
  cycle: 0,          // focus sessions completed toward the long break
  running: false,
  endsAt: 0,         // ms timestamp, while running
  pausedLeft: null,  // ms left, while paused
  length: null,      // ms, fixed once a phase starts so settings changes don't skew it
  segStart: null,    // when focus time started counting toward the selected task
  segBase: 0,        // phase elapsed ms at segStart
  ticker: null,
  blocker: null,
};

const phaseLength = () => t.length ?? data.settings[t.phase] * 60_000;
const remaining = () => (t.running ? Math.max(0, t.endsAt - Date.now()) : t.pausedLeft ?? phaseLength());
const elapsed = () => phaseLength() - remaining();
const isIdle = () => !t.running && t.pausedLeft === null;
const clock = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

function start() {
  if (t.running) return;
  t.length ??= phaseLength();
  const left = t.pausedLeft ?? t.length;
  if (t.phase === 'focus' && t.segStart === null) {
    t.segStart = Date.now();
    t.segBase = t.length - left;
  }
  t.endsAt = Date.now() + left;
  t.pausedLeft = null;
  t.running = true;
  t.ticker = setInterval(tick, 250);
  // Keep macOS App Nap from delaying the menu bar countdown.
  t.blocker = powerSaveBlocker.start('prevent-app-suspension');
  update();
}

function halt() {
  clearInterval(t.ticker);
  if (t.blocker !== null) powerSaveBlocker.stop(t.blocker);
  t.ticker = t.blocker = null;
  t.running = false;
}

function pause() {
  if (!t.running) return;
  t.pausedLeft = remaining();
  halt();
  update();
}

// Back to the beginning of the current phase.
function clear() {
  halt();
  Object.assign(t, { pausedLeft: null, length: null, segStart: null, segBase: 0 });
}

function reset() {
  if (isIdle()) {
    t.phase = 'focus';
    t.cycle = 0;
  } else {
    logFocus(false);
    clear();
  }
  update();
}

function skip() {
  logFocus(false);
  clear();
  if (t.phase === 'long') t.cycle = 0;
  t.phase = t.phase === 'focus' ? 'short' : 'focus';
  update();
}

function complete() {
  const finished = t.phase;
  if (finished === 'focus') {
    logFocus(true, t.endsAt);
    t.cycle += 1;
  } else if (finished === 'long') {
    t.cycle = 0;
  }
  clear();
  t.phase = finished !== 'focus' ? 'focus' : t.cycle >= CYCLE ? 'long' : 'short';
  if (finished === 'focus') announce('Focus complete', `Time for a ${t.phase === 'long' ? 'long' : 'short'} break.`);
  else announce('Break over', 'Ready to focus?');
  update();
}

function tick() {
  if (Date.now() >= t.endsAt) complete();
  else if (clock(Math.ceil(remaining() / 1000)) !== tray.getTitle()) update();
}

// Record focus time spent on the selected task since the current segment began.
function logFocus(completed, end = Date.now()) {
  if (t.phase !== 'focus' || t.segStart === null) return;
  const ms = elapsed() - t.segBase;
  if (!completed && ms < MIN_PARTIAL) return;
  const task = data.tasks.find((x) => x.id === data.selectedTaskId);
  data.sessions.push({
    taskId: task?.id ?? null,
    title: task?.title ?? 'No Task',
    start: t.segStart,
    end,
    seconds: Math.round(ms / 1000),
    completed,
  });
  save();
}

function announce(title, body) {
  execFile('/usr/bin/afplay', ['/System/Library/Sounds/Glass.aiff'], () => {});
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: true });
  n.on('click', showWindow);
  n.show();
}

// ---------- Tasks ----------

function select(id) {
  if (id === data.selectedTaskId) return;
  // Switching mid-focus: credit the time so far to the previous task.
  if (t.phase === 'focus' && t.segStart !== null) {
    logFocus(false);
    t.segStart = Date.now();
    t.segBase = elapsed();
  }
  data.selectedTaskId = id;
  save();
  update();
}

function addTask(title) {
  title = String(title ?? '').trim().slice(0, 200);
  if (!title) return;
  const task = { id: randomUUID(), title };
  data.tasks.push(task);
  save();
  if (!data.selectedTaskId) select(task.id);
  else update();
}

function deleteTask(id) {
  if (data.selectedTaskId === id) select(null);
  data.tasks = data.tasks.filter((x) => x.id !== id);
  save();
  update();
}

// ---------- Report ----------

function dayStart(offset = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.getTime();
}

function summarize(sessions, from, to = Infinity) {
  const list = sessions.filter((s) => s.end >= from && s.end < to);
  const byTask = new Map();
  for (const s of list) {
    const row = byTask.get(s.taskId) ?? {
      title: data.tasks.find((x) => x.id === s.taskId)?.title ?? s.title,
      seconds: 0,
    };
    row.seconds += s.seconds;
    byTask.set(s.taskId, row);
  }
  return {
    seconds: list.reduce((n, s) => n + s.seconds, 0),
    pomodoros: list.filter((s) => s.completed).length,
    tasks: [...byTask.values()].sort((a, b) => b.seconds - a.seconds),
  };
}

function viewState() {
  // Include the focus segment in progress so totals move live.
  const live = t.phase === 'focus' && t.segStart !== null
    ? { taskId: data.selectedTaskId, title: '', end: Date.now(), seconds: (elapsed() - t.segBase) / 1000, completed: false }
    : null;
  const sessions = live ? [...data.sessions, live] : data.sessions;
  const today = dayStart();
  return {
    phase: t.phase,
    phaseTitle: PHASE_TITLES[t.phase],
    cycle: t.cycle,
    cycleLength: CYCLE,
    running: t.running,
    canReset: !isIdle() || t.phase !== 'focus' || t.cycle > 0,
    clock: clock(Math.ceil(remaining() / 1000)),
    progress: elapsed() / phaseLength(),
    selectedTaskId: data.selectedTaskId,
    tasks: data.tasks.map((task) => ({
      ...task,
      today: sessions.filter((s) => s.taskId === task.id && s.end >= today).reduce((n, s) => n + s.seconds, 0),
    })),
    today: summarize(sessions, today),
    week: {
      ...summarize(sessions, dayStart(-6)),
      days: [-6, -5, -4, -3, -2, -1, 0].map((o) => ({
        date: dayStart(o),
        seconds: summarize(sessions, dayStart(o), dayStart(o + 1)).seconds,
      })),
    },
    accent: `#${systemPreferences.getAccentColor().slice(0, 6)}`,
  };
}

// ---------- Menu bar + window ----------

function update() {
  const icon = !isIdle() && !t.running ? 'trayPause' : t.phase === 'focus' ? 'tray' : 'trayBreak';
  if (icon !== trayIcon) {
    tray.setImage(nativeImage.createFromPath(asset(`${icon}Template.png`)));
    trayIcon = icon;
  }
  tray.setTitle(isIdle() ? '' : clock(Math.ceil(remaining() / 1000)), { fontType: 'monospacedDigit' });
  if (win?.isVisible()) win.webContents.send('state', viewState());
}

function createWindow() {
  win = new BrowserWindow({
    width: WIDTH,
    height: 360,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    vibrancy: 'popover',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('blur', hideWindow);
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    hideWindow();
  });
}

function showWindow() {
  const tb = tray.getBounds();
  const area = screen.getDisplayMatching(tb).workArea;
  const { width } = win.getBounds();
  const x = Math.min(Math.max(tb.x + tb.width / 2 - width / 2, area.x + 6), area.x + area.width - width - 6);
  win.setPosition(Math.round(x), area.y + 5);
  win.webContents.send('shown', viewState());
  win.show();
}

function hideWindow() {
  if (!win.isVisible()) return;
  win.hide();
  lastHide = Date.now();
}

function toggleWindow() {
  // A tray click first blurs (and hides) an open window; don't immediately reopen it.
  if (win.isVisible()) hideWindow();
  else if (Date.now() - lastHide > 250) showWindow();
}

function settingsMenu() {
  const durations = (key, label) => ({
    label,
    submenu: DURATIONS[key].map((m) => ({
      label: `${m} min`,
      type: 'radio',
      checked: data.settings[key] === m,
      click: () => { data.settings[key] = m; save(); update(); },
    })),
  });
  return Menu.buildFromTemplate([
    durations('focus', 'Focus'),
    durations('short', 'Short Break'),
    durations('long', 'Long Break'),
    { type: 'separator' },
    {
      label: 'Open at Login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: 'Quit Pomodoro', accelerator: 'Command+Q', click: () => app.quit() },
  ]);
}

const actions = {
  toggle: () => (t.running ? pause() : start()),
  reset,
  skip,
  select: (id) => select(typeof id === 'string' ? id : null),
  addTask,
  deleteTask,
  hide: hideWindow,
  resize: (height) => {
    const b = win.getBounds();
    if (Number.isFinite(height) && height > 0 && height !== b.height) win.setBounds({ ...b, height: Math.round(height) });
  },
  settings: ({ x, y } = {}) => settingsMenu().popup({ window: win, x, y }),
  taskMenu: (id) => Menu.buildFromTemplate([
    { label: 'Delete Task', click: () => deleteTask(id) },
  ]).popup({ window: win }),
};

// ---------- App ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => win && showWindow());
  app.on('before-quit', () => {
    quitting = true;
    logFocus(false);
  });

  app.whenReady().then(() => {
    app.dock?.hide();
    load();

    ipcMain.handle('state', () => viewState());
    ipcMain.on('action', (_e, name, arg) => {
      if (Object.hasOwn(actions, name)) actions[name](arg);
    });

    tray = new Tray(nativeImage.createEmpty());
    tray.setToolTip('Pomodoro');
    tray.on('click', toggleWindow);
    tray.on('right-click', () => tray.popUpContextMenu(settingsMenu()));
    createWindow();
    update();

    systemPreferences.subscribeNotification('AppleColorPreferencesChangedNotification', update);
  });
}
