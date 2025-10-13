const { contextBridge, ipcRenderer } = require('electron');

let markedPromise;

function escapeHtml(text = '') {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fallbackMarkdown(markdown = '') {
  return `<pre>${escapeHtml(markdown)}</pre>`;
}

async function getMarked() {
  if (!markedPromise) {
    markedPromise = import('marked')
      .then((mod) => {
        if (mod && typeof mod.marked === 'function') {
          return mod.marked;
        }
        if (mod && typeof mod.default === 'function') {
          return mod.default;
        }
        if (mod && typeof mod.parse === 'function') {
          return { parse: mod.parse };
        }
        throw new Error('Marked module did not provide a parser');
      })
      .catch((error) => {
        console.warn('Failed to load marked for markdown export:', error);
        return null;
      });
  }
  return markedPromise;
}

contextBridge.exposeInMainWorld('threadboard', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  createFile: () => ipcRenderer.invoke('dialog:createFile'),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (content, filePath) => ipcRenderer.invoke('file:write', content, filePath),
  getCurrentFile: () => ipcRenderer.invoke('file:get-current'),
  setCurrentFile: (filePath) => ipcRenderer.invoke('file:set-current', filePath),
  onFileChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('file-changed', handler);
    return () => ipcRenderer.removeListener('file-changed', handler);
  },
  onFileSelected: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('file-selected', handler);
    return () => ipcRenderer.removeListener('file-selected', handler);
  },
  onFileWatchError: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on('file-watch-error', handler);
    return () => ipcRenderer.removeListener('file-watch-error', handler);
  },
  onMenuOpenFile: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu-open-file', handler);
    return () => ipcRenderer.removeListener('menu-open-file', handler);
  },
  onMenuCreateFile: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('menu-create-file', handler);
    return () => ipcRenderer.removeListener('menu-create-file', handler);
  },
  onFileOpened: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('file-opened-direct', handler);
    return () => ipcRenderer.removeListener('file-opened-direct', handler);
  },
  exportHtml: (html) => ipcRenderer.invoke('file:export-html', html),
  renderMarkdown: async (markdown) => {
    try {
      const marked = await getMarked();
      if (marked) {
        if (typeof marked.parse === 'function') {
          return marked.parse(markdown ?? '');
        }
        if (typeof marked === 'function') {
          return marked(markdown ?? '');
        }
      }
    } catch (error) {
      console.warn('Markdown render failed, using fallback:', error);
    }
    return fallbackMarkdown(markdown ?? '');
  },
  revealFile: (filePath) => ipcRenderer.invoke('file:reveal', filePath),
  copyFilePath: (filePath) => ipcRenderer.invoke('file:copy-path', filePath),
  quit: () => ipcRenderer.send('quit-app'),
});
