const { contextBridge, shell, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appInfo', { version: '0.2.0' });

contextBridge.exposeInMainWorld('electronAPI', {
  /** Open an external URL in the system browser (used for OAuth flows). */
  openExternal: (url) => shell.openExternal(url),
});
