const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const os = require('node:os');
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

function formatTicketTextFor58mm(html) {
  let formatted = html;

  // Quitar etiqueta "Venta:" y dejar fecha y hora en un solo renglón (ej. 26/11/2026, 07:10:54PM)
  formatted = formatted.replace(/\bVenta\s*:\s*/gi, '');
  formatted = formatted.replace(
    /(\d{1,2}\/\d{1,2}\/\d{4}),\s*(\d{1,2}:\d{2}:\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|AM|PM)/gi,
    (_match, fecha, hora, meridiano) => {
      const [hh, mm, ss] = hora.split(':');
      const hh2 = String(hh).padStart(2, '0');
      const merClean = meridiano.replace(/[^apmap]/gi, '').toUpperCase();
      return `<span class="no-wrap-line">${fecha}, ${hh2}:${mm}:${ss}${merClean}</span>`;
    }
  );

  // Abreviar "Vendedor:" -> "UPV:" y "Folio:" -> "F:"
  formatted = formatted.replace(/\bVendedor\s*:/gi, 'UPV:');
  formatted = formatted.replace(/\bFolio\s*:/gi, 'F:');

  // Abreviar encabezado de importe a "IMPO"
  formatted = formatted.replace(/\bIMPORTE\b/gi, 'IMPO');

  // Quitar decimales ".00" en importes monetarios (ej. $100.00 -> $100)
  formatted = formatted.replace(/\$\s*(\d+)\.00\b/g, '$$$1');

  // Quitar "0" o "0 mo" suelto en etiquetas/renglones/celdas tras IMPO
  formatted = formatted.replace(/(IMPO[\s\S]{0,220}?)<([a-z0-9]+)([^>]*)>\s*0(?:\s*mo)?\s*<\/\2>/gi, '$1');
  formatted = formatted.replace(/(IMPO[\s\S]{0,220}?)(?:<br\s*\/?>|\n|\r)+\s*0(?:\s*mo)?\s*(?=(?:<br\s*\/?>|\n|\r|<\/))/gi, '$1');
  formatted = formatted.replace(
    /<(div|p|span|td|th|tr|li|strong|b|small|font)([^>]*)>\s*0(?:\s*mo)?\s*<\/\1>/gi,
    ''
  );
  formatted = formatted.replace(/(?:<br\s*\/?>|\n|\r)+[\s\u00a0]*0(?:\s*mo)?[\s\u00a0]*(?=(?:<br\s*\/?>|\n|\r|<\/|$))/gi, '');

  return formatted;
}

function prepareLabelStripHtml(html) {
  const labelStyle = `<style>
    @page { margin: 0; size: 55mm auto; }
    html, body {
      margin: 0 !important;
      padding: 0 1.5mm !important;
      width: 52mm !important;
      max-width: 52mm !important;
      box-sizing: border-box !important;
      background: #ffffff !important;
      color: #000000 !important;
      overflow-x: hidden !important;
    }
    *, *::before, *::after {
      box-sizing: border-box !important;
      max-width: 52mm !important;
      word-break: break-word !important;
    }
    .label-strip, .labels-strip, .etiqueta-tira, .label-item, .etiqueta {
      width: 52mm !important;
      max-width: 52mm !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
  </style>`;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${labelStyle}</head>`);
  }
  return `${labelStyle}${html}`;
}

function preparePrintableHtml(html, isLabel) {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  if (isLabel) return prepareLabelStripHtml(withoutScripts);

  const formattedHtml = formatTicketTextFor58mm(withoutScripts);

  const ticketResetStyle = `<style>
    @page { margin: 0; size: 58mm auto; }
    html, body {
      margin: 0 !important;
      padding: 0 2mm !important;
      width: 100% !important;
      max-width: 54mm !important;
      box-sizing: border-box !important;
      background: #ffffff !important;
      color: #000000 !important;
      overflow-x: hidden !important;
    }
    *, *::before, *::after {
      box-sizing: border-box !important;
      max-width: 100% !important;
      word-break: break-word !important;
    }
    table {
      width: 100% !important;
      table-layout: fixed !important;
      border-collapse: collapse !important;
    }
    .no-wrap-line {
      white-space: nowrap !important;
      display: inline-block !important;
      font-size: 0.9em !important;
    }
  </style>`;

  if (/<\/head>/i.test(formattedHtml)) {
    return formattedHtml.replace(/<\/head>/i, `${ticketResetStyle}</head>`);
  }
  return `${ticketResetStyle}${formattedHtml}`;
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
  const printableHtml = preparePrintableHtml(html, Boolean(waitForImages));
  const tempFile = path.join(os.tmpdir(), `pos-ticket-${Date.now()}.html`);
  fs.writeFileSync(tempFile, printableHtml, 'utf8');

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Tiempo de espera agotado al cargar el documento de impresión.')), 5000);
      printWindow.webContents.once('did-finish-load', () => {
        clearTimeout(timer);
        resolve();
      });
      printWindow.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
        clearTimeout(timer);
        reject(new Error(`${errorCode}: ${errorDescription}`));
      });
      printWindow.loadFile(tempFile);
    });

    if (waitForImages) {
      await Promise.race([
        printWindow.webContents.executeJavaScript(
          `Promise.all(Array.from(document.images).map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => { image.addEventListener('load', resolve, { once: true }); image.addEventListener('error', resolve, { once: true }); })))`
        ),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));

    await new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(printTimer);
        if (err) reject(err);
        else resolve();
      };
      const printTimer = setTimeout(() => {
        done(new Error('La impresora no confirmó la impresión a tiempo. Revisa su estado o cola.'));
      }, 8000);

      const widthMm = Number(options?.width);
      const heightMm = Number(options?.height);
      const hasCustomLabelSize =
        waitForImages &&
        Number.isFinite(widthMm) &&
        Number.isFinite(heightMm) &&
        widthMm > 0 &&
        heightMm > 0;

      const labelHeightMm =
        Number.isFinite(heightMm) && heightMm > 0 ? heightMm : 297;

      const printOptions = {
        silent: true,
        printBackground: true,
        ...(waitForImages && hasCustomLabelSize
          ? {
              pageSize: {
                width: Math.round(widthMm * 1000),
                height: Math.round(heightMm * 1000),
              },
            }
          : waitForImages
          ? {
              pageSize: {
                width: 55000,
                height: Math.round(labelHeightMm * 1000),
              },
            }
          : {
              pageSize: {
                width: 58000,
                height: 80000,
              },
            }),
      };

      const rawPrinterName = typeof options?.printerName === 'string' ? options.printerName.trim() : '';
      const cleanPrinterName = rawPrinterName.replace(/\s*\(predeterminada\)\s*$/i, '').trim();
      if (cleanPrinterName) printOptions.deviceName = cleanPrinterName;

      try {
        printWindow.webContents.print(printOptions, (success, failureReason) => {
          if (success) done();
          else done(new Error(failureReason || 'No se pudo enviar el trabajo a la impresora.'));
        });
      } catch (err) {
        done(err instanceof Error ? err : new Error('Error al invocar la impresión.'));
      }
    });
  } finally {
    if (!printWindow.isDestroyed()) printWindow.close();
    try { fs.unlinkSync(tempFile); } catch {}
  }
}

function getIndexHtmlPath() {
  return getAssetPath('index.html');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: getAssetPath(process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png'),
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
