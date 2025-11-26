const { app, BrowserWindow, dialog, ipcMain, Menu, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const contextMenu = require('electron-context-menu');

let recentFiles = [];
let recentFilesPath = null;

const RECENT_MAX = 10;

// Track per-window state
const windowState = new Map();

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Threadboard Markdown Ultra-Lite',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Initialize per-window state
  windowState.set(win.id, {
    filePath: null,
    fileWatcher: null,
    changeDebounce: null,
  });

  win.loadFile('index.html');

  contextMenu({
    window: win,
    showSelectAll: true,
    showCopyImage: false,
  });

  win.on('closed', () => {
    const state = windowState.get(win.id);
    if (state && state.fileWatcher) {
      state.fileWatcher.close();
    }
    windowState.delete(win.id);
  });

  return win;
}

function getWindowState(win) {
  if (!win) return null;
  return windowState.get(win.id);
}

function clearWatcher(win) {
  const state = getWindowState(win);
  if (state && state.fileWatcher) {
    state.fileWatcher.close();
    state.fileWatcher = null;
  }
}

function notifyRenderer(win, channel, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function setupWatcher(win, filePath) {
  clearWatcher(win);
  const state = getWindowState(win);
  if (!filePath || !state) return;

  try {
    state.fileWatcher = fs.watch(filePath, { persistent: true }, (eventType) => {
      if (state.changeDebounce) {
        clearTimeout(state.changeDebounce);
      }
      state.changeDebounce = setTimeout(() => {
        notifyRenderer(win, 'file-changed', { eventType });
        if (eventType === 'rename') {
          // Re-establish the watcher after a short delay in case the file was replaced.
          setTimeout(() => setupWatcher(win, filePath), 200);
        }
      }, 60);
    });

    state.fileWatcher.on('error', (error) => {
      notifyRenderer(win, 'file-watch-error', error.message);
    });
  } catch (error) {
    notifyRenderer(win, 'file-watch-error', error.message);
  }
}

function setCurrentFile(win, filePath) {
  const state = getWindowState(win);
  if (state) {
    state.filePath = filePath || null;
  }
  setupWatcher(win, filePath);
  notifyRenderer(win, 'file-selected', filePath);
}

function getCurrentFilePath(win) {
  const state = getWindowState(win);
  return state ? state.filePath : null;
}

async function readFileContent(win, filePath) {
  const targetPath = filePath || getCurrentFilePath(win);
  if (!targetPath) {
    throw new Error('No file selected');
  }
  return fs.promises.readFile(targetPath, 'utf8');
}

function getMenuTemplate() {
  const isMac = process.platform === 'darwin';

  const openRecentSubmenu = recentFiles.length
    ? [
        ...recentFiles.map((filePath) => ({
          label: path.basename(filePath) || filePath,
          toolTip: filePath,
          click: async () => {
            await openRecentFile(filePath);
          },
        })),
        { type: 'separator' },
        {
          label: 'Clear Menu',
          click: async () => {
            await clearRecentFiles();
          },
        },
      ]
    : [{ label: 'No Recent Files', enabled: false }];

  return [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            createWindow();
          },
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) notifyRenderer(win, 'menu-open-file');
          },
        },
        {
          label: 'Open Recent',
          submenu: openRecentSubmenu,
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(getMenuTemplate()));
}

async function loadRecentFiles() {
  try {
    const raw = await fs.promises.readFile(recentFilesPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      recentFiles = parsed.filter((item) => typeof item === 'string');
    }
  } catch (error) {
    recentFiles = [];
  }
}

async function saveRecentFiles() {
  try {
    await fs.promises.writeFile(recentFilesPath, JSON.stringify(recentFiles, null, 2), 'utf8');
  } catch (error) {
    console.warn('Failed to persist recent files:', error);
  }
}

async function clearRecentFiles() {
  recentFiles = [];
  await saveRecentFiles();
  buildMenu();
}

