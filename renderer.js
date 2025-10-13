(() => {
  const api = window.threadboard;

  const headingPattern = /^## \[(.*?)\]\s*$/;

  const state = {
    filePath: null,
    content: '',
    threads: [],
    watchError: null,
    loadError: null,
  };

  const dom = {
    openFile: document.getElementById('open-file'),
    createFile: document.getElementById('create-file'),
    exportHtml: document.getElementById('export-html'),
    currentFile: document.getElementById('current-file'),
    watchStatus: document.getElementById('watch-status'),
    threadColumns: document.getElementById('thread-columns'),
    newThreadForm: document.getElementById('new-thread-form'),
    newThreadName: document.getElementById('new-thread-name'),
    alerts: document.getElementById('alerts'),
  };

  const newThreadButton = dom.newThreadForm.querySelector('button[type="submit"]');

  function normalizeNewlines(text) {
    return (text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  function ensureTrailingNewline(text) {
    if (!text) {
      return '';
    }
    return text.endsWith('\n') ? text : `${text}\n`;
  }

  function parseThreads(content) {
    const lines = normalizeNewlines(content).split('\n');
    const threads = [];
    let current = null;
    let order = -1;

    for (const line of lines) {
      const match = line.match(headingPattern);
      if (match) {
        order += 1;
        current = {
          name: match[1] ?? '',
          order,
          lines: [],
        };
        threads.push(current);
      } else if (current) {
        current.lines.push(line);
      }
    }

    return threads;
  }

  function setFilePath(filePath) {
    state.filePath = filePath || null;
    updateFileStatus();
    updateControlsState();
  }

  function updateFileStatus() {
    if (!state.filePath) {
      dom.currentFile.textContent = 'No file selected';
      dom.currentFile.removeAttribute('title');
      dom.watchStatus.textContent = '';
      return;
    }

    const fileName = state.filePath.split(/[\\/]/).pop();
    dom.currentFile.textContent = fileName || state.filePath;
    dom.currentFile.setAttribute('title', state.filePath);
    dom.watchStatus.textContent = state.watchError ? 'File watch error' : 'Watching for changes…';
  }

  function updateControlsState() {
    const hasFile = Boolean(state.filePath);
    dom.exportHtml.disabled = !hasFile;
    dom.newThreadName.disabled = !hasFile;
    newThreadButton.disabled = !hasFile;
    dom.threadColumns.classList.toggle('empty', !hasFile || state.threads.length === 0);
  }

  function updateContent(content) {
    const normalized = normalizeNewlines(content);
    state.content = normalized;
    state.threads = parseThreads(normalized);
    renderThreads();
    updateControlsState();
  }

  function renderThreads() {
    const { threadColumns } = dom;
    threadColumns.innerHTML = '';

    if (!state.filePath) {
      const placeholder = createPlaceholder('Select or create a Markdown file to begin.');
      threadColumns.appendChild(placeholder);
      threadColumns.classList.add('empty');
      return;
    }

    if (state.threads.length === 0) {
      const placeholder = createPlaceholder('No threads yet. Use the form above to add one.');
      threadColumns.appendChild(placeholder);
      threadColumns.classList.add('empty');
      return;
    }

    threadColumns.classList.remove('empty');

    state.threads.forEach((thread) => {
      const column = document.createElement('div');
      column.className = 'thread-column';

      const header = document.createElement('div');
      header.className = 'thread-header';

      const title = document.createElement('h2');
      title.textContent = thread.name || '';
      header.appendChild(title);

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => handleDeleteThread(thread));
      header.appendChild(deleteBtn);

      column.appendChild(header);

      const messages = document.createElement('div');
      messages.className = 'message-list';

      const trimmedLines = [...thread.lines];
      while (trimmedLines.length && trimmedLines[trimmedLines.length - 1] === '') {
        trimmedLines.pop();
      }

      if (trimmedLines.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'message placeholder';
        emptyMessage.textContent = 'No messages yet.';
        messages.appendChild(emptyMessage);
      } else {
        trimmedLines.forEach((line) => {
          if (line.length === 0) {
            return;
          }
          const isAi = /^>\s?/.test(line);
          const display = isAi ? line.replace(/^>\s?/, '') : line;
          const messageEl = document.createElement('div');
          messageEl.className = `message${isAi ? ' ai' : ''}`;
          messageEl.textContent = display;
          messages.appendChild(messageEl);
        });
      }

      column.appendChild(messages);

      const inputWrapper = document.createElement('div');
      inputWrapper.className = 'thread-input';

      const textarea = document.createElement('textarea');
      textarea.placeholder = 'Add a message…';
      inputWrapper.appendChild(textarea);

      const buttonRow = document.createElement('div');
      buttonRow.className = 'input-buttons';

      const addHuman = document.createElement('button');
      addHuman.className = 'add-human';
      addHuman.textContent = 'Add Message';
      addHuman.addEventListener('click', async () => {
        await appendMessage(thread, textarea.value, false);
        textarea.value = '';
      });

      const addAi = document.createElement('button');
      addAi.className = 'add-ai';
      addAi.textContent = 'Add AI Reply';
      addAi.addEventListener('click', async () => {
        await appendMessage(thread, textarea.value, true);
        textarea.value = '';
      });

      buttonRow.appendChild(addHuman);
      buttonRow.appendChild(addAi);
      inputWrapper.appendChild(buttonRow);

      column.appendChild(inputWrapper);

      dom.threadColumns.appendChild(column);
    });
  }

  function createPlaceholder(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'placeholder';
    wrapper.textContent = message;
    return wrapper;
  }

  function renderAlerts() {
    dom.alerts.innerHTML = '';
    const messages = [];
    if (state.watchError) {
      messages.push(`File watcher reported: ${state.watchError}`);
    }
    if (state.loadError) {
      messages.push(`Could not read file: ${state.loadError}`);
    }

    messages.forEach((text) => {
      const banner = document.createElement('div');
      banner.className = 'error-banner';
      banner.textContent = text;
      dom.alerts.appendChild(banner);
    });
  }

  function findThreadRange(lines, targetOrder) {
    let currentOrder = -1;
    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(headingPattern);
      if (match) {
        currentOrder += 1;
        if (currentOrder === targetOrder) {
          let end = lines.length;
          for (let j = i + 1; j < lines.length; j += 1) {
            if (headingPattern.test(lines[j])) {
              end = j;
              break;
            }
          }
          return { start: i, end };
        }
      }
    }
    return null;
  }

  async function appendMessage(thread, rawText, isAi) {
    if (!state.filePath) {
      window.alert('Select a Markdown file first.');
      return;
    }

    const trimmed = rawText.trim();
    if (!trimmed) {
      return;
    }

    const response = await api.readFile();
    if (!response.ok) {
      state.loadError = response.error;
      renderAlerts();
      return;
    }

    state.loadError = null;
    const content = normalizeNewlines(response.content);
    const lines = content.split('\n');
    const range = findThreadRange(lines, thread.order);
    if (!range) {
      window.alert('Thread not found in file. It may have been renamed or removed externally.');
      await reloadFromDisk();
      return;
    }

    const messageLines = buildMessageLines(rawText, isAi);
    if (messageLines.length === 0) {
      return;
    }

    let insertIndex = range.end;
    while (insertIndex > range.start + 1 && lines[insertIndex - 1] === '') {
      insertIndex -= 1;
    }

    lines.splice(insertIndex, 0, ...messageLines);

    const newContent = ensureTrailingNewline(lines.join('\n'));
    const writeResult = await api.writeFile(newContent);
    if (!writeResult.ok) {
      state.loadError = writeResult.error;
      renderAlerts();
      return;
    }

    state.loadError = null;
    updateContent(newContent);
    renderAlerts();
  }

  function buildMessageLines(rawText, isAi) {
    const sanitized = normalizeNewlines(rawText).split('\n');
    while (sanitized.length && sanitized[sanitized.length - 1].trim().length === 0) {
      sanitized.pop();
    }

    const lines = sanitized.map((line) => line.replace(/\s+$/, ''));
    if (lines.length === 0) {
      return [];
    }

    if (!isAi) {
      return lines;
    }

    return lines.map((line) => {
      if (line.length === 0) {
        return '>';
      }
      return line.startsWith('>') ? line : `> ${line}`;
    });
  }

  async function handleDeleteThread(thread) {
    if (!state.filePath) {
      return;
    }
    const confirmed = window.confirm('Delete this thread? This removes all of its lines from the Markdown file.');
    if (!confirmed) {
      return;
    }

    const response = await api.readFile();
    if (!response.ok) {
      state.loadError = response.error;
      renderAlerts();
      return;
    }

    state.loadError = null;
    const content = normalizeNewlines(response.content);
    const lines = content.split('\n');
    const range = findThreadRange(lines, thread.order);
    if (!range) {
      window.alert('Thread not found in file.');
      await reloadFromDisk();
      return;
    }

    const removeCount = range.end - range.start;
    lines.splice(range.start, removeCount);

    // Remove redundant blank lines left behind.
    while (range.start < lines.length - 1 && lines[range.start] === '' && lines[range.start + 1] === '') {
      lines.splice(range.start, 1);
    }
    while (lines.length && lines[0] === '') {
      lines.shift();
    }

    const newContent = lines.length ? ensureTrailingNewline(lines.join('\n')) : '';
    const writeResult = await api.writeFile(newContent);
    if (!writeResult.ok) {
      state.loadError = writeResult.error;
      renderAlerts();
      return;
    }

    state.loadError = null;
    updateContent(newContent);
    renderAlerts();
  }

  function sanitiseThreadName(raw) {
    if (typeof raw !== 'string') {
      return '';
    }
    return raw.replace(/[\r\n]/g, ' ').replace(/]/g, '').trim();
  }

  function composeContentWithNewThread(content, threadName) {
    const normalized = normalizeNewlines(content);
    const headingLine = `## [${threadName}]`;
    const trimmed = normalized.trimEnd();

    if (!trimmed) {
      return `${headingLine}\n`;
    }

    let result = trimmed;
    if (!result.endsWith('\n')) {
      result += '\n';
    }
    if (!result.endsWith('\n\n')) {
      result += '\n';
    }
    result += `${headingLine}\n`;
    return result;
  }

  async function handleNewThread(event) {
    event.preventDefault();
    if (!state.filePath) {
      window.alert('Select a Markdown file first.');
      return;
    }

    const threadName = sanitiseThreadName(dom.newThreadName.value);
    dom.newThreadName.value = '';

    const response = await api.readFile();
    if (!response.ok) {
      state.loadError = response.error;
      renderAlerts();
      return;
    }

    state.loadError = null;
    const newContent = composeContentWithNewThread(response.content, threadName);
    const writeResult = await api.writeFile(newContent);
    if (!writeResult.ok) {
      state.loadError = writeResult.error;
      renderAlerts();
      return;
    }

    updateContent(newContent);
    renderAlerts();
  }

  async function reloadFromDisk() {
    if (!state.filePath) {
      return;
    }
    const response = await api.readFile();
    if (!response.ok) {
      state.loadError = response.error;
      renderAlerts();
      return;
    }
    state.loadError = null;
    updateContent(response.content);
    renderAlerts();
  }

  async function exportHtml() {
    if (!state.filePath) {
      return;
    }

    const markdown = state.content;
    let body = '';
    try {
      body = await api.renderMarkdown(markdown);
    } catch (error) {
      window.alert(`Could not render Markdown: ${error.message}`);
      return;
    }
    const documentHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Threadboard Export</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px auto; max-width: 900px; line-height: 1.6; color: #222; }
      h2 { border-bottom: 1px solid #ddd; padding-bottom: 0.3em; margin-top: 2em; }
      blockquote { background: #f5f5f5; padding: 0.5em 1em; border-left: 4px solid #3a7afe; }
    </style>
  </head>
  <body>
${body}
  </body>
</html>`;

    const result = await api.exportHtml(documentHtml);
    if (!result.ok && !result.canceled) {
      window.alert(`Export failed: ${result.error}`);
    }
  }

  function wireEvents() {
    dom.openFile.addEventListener('click', handleOpenFile);
    dom.createFile.addEventListener('click', handleCreateFile);
    dom.exportHtml.addEventListener('click', exportHtml);
    dom.newThreadForm.addEventListener('submit', handleNewThread);

    api.onFileChanged(async () => {
      await reloadFromDisk();
    });

    api.onFileSelected((filePath) => {
      state.watchError = null;
      setFilePath(filePath);
      renderAlerts();
    });

    api.onFileWatchError((message) => {
      state.watchError = message || 'Unknown error';
      updateFileStatus();
      renderAlerts();
    });

    api.onMenuOpenFile(() => handleOpenFile());
    api.onMenuCreateFile(() => handleCreateFile());
  }

  async function handleOpenFile() {
    const result = await api.openFile();
    if (!result || result.canceled) {
      return;
    }
    state.watchError = null;
    setFilePath(result.filePath);
    updateContent(result.content || '');
    renderAlerts();
  }

  async function handleCreateFile() {
    const result = await api.createFile();
    if (!result || result.canceled) {
      return;
    }
    state.watchError = null;
    setFilePath(result.filePath);
    updateContent(result.content || '');
    renderAlerts();
  }

  function init() {
    wireEvents();
    updateControlsState();
    renderAlerts();
  }

  init();
})();
