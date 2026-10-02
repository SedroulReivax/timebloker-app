const { contextBridge, ipcRenderer } = require('electron');

// Expose safe native Windows APIs to the React renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  sendNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  onPomodoroTick: (callback) => ipcRenderer.on('pomodoro-tick', (event, data) => callback(data)),
});
