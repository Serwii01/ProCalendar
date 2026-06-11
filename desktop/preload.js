const { contextBridge, shell, ipcRenderer } = require('electron');

// Puerto real del backend (lo inyecta main.js vía additionalArguments).
let apiPort = 8080;
for (const arg of process.argv) {
  const m = /^--procal-port=(\d+)$/.exec(arg);
  if (m) { apiPort = Number(m[1]); break; }
}

contextBridge.exposeInMainWorld('appInfo', { version: '1.0.0', apiPort: apiPort });

contextBridge.exposeInMainWorld('electronAPI', {
  /** Open an external URL in the system browser (used for OAuth flows). */
  openExternal: (url) => shell.openExternal(url),
});
