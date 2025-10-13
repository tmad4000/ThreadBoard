const { contextBridge, ipcRenderer } = require('electron');

let markedPromise;

function getMarked() {
  if (!markedPromise) {
    markedPromise = import('marked').then((mod) => {
      if (mod && typeof mod.marked === 'function') {
        return mod.marked;
      }
      if (mod && typeof mod.default === 'function') {
        return mod.default;
      }
      throw new Error('Marked module did not provide a parser');
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
  exportHtml: (html) => ipcRenderer.invoke('file:export-html', html),
  renderMarkdown: async (markdown) => {
    const marked = await getMarked();
    if (typeof marked.parse === 'function') {
      return marked.parse(markdown ?? '');
    }
    return marked(markdown ?? '');
  },
  revealFile: (filePath) => ipcRenderer.invoke('file:reveal', filePath),
  copyFilePath: (filePath) => ipcRenderer.invoke('file:copy-path', filePath),
  quit: () => ipcRenderer.send('quit-app'),
});
