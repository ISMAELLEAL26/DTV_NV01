const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const isDev = !app.isPackaged;
let mainWindow = null;

function registerIpcHandlers() {
  ipcMain.handle('get-printers', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return [];

    const printers = await mainWindow.webContents.getPrintersAsync();
    return printers.map((printer) => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      isDefault: printer.isDefault,
    }));
  });

  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('print-ticket', async (_event, html, options = {}) => {
    if (typeof html !== 'string' || !html.trim()) {
      throw new Error('El contenido del ticket está vacío.');
    }

    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const printableHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    const url = `data:text/html;charset=UTF-8,${encodeURIComponent(printableHtml)}`;

    try {
      await new Promise((resolve, reject) => {
        printWindow.webContents.once('did-finish-load', resolve);
        printWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
          reject(new Error(`${errorCode}: ${errorDescription}`));
        });
        printWindow.loadURL(url);
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      await new Promise((resolve, reject) => {
        const printOptions = {
          silent: true,
          printBackground: true,
        };
        const printerName = typeof options?.printerName === 'string' ? options.printerName.trim() : '';
        if (printerName) printOptions.deviceName = printerName;

        printWindow.webContents.print(printOptions, (success, failureReason) => {
          if (success) resolve();
          else reject(new Error(failureReason || 'No se pudo enviar el ticket a la impresora.'));
        });
      });
    } finally {
      if (!printWindow.isDestroyed()) printWindow.close();
    }
  });
}

function getIndexHtmlPath() {
  if (isDev) {
    return path.join(__dirname, '..', 'dist', 'index.html');
  }
  return path.join(app.getAppPath(), 'dist', 'index.html');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(getIndexHtmlPath());
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
