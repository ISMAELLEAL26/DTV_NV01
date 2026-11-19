const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const isDev = !app.isPackaged;
let mainWindow = null;

function getBaseUrl() {
  if (isDev) {
    return process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  }
  return `file://${path.join(__dirname, '..', 'dist', 'index.html')}`;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    fullscreen: true,
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadURL(getBaseUrl());
}

async function printHtmlSilently(html, options = {}) {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true },
  });

  try {
    await printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((resolve) => setTimeout(resolve, 400));

    const printers = await printWindow.webContents.getPrintersAsync();
    const requested = options.printerName ? printers.find((p) => p.name === options.printerName) : null;
    const defaultPrinter = requested || printers.find((p) => p.isDefault) || printers[0];

    const printOpts = {
      silent: true,
      printBackground: false,
      margins: { marginType: 'none' },
      deviceName: defaultPrinter ? defaultPrinter.name : undefined,
    };

    await new Promise((resolve, reject) => {
      printWindow.webContents.print(printOpts, (success, error) => {
        if (success) resolve();
        else reject(error || new Error('Error de impresión'));
      });
    });
  } finally {
    printWindow.destroy();
  }
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: http://localhost:* http://127.0.0.1:* ws://localhost:* wss:.*",
        ],
      },
    });
  });

  ipcMain.handle('print-ticket', (_event, html, options) => printHtmlSilently(html, options));
  ipcMain.handle('get-printers', async () => {
    if (!mainWindow) return [];
    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map((p) => ({ name: p.name, isDefault: p.isDefault, displayName: p.displayName }));
  });
  ipcMain.handle('get-app-version', () => app.getVersion());

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
