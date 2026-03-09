const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;
let mainWindow = null;
let updateDownloaded = false;
let updaterConfigured = false;
let updaterInitialized = false;
let currentUpdaterState = {
  canInstall: false,
  configured: false,
  message: isDev ? 'Auto-updates run from installed builds, not from dev mode.' : 'Updater idle.',
  status: isDev ? 'dev-mode' : 'up-to-date',
  version: app.getVersion(),
};

function isSameVersion(a, b) {
  return String(a ?? '').trim() === String(b ?? '').trim();
}

function sendUpdaterStatus(payload) {
  currentUpdaterState = {
    ...currentUpdaterState,
    canInstall: updateDownloaded,
    configured: updaterConfigured,
    ...payload,
  };

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('updater:status', currentUpdaterState);
}

function configureAutoUpdates() {
  if (updaterInitialized) {
    sendUpdaterStatus(currentUpdaterState);
    return;
  }

  updaterInitialized = true;

  if (isDev) {
    sendUpdaterStatus({
      message: 'Auto-updates run from installed builds, not from dev mode.',
      status: 'dev-mode',
    });
    return;
  }

  updaterConfigured = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendUpdaterStatus({
      message: 'Checking GitHub Releases for a newer build.',
      status: 'checking',
    });
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdaterStatus({
      message: `Update ${info.version} is available. Downloading now.`,
      status: 'available',
      version: info.version,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    sendUpdaterStatus({
      message: `You are up to date on ${info.version ?? app.getVersion()}.`,
      status: 'up-to-date',
      version: info.version ?? app.getVersion(),
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdaterStatus({
      message: `Downloading update: ${Math.round(progress.percent)}%.`,
      percent: progress.percent,
      status: 'downloading',
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    sendUpdaterStatus({
      message: `Update ${info.version} is ready. Restart to install it.`,
      status: 'downloaded',
      version: info.version,
    });
  });

  autoUpdater.on('error', (error) => {
    const message = error == null ? 'Unknown updater error.' : error.message;
    sendUpdaterStatus({
      message,
      status: 'error',
    });
  });

  autoUpdater
    .checkForUpdates()
    .then((result) => {
      const latestVersion = result?.updateInfo?.version ?? app.getVersion();
      if (isSameVersion(latestVersion, app.getVersion())) {
        sendUpdaterStatus({
          message: `You are up to date on ${latestVersion}.`,
          status: 'up-to-date',
          version: latestVersion,
        });
      }
    })
    .catch((error) => {
      updaterConfigured = false;
      sendUpdaterStatus({
        message: error.message,
        status: 'not-configured',
      });
    });

  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 1000 * 60 * 30);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1660,
    height: 980,
    minWidth: 1320,
    minHeight: 820,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f5f0e4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    window.loadURL('http://127.0.0.1:5180');
    window.webContents.openDevTools({ mode: 'detach' });
    window.webContents.once('did-finish-load', () => {
      sendUpdaterStatus(currentUpdaterState);
    });
    return window;
  }

  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  window.webContents.once('did-finish-load', () => {
    sendUpdaterStatus(currentUpdaterState);
    configureAutoUpdates();
  });
  return window;
}

app.whenReady().then(() => {
  mainWindow = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

ipcMain.handle('updater:check', async () => {
  if (isDev) {
    sendUpdaterStatus({
      message: 'Auto-updates only check from packaged builds.',
      status: 'dev-mode',
    });
    return { ok: false, status: 'dev-mode', version: app.getVersion() };
  }

  try {
    updaterConfigured = true;
    updateDownloaded = false;
    const result = await autoUpdater.checkForUpdates();
    const latestVersion = result?.updateInfo?.version ?? app.getVersion();
    const status = isSameVersion(latestVersion, app.getVersion()) ? 'up-to-date' : 'available';

    sendUpdaterStatus({
      message:
        status === 'available'
          ? `Update ${latestVersion} is available. Downloading now.`
          : `You are up to date on ${latestVersion}.`,
      status,
      version: latestVersion,
    });

    return { ok: true, status, version: latestVersion };
  } catch (error) {
    updaterConfigured = false;
    const message = error instanceof Error ? error.message : 'Unable to check for updates.';
    sendUpdaterStatus({
      message,
      status: 'not-configured',
    });
    return { ok: false, status: 'not-configured', message, version: app.getVersion() };
  }
});

ipcMain.handle('updater:install', async () => {
  if (!updateDownloaded) {
    return { ok: false };
  }

  setImmediate(() => {
    autoUpdater.quitAndInstall();
  });

  return { ok: true };
});

ipcMain.handle('updater:get-state', async () => {
  return currentUpdaterState;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
