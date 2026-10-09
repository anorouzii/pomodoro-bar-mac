const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pomodoro', {
  getState: () => ipcRenderer.invoke('state'),
  onState: (fn) => ipcRenderer.on('state', (_e, state) => fn(state)),
  onShown: (fn) => ipcRenderer.on('shown', (_e, state) => fn(state)),
  send: (action, arg) => ipcRenderer.send('action', action, arg),
});
