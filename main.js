const { app, BrowserWindow, dialog, ipcMain, Menu, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const contextMenu = require('electron-context-menu');

let mainWindow;
let currentFilePath = null;
let fileWatcher = null;
let changeDebounce = null;
let recentFiles = [];
let recentFilesPath = null;

const RECENT_MAX = 10;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Threadboard Markdown Ultra-Lite',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');

  contextMenu({
    window: mainWindow,
    showSelectAll: true,
    showCopyImage: false,
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    clearWatcher();
  });
}

function clearWatcher() {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
}

function notifyRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function setupWatcher(filePath) {
  clearWatcher();
  if (!filePath) return;

  try {
    fileWatcher = fs.watch(filePath, { persistent: true }, (eventType) => {
      if (changeDebounce) {
        clearTimeout(changeDebounce);
      }
      changeDebounce = setTimeout(() => {
        notifyRenderer('file-changed', { eventType });
        if (eventType === 'rename') {
          // Re-establish the watcher after a short delay in case the file was replaced.
          setTimeout(() => setupWatcher(filePath), 200);
        }
      }, 60);
    });

    fileWatcher.on('error', (error) => {
      notifyRenderer('file-watch-error', error.message);
    });
  } catch (error) {
    notifyRenderer('file-watch-error', error.message);
  }
}

function setCurrentFile(filePath) {
  currentFilePath = filePath || null;
  setupWatcher(currentFilePath);
  notifyRenderer('file-selected', currentFilePath);
}

async function readFileContent(filePath) {
  const targetPath = filePath || currentFilePath;
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
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            notifyRenderer('menu-open-file');
          },
        },
        {
          label: 'Create…',
          accelerator: 'CmdOrCtrl+N',
          click: async () => {
            notifyRenderer('menu-create-file');
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

  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    await touchRecentFile(filePath);
    setCurrentFile(filePath);
    notifyRenderer('file-opened-direct', { filePath, content });
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

ipcMain.handle('dialog:openFile', async () => {
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
    content = await readFileContent(filePath);
  } catch (error) {
    // If the file does not exist yet, create it lazily.
    await fs.promises.writeFile(filePath, '', 'utf8');
    content = '';
  }

  setCurrentFile(filePath);
  await touchRecentFile(filePath);
  return { canceled: false, filePath, content };
});

ipcMain.handle('dialog:createFile', async () => {
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

  const content = await readFileContent(filePath).catch(() => '');
  setCurrentFile(filePath);
  await touchRecentFile(filePath);
  return { canceled: false, filePath, content };
});

ipcMain.handle('file:read', async (_event, maybePath) => {
  try {
    const content = await readFileContent(maybePath);
    return { ok: true, content };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('file:write', async (_event, content, maybePath) => {
  const targetPath = maybePath || currentFilePath;
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

ipcMain.handle('file:get-current', () => currentFilePath);

ipcMain.handle('file:set-current', async (_event, filePath) => {
  if (!filePath) {
    setCurrentFile(null);
    return { ok: true };
  }

  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    setCurrentFile(filePath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('file:export-html', async (_event, htmlContent) => {
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

ipcMain.on('quit-app', () => {
  app.quit();
});
