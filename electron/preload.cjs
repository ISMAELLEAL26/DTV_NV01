const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  printTicket: (html, options) => ipcRenderer.invoke('print-ticket', html, options),
  printLabels: (html, options) => ipcRenderer.invoke('print-labels', html, options),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('app-update-status', handler);
    return () => ipcRenderer.removeListener('app-update-status', handler);
  },
  isElectron: true,
});
