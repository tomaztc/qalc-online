// Qalculate! online — thin UI around the real qalc WebAssembly REPL.

import { createQalcClient, unsupportedInputReason } from './qalc-client.js';

const HISTORY_KEY = 'qalc.history.v1';
const THEME_KEY = 'qalc.theme.v1';
const PREVIEW_DELAY_MS = 120;
const NO_PREVIEW_COMMANDS = new Set([
  'set', 'save', 'store', 'delete', 'assume', 'clear', 'help', 'info',
  'find', 'mode', 'list', 'quit', 'exit', 'history', 'function', 'variable',
  'rpn',
]);
const ANSI_RE = /\x1b\[([0-9;]*)m/g;
const PLUS_MINUS_RE = /\+\/-|\+-/g;
const ANSI_COLORS = new Map([
  [31, 'tok-var'], [91, 'tok-var'],
  [32, 'tok-unit'], [92, 'tok-unit'],
  [33, 'tok-const'], [93, 'tok-const'],
  [34, 'tok-num'], [94, 'tok-num'],
  [35, 'tok-var'], [95, 'tok-var'],
  [36, 'tok-num'], [96, 'tok-num'],
]);

const savedTheme = loadTheme();
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

const $ = (id) => document.getElementById(id);
const historyEl = $('history');
const historyInner = $('history-inner');
const inputEl = $('expr');
const previewEl = $('preview');
const statusEl = $('status');
const helpModal = $('help-modal');
const themeBtn = $('theme-btn');
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

let client;
let ready = false;
let previewTimer;
let history = loadHistory();
let historyCursor = null;
let previewRevision = 0;

async function boot() {
  console.log('Qalculate: loading WebAssembly engine…');
  setLoadingStatus({ phase: 'download', percent: 0 });

  try {
    client = await createQalcClient(setLoadingStatus);
    if (history.length) {
      console.log(`Qalculate: restoring ${history.length} calculations…`);
      setStatus(`Restoring ${history.length} calculations…`, 'loading');
    }
    await restoreHistory();
  } catch (error) {
    setStatus(`Failed to load engine: ${error}`, 'error');
    return;
  }

  ready = true;
  setStatus('', 'ready');
  console.log('Qalculate: ready. Calculations run locally in WebAssembly.');
  inputEl.focus();
}

async function commit(value) {
  const expression = value.trim();
  if (!expression || !ready) return;

  previewRevision += 1;
  clearTimeout(previewTimer);
  hidePreview();
  historyCursor = null;
  inputEl.value = '';
  autosize();

  const unsupported = unsupportedInputReason(expression);
  if (unsupported) {
    renderEntry({
      expression,
      items: [{ type: 'error', text: `Unavailable: ${unsupported}.` }],
    });
    scrollToTop();
    return;
  }

  let record;
  try {
    record = {
      expression,
      items: parseQalcOutput(await client.evaluate(expression)),
    };
  } catch (error) {
    record = {
      expression,
      items: [{ type: 'error', text: `Engine error: ${error}` }],
    };
  }

  remember(expression);
  renderEntry(record);
  scrollToTop();
}

function updatePreview() {
  if (!ready) return;

  const revision = ++previewRevision;
  clearTimeout(previewTimer);
  const expression = inputEl.value.trim();
  if (!expression || skipsPreview(expression)) {
    hidePreview();
    return;
  }

  previewTimer = setTimeout(() => renderPreview(expression, revision), PREVIEW_DELAY_MS);
}

async function renderPreview(expression, revision) {
  try {
    const raw = await client.preview(expression, () => revision === previewRevision);
    if (revision !== previewRevision) return;
    if (!raw) {
      hidePreview();
      return;
    }

    const value = element('span', 'pv-val');
    value.append(renderAnsi(raw));
    previewEl.replaceChildren(element('span', 'pv-eq', '='), value);
    previewEl.classList.remove('hidden');
    previewEl.setAttribute('aria-hidden', 'false');
  } catch {
    if (revision === previewRevision) hidePreview();
  }
}

function hidePreview() {
  previewEl.classList.add('hidden');
  previewEl.setAttribute('aria-hidden', 'true');
  previewEl.replaceChildren();
}

function skipsPreview(expression) {
  if (expression.startsWith('/') || expression.startsWith('#')) return true;
  return NO_PREVIEW_COMMANDS.has(expression.split(/\s+/, 1)[0].toLowerCase());
}

function parseQalcOutput(lines) {
  const cleaned = lines.map((line) => line.replace(/\r/g, ''));
  while (cleaned.length && !cleaned[0].trim()) cleaned.shift();
  while (cleaned.length && !cleaned.at(-1).trim()) cleaned.pop();
  if (!cleaned.length) return [{ type: 'message', text: '(no output)' }];

  const items = [];
  let messageContinuation = null;
  for (const rawLine of cleaned) {
    const plain = stripAnsi(rawLine.trimStart());
    if (!plain.trim()) continue;

    const lower = plain.toLowerCase();
    const looksLikeResult = plain.includes('=') || plain.includes('≈');
    let type = 'result';
    if (lower.startsWith('error') || lower.includes('is not a')) {
      type = 'error';
      messageContinuation = 'error';
    } else if (lower.startsWith('warning')) {
      type = 'warn';
      messageContinuation = 'warn';
    } else if (messageContinuation && !looksLikeResult) {
      type = messageContinuation;
    } else if (!looksLikeResult && cleaned.length > 1) {
      type = 'message';
      messageContinuation = null;
    } else {
      messageContinuation = null;
    }
    items.push({ type, text: rawLine });
  }
  return items;
}

function renderEntry({ expression, items }) {
  const entry = element('div', 'entry');
  entry.dataset.expression = expression;

  const input = element('button', 'entry-input');
  input.type = 'button';
  input.title = 'Click to reuse';
  input.append(element('span', 'in-prompt', '›'), element('span', '', expression));
  entry.append(input);

  const results = [];
  for (const item of items) {
    if (item.type === 'result') {
      results.push(item);
      continue;
    }
    const message = element(
      'div',
      `entry-message${item.type === 'message' ? '' : ` ${item.type}`}`,
      stripAnsi(item.text).trim(),
    );
    entry.append(message);
  }

  for (const item of results) {
    const result = element('div', 'entry-result');
    result.append(renderAnsi(item.text));
    entry.append(result);
  }

  historyInner.prepend(entry);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function stripAnsi(text) {
  return text.replace(ANSI_RE, '');
}

// Build text nodes instead of injecting HTML, while retaining qalc's ANSI SGR
// colors in the result display.
function renderAnsi(text) {
  const fragment = document.createDocumentFragment();
  let color = null;
  let bold = false;
  let last = 0;
  let match;
  ANSI_RE.lastIndex = 0;

  const append = (value) => {
    if (!value) return;
    const classes = [color, bold && 'tok-bold'].filter(Boolean).join(' ');
    fragment.append(classes ? element('span', classes, value) : value);
  };

  while ((match = ANSI_RE.exec(text))) {
    append(text.slice(last, match.index));
    last = ANSI_RE.lastIndex;
    const codes = match[1] ? match[1].split(';').map(Number) : [0];
    for (const code of codes) {
      if (code === 0) {
        color = null;
        bold = false;
      } else if (code === 1) bold = true;
      else if (code === 22) bold = false;
      else if (code === 39) color = null;
      else if (ANSI_COLORS.has(code)) color = ANSI_COLORS.get(code);
    }
  }
  append(text.slice(last));
  return fragment;
}

function loadHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((expression) => typeof expression === 'string'
        && expression.trim()
        && !unsupportedInputReason(expression));
  } catch {
    return [];
  }
}

