const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let currentFilePath = null;
let fileWatcher = null;
let changeDebounce = null;

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

function buildMenu() {
  const template = [
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
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'forcereload' }, { role: 'toggledevtools' }, { type: 'separator' }, { role: 'resetzoom' }, { role: 'zoomin' }, { role: 'zoomout' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
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

ipcMain.on('quit-app', () => {
  app.quit();
});
