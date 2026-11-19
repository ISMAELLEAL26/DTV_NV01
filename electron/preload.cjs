const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  printTicket: (html, options) => ipcRenderer.invoke('print-ticket', html, options),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  isElectron: true,
});