async function touchRecentFile(filePath) {
  if (!filePath) {
    return;
  }
  const fullPath = path.resolve(filePath);
  recentFiles = [fullPath, ...recentFiles.filter((file) => file !== fullPath)];
  if (recentFiles.length > RECENT_MAX) {
    recentFiles = recentFiles.slice(0, RECENT_MAX);
  }
  if (process.platform === 'darwin') {
    app.addRecentDocument(fullPath);
  }
  await saveRecentFiles();
  buildMenu();
}

async function openRecentFile(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
  } catch (error) {
    await clearRecentFileEntry(filePath);
    dialog.showErrorBox('File Not Found', `The file could not be found:

${filePath}`);
    return;
  }

  const win = BrowserWindow.getFocusedWindow() || createWindow();

  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    await touchRecentFile(filePath);
    setCurrentFile(win, filePath);
    notifyRenderer(win, 'file-opened-direct', { filePath, content });
  } catch (error) {
    dialog.showErrorBox('Failed to open file', error.message);
  }
}

async function clearRecentFileEntry(filePath) {
  const before = recentFiles.length;
  recentFiles = recentFiles.filter((item) => item !== filePath);
  if (recentFiles.length !== before) {
    await saveRecentFiles();
    buildMenu();
  }
}

app.whenReady().then(async () => {
  recentFilesPath = path.join(app.getPath('userData'), 'recent-files.json');
  await loadRecentFiles();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('dialog:openFile', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Open Threadboard Markdown file',
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (canceled || !filePaths || filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = filePaths[0];
  let content = '';
  try {
    content = await readFileContent(win, filePath);
  } catch (error) {
    // If the file does not exist yet, create it lazily.
    await fs.promises.writeFile(filePath, '', 'utf8');
    content = '';
  }

  setCurrentFile(win, filePath);
  await touchRecentFile(filePath);
  return { canceled: false, filePath, content };
});

ipcMain.handle('dialog:createFile', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Create Threadboard Markdown file',
    defaultPath: 'threadboard.md',
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  try {
    await fs.promises.writeFile(filePath, '', { flag: 'wx', encoding: 'utf8' });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
    // File already exists; continue without overwriting.
  }

  const content = await readFileContent(win, filePath).catch(() => '');
  setCurrentFile(win, filePath);
  await touchRecentFile(filePath);
  return { canceled: false, filePath, content };
});

ipcMain.handle('file:read', async (event, maybePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  try {
    const content = await readFileContent(win, maybePath);
    return { ok: true, content };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('file:write', async (event, content, maybePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const targetPath = maybePath || getCurrentFilePath(win);
  if (!targetPath) {
    return { ok: false, error: 'No file selected' };
  }
  try {
    await fs.promises.writeFile(targetPath, content, 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('file:get-current', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return getCurrentFilePath(win);
});

ipcMain.handle('file:set-current', async (event, filePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!filePath) {
    setCurrentFile(win, null);
    return { ok: true };
  }

  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    setCurrentFile(win, filePath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('file:export-html', async (event, htmlContent) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const currentFilePath = getCurrentFilePath(win);
  const defaultName = currentFilePath
    ? `${path.parse(currentFilePath).name}.html`
    : 'threadboard-export.html';

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export to HTML',
    defaultPath: defaultName,
    filters: [
      { name: 'HTML', extensions: ['html'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (canceled || !filePath) {
    return { ok: false, canceled: true };
  }

  try {
    await fs.promises.writeFile(filePath, htmlContent, 'utf8');
    return { ok: true, filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('file:reveal', async (_event, filePath) => {
  if (!filePath) {
    return { ok: false, error: 'No file selected' };
  }

  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
  } catch (error) {
    return { ok: false, error: 'File not found on disk' };
  }

  try {
    shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('file:copy-path', (_event, filePath) => {
  if (!filePath) {
    return { ok: false, error: 'No file selected' };
  }

  try {
    clipboard.writeText(filePath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('file:save-new', async (event, content) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save as Markdown file',
    defaultPath: 'imported.md',
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  try {
    await fs.promises.writeFile(filePath, content, 'utf8');
    setCurrentFile(win, filePath);
    await touchRecentFile(filePath);
    return { canceled: false, filePath, content };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.on('quit-app', () => {
  app.quit();
});
