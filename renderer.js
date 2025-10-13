(() => {
  const api = window.threadboard;

  const headingPattern = /^## \[(.*?)\]\s*$/;

  const state = {
    filePath: null,
    content: '',
    threads: [],
    watchError: null,
    loadError: null,
    delimiter: '---',
    threadFormat: 'auto',
    statusMessage: '',
  };

  const dom = {
    openFile: document.getElementById('open-file'),
    createFile: document.getElementById('create-file'),
    exportHtml: document.getElementById('export-html'),
    viewRaw: document.getElementById('view-raw'),
    revealFile: document.getElementById('reveal-file'),
    copyPath: document.getElementById('copy-path'),
    openGuide: document.getElementById('open-guide'),
    currentFile: document.getElementById('current-file'),
    watchStatus: document.getElementById('watch-status'),
    threadColumns: document.getElementById('thread-columns'),
    newThreadForm: document.getElementById('new-thread-form'),
    newThreadName: document.getElementById('new-thread-name'),
    alerts: document.getElementById('alerts'),
    rawModal: document.getElementById('raw-modal'),
    rawText: document.getElementById('raw-text'),
    rawClose: document.getElementById('raw-close'),
    guideModal: document.getElementById('guide-modal'),
    guideClose: document.getElementById('guide-close'),
    delimiterInput: document.getElementById('delimiter-input'),
    threadFormat: document.getElementById('thread-format'),
  };

  const newThreadButton = dom.newThreadForm.querySelector('button[type="submit"]');

  const SETTINGS_KEYS = {
    delimiter: 'threadboard:delimiter',
    threadFormat: 'threadboard:threadFormat',
  };

  let statusTimeoutId = null;

  function getStoredSetting(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  }

  function setStoredSetting(key, value) {
    try {
      if (value === null) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, value);
      }
    } catch (error) {
      console.warn('Could not persist preference', error);
    }
  }

  function setStatusMessage(message, timeoutMs = 0) {
    state.statusMessage = message || '';
    updateFileStatus();

    if (statusTimeoutId) {
      clearTimeout(statusTimeoutId);
      statusTimeoutId = null;
    }

    if (message && timeoutMs > 0) {
      statusTimeoutId = window.setTimeout(() => {
        state.statusMessage = '';
        statusTimeoutId = null;
        updateFileStatus();
      }, timeoutMs);
    }
  }

  function setDelimiter(newDelimiter, { reparse = true, persist = true } = {}) {
    const trimmed = (newDelimiter ?? '').trim();
    const effective = trimmed || '---';
    state.delimiter = effective;

    if (dom.delimiterInput && dom.delimiterInput.value !== effective) {
      dom.delimiterInput.value = effective;
    }

    if (persist) {
      setStoredSetting(SETTINGS_KEYS.delimiter, effective);
    }

    if (reparse && state.filePath) {
      updateContent(state.content);
    }
  }

  function setThreadFormat(format, { persist = true } = {}) {
    const allowed = new Set(['auto', 'heading', 'delimiter']);
    const value = allowed.has(format) ? format : 'auto';
    state.threadFormat = value;

    if (dom.threadFormat && dom.threadFormat.value !== value) {
      dom.threadFormat.value = value;
    }

    if (persist) {
      setStoredSetting(SETTINGS_KEYS.threadFormat, value);
    }
  }

  function loadInitialSettings() {
    const savedDelimiter = getStoredSetting(SETTINGS_KEYS.delimiter);
    if (savedDelimiter) {
      setDelimiter(savedDelimiter, { reparse: false, persist: false });
    } else {
      setDelimiter(state.delimiter, { reparse: false, persist: false });
    }

    if (dom.delimiterInput) {
      dom.delimiterInput.value = state.delimiter;
    }

    const savedFormat = getStoredSetting(SETTINGS_KEYS.threadFormat);
    setThreadFormat(savedFormat || state.threadFormat, { persist: false });
  }

  function normalizeNewlines(text) {
    return (text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  function ensureTrailingNewline(text) {
    if (!text) {
      return '';
    }
    return text.endsWith('\n') ? text : `${text}\n`;
  }

  function parseThreads(content, delimiter) {
    const normalized = normalizeNewlines(content);
    const lines = normalized.split('\n');
    const segments = [];

    let current = null;
    let pendingDelimiter = null;
    let nextOrder = 0;

    const trimmedDelimiter = (delimiter ?? '').trim();

    function closeCurrent(endIndex) {
      if (!current) {
        return;
      }

      current.end = endIndex;

      const displayLines = [...current.lines];
      while (displayLines.length && displayLines[displayLines.length - 1] === '') {
        displayLines.pop();
      }

      const displayName = current.type === 'heading'
        ? current.name
        : current.firstLine ?? '';

      segments.push({
        order: current.order,
        name: current.name,
        type: current.type,
        lines: displayLines,
        headingLine: current.headingLine,
        contentStart: current.contentStart,
        start: current.start,
        end: current.end,
        firstLine: current.firstLine,
        previousDelimiterIndex: current.previousDelimiterIndex,
        lineIndices: current.lineIndices,
        nonEmptyLineIndex: current.nonEmptyLineIndex,
        displayName,
      });

      current = null;
    }

    function startHeading(match, lineIndex) {
      current = {
        order: nextOrder,
        name: match[1] ?? '',
        type: 'heading',
        headingLine: lineIndex,
        contentStart: lineIndex + 1,
        start: lineIndex,
        lines: [],
        firstLine: null,
        previousDelimiterIndex: pendingDelimiter?.index ?? null,
        lineIndices: [],
        nonEmptyLineIndex: null,
      };
      nextOrder += 1;
      pendingDelimiter = null;
    }

    function startPlain(lineIndex, fromDelimiter) {
      current = {
        order: nextOrder,
        name: '',
        type: fromDelimiter ? 'delimiter' : 'plain',
        headingLine: null,
        contentStart: lineIndex,
        start: lineIndex,
        lines: [],
        firstLine: null,
        previousDelimiterIndex: fromDelimiter ? pendingDelimiter?.index ?? null : null,
        lineIndices: [],
        nonEmptyLineIndex: null,
      };
      nextOrder += 1;
      pendingDelimiter = null;
    }

    for (let i = 0; i <= lines.length; i += 1) {
      const line = i < lines.length ? lines[i] : null;
      const headingMatch = line ? line.match(headingPattern) : null;
      const isDelimiter = Boolean(
        line !== null && trimmedDelimiter && line.trim() === trimmedDelimiter,
      );
      const isEnd = i === lines.length;

      if (isEnd || headingMatch || isDelimiter) {
        if (current) {
          closeCurrent(i);
        }
      }

      if (isEnd) {
        break;
      }

      if (headingMatch) {
        startHeading(headingMatch, i);
        continue;
      }

      if (isDelimiter) {
        pendingDelimiter = { index: i };
        continue;
      }

      if (!current) {
        startPlain(i, Boolean(pendingDelimiter));
      }

      current.lines.push(line);
      current.lineIndices.push(i);
      if (current.firstLine === null && line.trim().length > 0) {
        current.firstLine = line.trim();
      }
      if (current.nonEmptyLineIndex === null && line.trim().length > 0) {
        current.nonEmptyLineIndex = i;
      }
    }

    return segments;
  }

  function isMatchingThread(original, candidate) {
    if (!candidate) {
      return false;
    }
    if (original.type === 'heading') {
      return candidate.type === 'heading' && candidate.name === original.name;
    }
    if (candidate.type === 'heading') {
      return false;
    }
    if (original.firstLine && candidate.firstLine) {
      return original.firstLine === candidate.firstLine;
    }
    return original.type === candidate.type;
  }

  function beginTitleEdit(thread, headingEl) {
    if (!state.filePath) {
      window.alert('Select a Markdown file first.');
      return;
    }

    if (!headingEl || headingEl.dataset.editing === 'true') {
      return;
    }

    headingEl.dataset.editing = 'true';

    const currentTitle = thread.displayName || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentTitle;
    input.className = 'thread-title-input';
    input.placeholder = '(untitled)';

    const finalize = async (commit) => {
      if (!input.isConnected) {
        return;
      }

      const rawValue = commit ? input.value : currentTitle;
      const sanitizedValue = commit ? sanitiseThreadName(rawValue) : currentTitle;

      input.replaceWith(headingEl);
      headingEl.dataset.editing = 'false';
      headingEl.textContent = sanitizedValue;
      thread.displayName = sanitizedValue;

      if (commit && sanitizedValue !== currentTitle) {
        await commitTitleChange(thread, sanitizedValue);
      }
    };

    input.addEventListener('blur', () => finalize(true));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finalize(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finalize(false);
      }
    });

    headingEl.replaceWith(input);
    input.focus();
    input.select();
  }

  async function commitTitleChange(thread, newTitle) {
    const response = await api.readFile();
    if (!response.ok) {
      state.loadError = response.error;
      renderAlerts();
      return;
    }

    const content = normalizeNewlines(response.content);
    const lines = content.split('\n');
    const segments = parseThreads(content, state.delimiter);
    const target = segments.find((seg) => seg.order === thread.order);

    if (!isMatchingThread(thread, target)) {
      window.alert('Could not update title because the thread changed externally. Reloading.');
      await reloadFromDisk();
      return;
    }

    const finalTitle = sanitiseThreadName(newTitle);

    if (target.type === 'heading') {
      const headingLineIndex = target.headingLine;
      if (typeof headingLineIndex === 'number') {
        lines[headingLineIndex] = `## [${finalTitle}]`;
      }
    } else {
      const insertIndex = typeof target.start === 'number' ? target.start : 0;
      const headingLine = `## [${finalTitle}]`;
      lines.splice(insertIndex, 0, headingLine);

      const nextIndex = insertIndex + 1;
      if (nextIndex < lines.length && lines[nextIndex].trim().length > 0) {
        lines.splice(nextIndex, 0, '');
      }
    }

    const newContent = ensureTrailingNewline(lines.join('\n'));
    const writeResult = await api.writeFile(newContent);
    if (!writeResult.ok) {
      state.loadError = writeResult.error;
      renderAlerts();
      return;
    }

    state.loadError = null;
    setStatusMessage('Title updated', 2000);
    await reloadFromDisk();
  }

  function isRawModalOpen() {
    return Boolean(dom.rawModal && dom.rawModal.classList.contains('open'));
  }

  function isGuideModalOpen() {
    return Boolean(dom.guideModal && dom.guideModal.classList.contains('open'));
  }

  function refreshModalState() {
    if (isRawModalOpen() || isGuideModalOpen()) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
  }

  function openRawModal() {
    if (!dom.rawModal || !state.filePath) {
      return;
    }
    if (dom.rawText) {
      dom.rawText.value = state.content;
      dom.rawText.scrollTop = 0;
    }
    dom.rawModal.classList.add('open');
    refreshModalState();
  }

  function closeRawModal() {
    if (!dom.rawModal) {
      return;
    }
    dom.rawModal.classList.remove('open');
    refreshModalState();
  }

  function openGuideModal() {
    if (!dom.guideModal) {
      return;
    }
    dom.guideModal.classList.add('open');
    const guideBody = document.getElementById('guide-body');
    if (guideBody) {
      guideBody.scrollTop = 0;
    }
    refreshModalState();
  }

  function closeGuideModal() {
    if (!dom.guideModal) {
      return;
    }
    dom.guideModal.classList.remove('open');
    refreshModalState();
  }

  function setFilePath(filePath) {
    state.filePath = filePath || null;
    if (!state.filePath && isRawModalOpen()) {
      closeRawModal();
    }
    if (!state.filePath) {
      state.statusMessage = '';
      if (statusTimeoutId) {
        clearTimeout(statusTimeoutId);
        statusTimeoutId = null;
      }
    }
    updateFileStatus();
    updateControlsState();
  }

  function updateFileStatus() {
    if (!state.filePath) {
      dom.currentFile.textContent = 'No file selected';
      dom.currentFile.removeAttribute('title');
      dom.watchStatus.textContent = '';
      dom.watchStatus.removeAttribute('title');
      return;
    }

    const fileName = state.filePath.split(/[\\/]/).pop();
    dom.currentFile.textContent = fileName || state.filePath;
    dom.currentFile.setAttribute('title', state.filePath);
    const statusText = state.statusMessage
      ? state.statusMessage
      : state.watchError
        ? 'File watch error'
        : 'Watching for changes…';
    dom.watchStatus.textContent = statusText;
    if (state.watchError) {
      dom.watchStatus.setAttribute('title', state.watchError);
    } else {
      dom.watchStatus.removeAttribute('title');
    }
  }

  function updateControlsState() {
    const hasFile = Boolean(state.filePath);
    dom.exportHtml.disabled = !hasFile;
    dom.newThreadName.disabled = !hasFile;
    newThreadButton.disabled = !hasFile;
    if (dom.viewRaw) {
      dom.viewRaw.disabled = !hasFile;
    }
    if (dom.revealFile) {
      dom.revealFile.disabled = !hasFile;
    }
    if (dom.copyPath) {
      dom.copyPath.disabled = !hasFile;
    }
    if (dom.threadFormat) {
      dom.threadFormat.disabled = !hasFile;
      if (dom.threadFormat.value !== state.threadFormat) {
        dom.threadFormat.value = state.threadFormat;
      }
    }
    if (dom.delimiterInput && dom.delimiterInput.value !== state.delimiter) {
      dom.delimiterInput.value = state.delimiter;
    }
    dom.threadColumns.classList.toggle('empty', !hasFile || state.threads.length === 0);
  }

  function updateContent(content) {
    const normalized = normalizeNewlines(content);
    state.content = normalized;
    state.threads = parseThreads(normalized, state.delimiter);
    if (isRawModalOpen() && dom.rawText) {
      dom.rawText.value = state.content;
    }
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
      title.textContent = thread.displayName || '';
      title.dataset.editing = 'false';
      title.addEventListener('click', () => beginTitleEdit(thread, title));
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
        const handled = await handleSubmission(thread, textarea.value, false);
        if (handled) {
          textarea.value = '';
        }
      });

      const addAi = document.createElement('button');
      addAi.className = 'add-ai';
      addAi.textContent = 'Add AI Reply';
      addAi.addEventListener('click', async () => {
        const handled = await handleSubmission(thread, textarea.value, true);
        if (handled) {
          textarea.value = '';
        }
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

  async function appendMessages(thread, entrySpecs) {
    if (!state.filePath) {
      window.alert('Select a Markdown file first.');
      return false;
    }

    if (!Array.isArray(entrySpecs) || entrySpecs.length === 0) {
      return false;
    }

    const prepared = entrySpecs
      .map((entry) => ({
        text: typeof entry.text === 'string' ? entry.text : '',
        isAi: Boolean(entry.isAi),
      }))
      .filter((entry) => entry.text.trim().length > 0);

    if (prepared.length === 0) {
      return false;
    }

    const response = await api.readFile();
    if (!response.ok) {
      state.loadError = response.error;
      renderAlerts();
      return false;
    }

    state.loadError = null;
    const content = normalizeNewlines(response.content);
    const lines = content.split('\n');
    const segments = parseThreads(content, state.delimiter);
    const target = segments.find((seg) => seg.order === thread.order);
    if (!isMatchingThread(thread, target)) {
      window.alert('Thread not found or it changed externally. Reloading the latest content.');
      await reloadFromDisk();
      return false;
    }

    const lowerBound = target.contentStart ?? 0;

    let inserted = false;

    prepared.forEach((entry) => {
      const messageLines = buildMessageLines(entry.text, entry.isAi);
      if (messageLines.length === 0) {
        return;
      }

      let insertIndex = target.end;
      while (insertIndex > lowerBound && lines[insertIndex - 1] === '') {
        insertIndex -= 1;
      }

      lines.splice(insertIndex, 0, ...messageLines);
      target.end = insertIndex + messageLines.length;
      inserted = true;
    });

    if (!inserted) {
      return false;
    }

    const newContent = ensureTrailingNewline(lines.join('\n'));
    const writeResult = await api.writeFile(newContent);
    if (!writeResult.ok) {
      state.loadError = writeResult.error;
      renderAlerts();
      return false;
    }

    state.loadError = null;
    updateContent(newContent);
    renderAlerts();
    return true;
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

  function parseCliTranscript(rawText) {
    const normalized = normalizeNewlines(rawText);
    const lines = normalized.split('\n');
    const entries = [];
    let current = null;
    let detected = false;

    const commitCurrent = () => {
      if (!current) {
        return;
      }
      const text = current.lines.join('\n');
      if (text.trim().length === 0) {
        current = null;
        return;
      }
      const type = current.type === 'ai' ? 'ai' : 'human';
      entries.push({ type, text });
      current = null;
    };

    lines.forEach((rawLine) => {
      const cleaned = rawLine.replace(/\u00a0/g, ' ');
      const humanMatch = cleaned.match(/^▌\s?(.*)$/);
      if (humanMatch) {
        detected = true;
        commitCurrent();
        current = { type: 'human', lines: [humanMatch[1] ?? ''] };
        return;
      }

      const aiMatch = cleaned.match(/^>\s?(.*)$/);
      if (aiMatch) {
        detected = true;
        if (!current || current.type !== 'ai') {
          commitCurrent();
          current = { type: 'ai', lines: [] };
        }
        current.lines.push(aiMatch[1] ?? '');
        return;
      }

      if (!current) {
        if (cleaned.trim().length === 0) {
          return;
        }
        current = { type: 'human', lines: [] };
      }

      current.lines.push(cleaned);
    });

    commitCurrent();

    return { detected, entries };
  }

  function stripCliMarkers(rawText) {
    return normalizeNewlines(rawText)
      .split('\n')
      .map((line) => {
        const cleaned = line.replace(/\u00a0/g, ' ');
        if (/^▌\s?/.test(cleaned)) {
          return cleaned.replace(/^▌\s?/, '');
        }
        if (/^>\s?/.test(cleaned)) {
          return cleaned.replace(/^>\s?/, '');
        }
        return cleaned;
      })
      .join('\n');
  }

  async function handleSubmission(thread, rawText, defaultIsAi) {
    if (!state.filePath) {
      window.alert('Select a Markdown file first.');
      return false;
    }

    if (typeof rawText !== 'string') {
      return false;
    }

    const trimmed = rawText.trim();
    if (!trimmed) {
      return false;
    }

    const parsed = parseCliTranscript(rawText);
    if (parsed.detected && parsed.entries.length > 0) {
      const humanCount = parsed.entries.filter((entry) => entry.type === 'human').length;
      const aiCount = parsed.entries.filter((entry) => entry.type === 'ai').length;
      const summaryParts = [];
      if (humanCount > 0) {
        summaryParts.push(`${humanCount} human`);
      }
      if (aiCount > 0) {
        summaryParts.push(`${aiCount} AI`);
      }
      const summary = summaryParts.join(' and ') || 'messages';
      const confirmText = `Detected Codex CLI transcript (${summary}). Append to this thread?`;

      if (window.confirm(confirmText)) {
        const success = await appendMessages(
          thread,
          parsed.entries.map((entry) => ({
            text: entry.text,
            isAi: entry.type === 'ai',
          })),
        );
        if (success) {
          setStatusMessage('Imported Codex transcript', 2500);
        }
        return success;
      }

      if (parsed.entries.length === 1) {
        return appendMessages(thread, [{ text: parsed.entries[0].text, isAi: defaultIsAi }]);
      }

      const combined = stripCliMarkers(rawText);
      return appendMessages(thread, [{ text: combined, isAi: defaultIsAi }]);
    }

    return appendMessages(thread, [{ text: rawText, isAi: defaultIsAi }]);
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
    const segments = parseThreads(content, state.delimiter);
    const target = segments.find((seg) => seg.order === thread.order);

    if (!isMatchingThread(thread, target)) {
      window.alert('Thread not found or it changed externally. Reloading the latest content.');
      await reloadFromDisk();
      return;
    }

    const removeStart = target.headingLine ?? target.contentStart;
    const removeEnd = target.end;
    const removeCount = Math.max(0, removeEnd - removeStart);
    if (removeCount > 0) {
      lines.splice(removeStart, removeCount);
    }

    // Remove redundant blank lines left behind.
    let cleanupIndex = removeStart;
    while (cleanupIndex < lines.length - 1 && lines[cleanupIndex] === '' && lines[cleanupIndex + 1] === '') {
      lines.splice(cleanupIndex, 1);
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
    return raw.replace(/[\r\n]/g, ' ').replace(/[\[\]]/g, '').trim();
  }

  function composeContentWithNewThread(content, threadName, format) {
    const normalized = normalizeNewlines(content);
    const trimmed = normalized.trimEnd();

    if (format === 'delimiter') {
      return composeDelimiterThread(trimmed, threadName);
    }

    const headingLine = `## [${threadName}]`;

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
    return ensureTrailingNewline(result);
  }

  function composeDelimiterThread(existingContent, threadName) {
    const effectiveDelimiter = state.delimiter && state.delimiter.trim().length > 0
      ? state.delimiter.trim()
      : '---';

    let result = existingContent;
    const hasExisting = result.length > 0;

    if (hasExisting) {
      if (!result.endsWith('\n')) {
        result += '\n';
      }

      const lines = result.split('\n');
      let lastMeaningful = '';
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const value = lines[i].trim();
        if (value.length > 0) {
          lastMeaningful = value;
          break;
        }
      }

      if (lastMeaningful !== effectiveDelimiter) {
        result += `${effectiveDelimiter}\n`;
      }
    } else {
      result = `${effectiveDelimiter}\n`;
    }

    if (threadName) {
      result += `${threadName}\n`;
    } else {
      result += '\n';
    }

    return ensureTrailingNewline(result);
  }

  function determineThreadFormat(threadName) {
    if (state.threadFormat === 'heading') {
      return 'heading';
    }
    if (state.threadFormat === 'delimiter') {
      return 'delimiter';
    }

    if (threadName) {
      return 'heading';
    }

    const hasNonHeading = state.threads.some((thread) => thread.type !== 'heading');
    return hasNonHeading ? 'delimiter' : 'heading';
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
    const format = determineThreadFormat(threadName);
    const newContent = composeContentWithNewThread(response.content, threadName, format);
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

  function handleViewRaw() {
    if (!state.filePath) {
      window.alert('Select a Markdown file first.');
      return;
    }
    openRawModal();
  }

  async function handleRevealFile() {
    if (!state.filePath) {
      return;
    }

    if (api.revealFile) {
      const result = await api.revealFile(state.filePath);
      if (!result?.ok && !result?.canceled) {
        window.alert(`Could not reveal file: ${result.error}`);
      } else if (result?.ok) {
        setStatusMessage('Revealed in Finder', 2500);
      }
      return;
    }

    window.alert('Reveal in Finder is not available in this build.');
  }

  async function handleCopyPath() {
    if (!state.filePath) {
      return;
    }

    if (api.copyFilePath) {
      const result = await api.copyFilePath(state.filePath);
      if (!result?.ok) {
        window.alert(`Could not copy path: ${result?.error ?? 'Unknown error'}`);
      } else {
        setStatusMessage('Path copied to clipboard', 2000);
      }
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(state.filePath);
        setStatusMessage('Path copied to clipboard', 2000);
        return;
      } catch (error) {
        window.alert(`Could not copy path: ${error.message}`);
        return;
      }
    }

    window.alert('Clipboard copy is not supported in this environment.');
  }

  function handleDelimiterChange(event) {
    setDelimiter(event.target.value, { reparse: true, persist: true });
  }

  function handleThreadFormatChange(event) {
    setThreadFormat(event.target.value, { persist: true });
  }

  function handleGlobalKeydown(event) {
    if (event.key !== 'Escape') {
      return;
    }

    if (isRawModalOpen()) {
      event.stopPropagation();
      closeRawModal();
      return;
    }

    if (isGuideModalOpen()) {
      event.stopPropagation();
      closeGuideModal();
    }
  }

  function wireEvents() {
    dom.openFile.addEventListener('click', handleOpenFile);
    dom.createFile.addEventListener('click', handleCreateFile);
    dom.exportHtml.addEventListener('click', exportHtml);
    dom.newThreadForm.addEventListener('submit', handleNewThread);
    if (dom.viewRaw) {
      dom.viewRaw.addEventListener('click', handleViewRaw);
    }
    if (dom.rawClose) {
      dom.rawClose.addEventListener('click', closeRawModal);
    }
    if (dom.rawModal) {
      dom.rawModal.addEventListener('click', (event) => {
        if (event.target === dom.rawModal) {
          closeRawModal();
        }
      });
    }
    if (dom.openGuide) {
      dom.openGuide.addEventListener('click', openGuideModal);
    }
    if (dom.guideClose) {
      dom.guideClose.addEventListener('click', closeGuideModal);
    }
    if (dom.guideModal) {
      dom.guideModal.addEventListener('click', (event) => {
        if (event.target === dom.guideModal) {
          closeGuideModal();
        }
      });
    }
    if (dom.copyPath) {
      dom.copyPath.addEventListener('click', handleCopyPath);
    }
    if (dom.revealFile) {
      dom.revealFile.addEventListener('click', handleRevealFile);
    }
    if (dom.delimiterInput) {
      dom.delimiterInput.addEventListener('change', handleDelimiterChange);
    }
    if (dom.threadFormat) {
      dom.threadFormat.addEventListener('change', handleThreadFormatChange);
    }
    document.addEventListener('keydown', handleGlobalKeydown);

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
      state.statusMessage = '';
      if (statusTimeoutId) {
        clearTimeout(statusTimeoutId);
        statusTimeoutId = null;
      }
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
    loadInitialSettings();
    wireEvents();
    updateControlsState();
    renderAlerts();
  }

  init();
})();
