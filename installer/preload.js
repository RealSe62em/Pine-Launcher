const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installerAPI', {
  getState: () => ipcRenderer.invoke('get-state'),
  install: (dir) => ipcRenderer.invoke('install', dir),
  uninstall: () => ipcRenderer.invoke('uninstall'),
  launchInstalled: () => ipcRenderer.invoke('launch-installed'),
  openPath: (dir) => ipcRenderer.invoke('open-path', dir),
  chooseDir: () => ipcRenderer.invoke('choose-dir'),
  closeWindow: () => ipcRenderer.invoke('win-close'),
  onProgress: (cb) => ipcRenderer.on('install-progress', (_, v) => cb(v)),
});
