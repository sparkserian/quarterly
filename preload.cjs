const { contextBridge, ipcRenderer } = require('electron');

const appVersion = ipcRenderer.sendSync('app:get-version-sync');

contextBridge.exposeInMainWorld('desktopMeta', {
  platform: process.platform,
  versions: {
    app: appVersion,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    getState: () => ipcRenderer.invoke('updater:get-state'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on('updater:status', listener);

      return () => {
        ipcRenderer.removeListener('updater:status', listener);
      };
    },
  },
});