function remember(expression) {
  history.push(expression);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.warn('Could not save history:', error);
  }
}

async function restoreHistory() {
  if (!history.length) return;

  for (const [index, expression] of history.entries()) {
    console.log(`Qalculate: replaying history ${index + 1}/${history.length}:`, expression);
    try {
      renderEntry({
        expression,
        items: parseQalcOutput(await client.evaluate(expression, { refreshExchangeRates: false })),
      });
      console.log(`Qalculate: replayed history ${index + 1}/${history.length}.`);
    } catch (error) {
      console.warn(`Qalculate: could not replay history ${index + 1}/${history.length}.`, error);
      // Keep the expression stored so a transient failure can be retried.
    }
  }
  scrollToTop();
}

function recallHistory(direction) {
  if (!history.length) return;
  if (historyCursor === null) historyCursor = history.length;
  historyCursor = Math.max(0, historyCursor + direction);

  if (historyCursor >= history.length) {
    historyCursor = null;
    inputEl.value = '';
  } else {
    inputEl.value = history[historyCursor];
  }
  autosize();
  updatePreview();
}

function setInput(value) {
  inputEl.value = value;
  historyCursor = null;
  inputEl.focus();
  autosize();
  updatePreview();
}

function autosize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, window.innerHeight * 0.4)}px`;
}

function scrollToTop() {
  requestAnimationFrame(() => { historyEl.scrollTop = 0; });
}

function setStatus(text, state) {
  statusEl.textContent = text;
  statusEl.className = `status${state ? ` ${state}` : ''}`;
}

function setLoadingStatus({ phase, percent }) {
  const text = {
    download: `Downloading engine… ${percent}%`,
    compile: 'Compiling engine…',
    start: 'Starting engine…',
    rates: 'Checking exchange rates…',
  }[phase];
  if (text) setStatus(text, 'loading');
}

function normalizePlusMinusInput() {
  const { value, selectionStart, selectionEnd } = inputEl;
  const normalized = value.replace(PLUS_MINUS_RE, '±');
  if (normalized === value) return;

  const start = value.slice(0, selectionStart).replace(PLUS_MINUS_RE, '±').length;
  const end = value.slice(0, selectionEnd).replace(PLUS_MINUS_RE, '±').length;
  inputEl.value = normalized;
  inputEl.setSelectionRange(start, end);
}

function currentTheme() {
  return document.documentElement.dataset.theme
    || (prefersDark.matches ? 'dark' : 'light');
}

function loadTheme() {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    return theme === 'dark' || theme === 'light' ? theme : null;
  } catch {
    return null;
  }
}

function syncThemeControl() {
  const nextTheme = currentTheme() === 'dark' ? 'light' : 'dark';
  const label = nextTheme === 'dark' ? 'Dark' : 'Light';
  themeBtn.textContent = label;
  themeBtn.title = `Switch to ${nextTheme} theme`;
  themeBtn.setAttribute('aria-label', themeBtn.title);
  themeColorMeta?.setAttribute('content', currentTheme() === 'dark' ? '#0c0c0c' : '#ffffff');
}

themeBtn.addEventListener('click', () => {
  document.documentElement.dataset.theme = currentTheme() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, document.documentElement.dataset.theme);
  } catch (error) {
    console.warn('Could not save theme preference:', error);
  }
  syncThemeControl();
});
prefersDark.addEventListener('change', syncThemeControl);
syncThemeControl();

inputEl.addEventListener('input', (event) => {
  if (!event.isComposing) normalizePlusMinusInput();
  historyCursor = null;
  autosize();
  updatePreview();
});

inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    commit(inputEl.value);
  } else if (event.key === 'ArrowUp' && inputEl.value === '') {
    event.preventDefault();
    recallHistory(-1);
  } else if (event.key === 'ArrowDown' && historyCursor !== null) {
    event.preventDefault();
    recallHistory(1);
  }
});

historyInner.addEventListener('click', (event) => {
  const input = event.target.closest('.entry-input');
  if (input) setInput(input.closest('.entry').dataset.expression);
});

$('clear-btn').addEventListener('click', () => {
  if (!confirm('Clear all calculation history? (Settings are also cleared.)')) return;
  localStorage.removeItem(HISTORY_KEY);
  history = [];
  historyCursor = null;
  historyInner.querySelectorAll('.entry').forEach((entry) => entry.remove());
  console.log('Qalculate: calculation history cleared.');
});

document.addEventListener('click', (event) => {
  const example = event.target.closest('code.ex');
  if (!example) return;
  if (helpModal.contains(example)) helpModal.classList.add('hidden');
  setInput(example.textContent);
});

function closeHelp() {
  if (helpModal.classList.contains('hidden')) return;
  helpModal.classList.add('hidden');
  $('help-btn').focus();
}

$('help-btn').addEventListener('click', () => {
  helpModal.classList.remove('hidden');
  $('help-close').focus();
});
$('help-close').addEventListener('click', closeHelp);
helpModal.addEventListener('click', (event) => {
  if (event.target === helpModal) closeHelp();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeHelp();
});

boot();
