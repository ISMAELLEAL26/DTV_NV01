const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');

const isDev = !app.isPackaged;
let mainWindow = null;
let updateDownloaded = false;

function sendUpdateStatus(status, details = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('app-update-status', { status, ...details });
}

function configureAutoUpdater() {
  if (isDev || process.platform !== 'win32') return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', (info) => sendUpdateStatus('available', { version: info.version }));
  autoUpdater.on('download-progress', (progress) => sendUpdateStatus('downloading', { percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    sendUpdateStatus('downloaded', { version: info.version });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => undefined);
  }, 3000);
}

function getAssetPath(fileName) {
  const appRoot = isDev ? path.join(__dirname, '..') : app.getAppPath();
  return path.join(appRoot, 'dist', fileName);
}

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

  ipcMain.handle('install-update', () => {
    if (!updateDownloaded) return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  });

  ipcMain.handle('print-ticket', async (_event, html, options = {}) => {
    if (typeof html !== 'string' || !html.trim()) throw new Error('El contenido del ticket está vacío.');
    await printHiddenHtml(html, options, false);
  });

  ipcMain.handle('print-labels', async (_event, html, options = {}) => {
    if (typeof html !== 'string' || !html.trim()) throw new Error('El contenido de las etiquetas está vacío.');
    await printHiddenHtml(html, options, true);
  });
}

async function printHiddenHtml(html, options, waitForImages) {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const printableHtml = waitForImages ? html.replace(/<script[\s\S]*?<\/script>/gi, '') : html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const url = `data:text/html;charset=UTF-8,${encodeURIComponent(printableHtml)}`;

  try {
    await new Promise((resolve, reject) => {
      printWindow.webContents.once('did-finish-load', resolve);
      printWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => reject(new Error(`${errorCode}: ${errorDescription}`)));
      printWindow.loadURL(url);
    });

    if (waitForImages) {
      await printWindow.webContents.executeJavaScript(`Promise.all(Array.from(document.images).map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); })))`);
    }
    await new Promise((resolve) => setTimeout(resolve, waitForImages ? 250 : 300));

    await new Promise((resolve, reject) => {
      const printOptions = {
        silent: true,
        printBackground: true,
        ...(waitForImages ? { margins: { marginType: 'none' } } : {}),
      };
      const printerName = typeof options?.printerName === 'string' ? options.printerName.trim() : '';
      if (printerName) printOptions.deviceName = printerName;
      printWindow.webContents.print(printOptions, (success, failureReason) => {
        if (success) resolve();
        else reject(new Error(failureReason || 'No se pudo enviar el trabajo a la impresora.'));
      });
    });
  } finally {
    if (!printWindow.isDestroyed()) printWindow.close();
  }
}

function getIndexHtmlPath() {
  return getAssetPath('index.html');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: getAssetPath('app-icon.png'),
    menu: null,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenu(null);
  mainWindow.removeMenu();
  mainWindow.setAutoHideMenuBar(true);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setMenu(null);
    mainWindow.setMenuBarVisibility(false);
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(getIndexHtmlPath());

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  createMainWindow();
  configureAutoUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
