const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage } = require('electron');
const path = require('path');

let mainWindow = null;
let tray = null;
let isAlwaysOnTop = false;

const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:5173';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'TimeBloker',
    frame: true,
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  // Load app URL
  if (isDev) {
    mainWindow.loadURL(DEV_URL).catch(() => {
      console.log('Dev server not running at http://localhost:5173. Waiting...');
      setTimeout(() => mainWindow.loadURL(DEV_URL), 2000);
    });
  } else {
    // Production build path
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
    mainWindow.loadFile(indexPath).catch(() => {
      mainWindow.loadURL(DEV_URL);
    });
  }

  // Graceful show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Minimize to tray on close if user prefers, or quit
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Setup Windows System Tray Icon & Menu
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  // Create simple native image fallback if asset isn't ready
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch (e) {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('TimeBloker - Personal OS');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open TimeBloker',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Toggle Always on Top',
      type: 'checkbox',
      checked: isAlwaysOnTop,
      click: () => {
        isAlwaysOnTop = !isAlwaysOnTop;
        if (mainWindow) mainWindow.setAlwaysOnTop(isAlwaysOnTop);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit TimeBloker',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Native IPC Handlers
ipcMain.on('show-notification', (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show();
  }
});

ipcMain.handle('toggle-always-on-top', () => {
  if (mainWindow) {
    isAlwaysOnTop = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(isAlwaysOnTop);
    return isAlwaysOnTop;
  }
  return false;
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.hide();
});

// App Lifecycle
app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
