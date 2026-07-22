// Qalculate! online — front-end driver.
//
// Loads the qalc WebAssembly module, drives it one line at a time (exactly like
// the interactive CLI), renders a live preview as you type, and keeps a history.
// Configuration lives inside the wasm virtual filesystem (qalc's own qalc.cfg)
// and is mirrored to IndexedDB so
// every "set …" the user makes survives a reload — no server, no setup.

import QalcModule from './qalc-loader.js';

const CFG_DIR = '/qalc';            // QALCULATE_USER_DIR inside the wasm FS
const HISTORY_KEY = 'qalc.history.v1';
const MAX_HISTORY = 200;

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const historyEl = $('history');
const historyInner = $('history-inner');
const welcomeEl = $('welcome');
const inputEl = $('expr');
const previewEl = $('preview');
const statusEl = $('status');

// ---- module state ----
let Module = null;
let capture = [];                 // stdout lines captured during a call
let webStart, webEval, webPreview;
let ready = false;
let syncTimer = null;
let entries = [];                 // { expr, items } captured at commit time

// ===========================================================================
// Boot
// ===========================================================================
async function boot() {
  setStatus('Loading engine…', 'loading');
  try {
    Module = await QalcModule({
      print: (t) => capture.push(t),
      printErr: (t) => capture.push(t),
      noInitialRun: true,
    });
  } catch (e) {
    setStatus('Failed to load engine: ' + e, 'error');
    return;
  }

  // Mount a persistent IndexedDB-backed dir for qalc's config, then point
  // qalc at it via the QALCULATE_USER_DIR environment variable.
  let cfgMounted = false;
  try {
    const FS = Module.FS;
    FS.mkdir(CFG_DIR);
    FS.mount(Module.IDBFS, {}, CFG_DIR);
    await syncFS(true); // load persisted config from IndexedDB
    cfgMounted = true;
  } catch (e) {
    console.warn('IDBFS unavailable, config will not persist:', e);
  }

  webStart = Module.cwrap('qalc_web_start', null, [], { async: true });
  webEval = Module.cwrap('qalc_web_eval', null, ['string'], { async: true });
  webPreview = Module.cwrap('qalc_web_preview', 'string', ['string']);
  const setUserDir = Module.cwrap('qalc_web_set_userdir', null, ['string']);

  // Point qalc's config/history (getLocalDir) at the mounted persistent dir.
  // Module.ENV is not reliably exported, so this is done inside the runtime.
  if (cfgMounted) setUserDir(CFG_DIR);

  // Run qalc startup (loads all definitions). Discard the startup banner.
  capture = [];
  await webStart();
  capture = [];

  ready = true;
  setStatus('Ready — the full Qalculate! engine, offline.', 'ready');
  await restoreHistory();
  inputEl.focus();
}

// Flush the config dir between IndexedDB and the in-memory FS.
function syncFS(fromDB) {
  return new Promise((resolve) => {
    if (!Module || !Module.FS) return resolve();
    Module.FS.syncfs(fromDB, (err) => {
      if (err) console.warn('syncfs error', err);
      resolve();
    });
  });
}

// Persist config to IndexedDB, debounced (qalc has already written qalc.cfg to
// the in-memory FS inside qalc_web_eval).
function schedulePersist() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncFS(false), 400);
}

// ===========================================================================
// Evaluate (commit) — Enter
// ===========================================================================
// Serialize evaluations: the wasm engine is a single fiber, so only one
// eval/preview may be in flight at a time. All engine access goes through this
// queue so concurrent Enter presses / preview calls can't interleave fibers.
let engineBusy = false;
const engineQueue = [];
let previewRevision = 0;
function runExclusive(fn) {
  return new Promise((resolve, reject) => {
    engineQueue.push({ fn, resolve, reject });
    pump();
  });
}
async function pump() {
  if (engineBusy) return;
  const job = engineQueue.shift();
  if (!job) return;
  engineBusy = true;
  try { job.resolve(await job.fn()); }
  catch (e) { job.reject(e); }
  finally { engineBusy = false; pump(); }
}

// Run one line through the engine and return its captured output lines.
async function engineEval(line) {
  capture = [];
  await webEval(line);
  const out = capture.slice();
  capture = [];
  return out;
}

async function commit(expr) {
  expr = expr.trim();
  if (!expr || !ready) return;

  previewRevision++;
  hidePreview();
  histCursor = null;
  inputEl.value = '';
  autosize();

  let rec;
  try {
    rec = await runExclusive(async () => {
      const out = await engineEval(expr);
      return { expr, items: parseQalcOutput(out) };
    });
  } catch (e) {
    rec = { expr, items: [{ type: 'error', text: 'Engine error: ' + e }] };
  }

  entries.push(rec);
  renderEntry(rec);
  saveHistory();
  schedulePersist();
  scrollToBottom();
}

// ===========================================================================
// Live preview — as you type (no side effects)
// ===========================================================================
async function updatePreview() {
  if (!ready) return;
  const revision = ++previewRevision;
  const expr = inputEl.value.trim();
  if (!expr || isCommand(expr)) { hidePreview(); return; }

  let raw = '';
  try {
    raw = await runExclusive(() => revision === previewRevision ? webPreview(expr) : '');
  } catch (e) {
    if (revision === previewRevision) hidePreview();
    return;
  }
  if (revision !== previewRevision) return;
  if (!raw) { hidePreview(); return; }

  previewEl.classList.remove('hidden');
  previewEl.setAttribute('aria-hidden', 'false');
  previewEl.innerHTML = '';
  const eq = document.createElement('span');
  eq.className = 'pv-eq';
  eq.textContent = '=';
  previewEl.appendChild(eq);

  const val = document.createElement('span');
  val.className = 'pv-val';
  val.textContent = stripAnsi(raw);
  previewEl.appendChild(val);
}

function hidePreview() {
  previewEl.classList.add('hidden');
  previewEl.setAttribute('aria-hidden', 'true');
  previewEl.innerHTML = '';
}

// A line that is a qalc command / assignment rather than a plain expression:
// don't preview these (they may have side effects or produce no value).
function isCommand(s) {
  if (s[0] === '/') return true;
  const w = s.split(/\s+/)[0].toLowerCase();
  const cmds = new Set([
    'set', 'save', 'store', 'variable', 'function', 'delete', 'assume',
    'base', 'rpn', 'swap', 'clear', 'help', 'info', 'find', 'mode', 'list',
    'exact', 'approximate', 'factor', 'expand', 'quit', 'exit', 'history',
    'keep', 'unkeep', 'convert', 'to', 'MC', 'MS', 'MR', 'M+', 'M-',
  ]);
  // Only treat as command when followed by args or exactly the keyword,
  // so "to" inside "5 km to m" (handled by preview fine) still previews.
  if (cmds.has(w) && (w === 'set' || w === 'save' || w === 'store' ||
      w === 'delete' || w === 'assume' || w === 'clear' || w === 'help' ||
      w === 'info' || w === 'find' || w === 'mode' || w === 'list' ||
      w === 'quit' || w === 'exit' || w === 'history' || w === 'function' ||
      w === 'variable' || w === 'rpn')) return true;
  return false;
}

// ===========================================================================
// Output parsing
// ===========================================================================
// qalc terminal output for one expression is typically:
//   "  <parsed> = <result>"   (indented), possibly multi-'=' with alt forms,
// plus optional message/warning/error lines. We keep the structure simple:
// the last non-empty line that contains '=' is the "result" line; earlier
// non-empty lines are informational (warnings/errors/messages).
function parseQalcOutput(lines) {
  const items = [];
  const cleaned = lines.map((l) => l.replace(/\r/g, ''));
  // Drop leading/trailing blank lines.
  while (cleaned.length && cleaned[0].trim() === '') cleaned.shift();
  while (cleaned.length && cleaned[cleaned.length - 1].trim() === '') cleaned.pop();

  if (!cleaned.length) {
    return [{ type: 'message', text: '(no output)' }];
  }

  for (let i = 0; i < cleaned.length; i++) {
    const rawLine = cleaned[i];
    const line = rawLine.replace(/^\s+/, '');
    if (line.trim() === '') continue;
    const noAnsi = stripAnsi(line);

    // Heuristic classification of messages.
    const lower = noAnsi.toLowerCase();
    let type = 'result';
    if (/^error/.test(lower) || lower.includes('is not a')) type = 'error';
    else if (/^warning/.test(lower)) type = 'warn';

    // The main result line usually contains ' = ' (or an approx sign).
    const looksResult = noAnsi.includes('=') || noAnsi.includes('≈') ||
      (cleaned.length === 1);
    if (type === 'result' && !looksResult) type = 'message';

    items.push({ type, text: rawLine, ansi: rawLine });
  }
  return items;
}

// ===========================================================================
// Rendering entries
// ===========================================================================
function renderEntry(rec) {
  if (welcomeEl && welcomeEl.parentNode) welcomeEl.remove();

  const { expr, items } = rec;
  const entry = document.createElement('div');
  entry.className = 'entry';

  const inRow = document.createElement('div');
  inRow.className = 'entry-input';
  inRow.title = 'Click to reuse';
  const p = document.createElement('span');
  p.className = 'in-prompt';
  p.textContent = '›';
  const inTxt = document.createElement('span');
  inTxt.textContent = expr;
  inRow.append(p, inTxt);
  inRow.addEventListener('click', () => { inputEl.value = expr; inputEl.focus(); autosize(); updatePreview(); });
  entry.appendChild(inRow);

  const resultItems = items.filter((it) => it.type === 'result');
  const msgItems = items.filter((it) => it.type !== 'result');

  for (const it of msgItems) {
    const m = document.createElement('div');
    m.className = 'entry-message ' + (it.type === 'error' ? 'error' : it.type === 'warn' ? 'warn' : '');
    m.textContent = stripAnsi(it.text).trim();
    entry.appendChild(m);
  }

  const hint = document.createElement('div');
  hint.className = 'copy-hint';
  hint.textContent = 'click result to copy';

  renderAnsiResults(entry, resultItems, hint);

  entry.appendChild(hint);
  historyInner.appendChild(entry);
}

function renderAnsiResults(entry, resultItems, hint) {
  for (const it of resultItems) {
    const r = document.createElement('div');
    r.className = 'entry-result';
    r.innerHTML = ansiToHtml(it.text);
    r.setAttribute('data-plain', stripAnsi(it.text).trim());
    attachCopy(r, hint);
    entry.appendChild(r);
  }
}

function attachCopy(el, hint) {
  el.style.cursor = 'pointer';
  el.title = 'Click to copy';
  el.addEventListener('click', () => {
    const text = el.getAttribute('data-plain') || el.textContent;
    navigator.clipboard?.writeText(text.trim());
    const prev = hint.textContent;
    hint.textContent = 'copied!';
    setTimeout(() => (hint.textContent = prev), 1200);
  });
}

// ===========================================================================
// ANSI → HTML (qalc's own color coding)
// ===========================================================================
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(s) { return s.replace(ANSI_RE, ''); }

// Map qalc's ANSI SGR colors to token classes.
function ansiToHtml(s) {
  let html = '';
  let cls = null;
  let bold = false;
  const esc = (txt) => txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const re = /\x1b\[([0-9;]*)m/g;
  let m;
  let last = 0;
  const push = (txt) => {
    if (!txt) return;
    const classes = [];
    if (cls) classes.push(cls);
    if (bold) classes.push('tok-bold');
    if (classes.length) html += `<span class="${classes.join(' ')}">${esc(txt)}</span>`;
    else html += esc(txt);
  };
  while ((m = re.exec(s)) !== null) {
    push(s.slice(last, m.index));
    last = re.lastIndex;
    const codes = m[1].split(';').filter(Boolean).map(Number);
    if (codes.length === 0 || codes.includes(0)) { cls = null; bold = false; }
    for (const c of codes) {
      if (c === 1) bold = true;
      else if (c === 36 || c === 96 || c === 34 || c === 94) cls = 'tok-num';   // cyan/blue → numbers
      else if (c === 32 || c === 92) cls = 'tok-unit';                          // green → units
      else if (c === 33 || c === 93) cls = 'tok-const';                         // yellow → constants/vars
      else if (c === 35 || c === 95) cls = 'tok-var';                           // magenta
      else if (c === 31 || c === 91) cls = 'tok-var';
    }
  }
  push(s.slice(last));
  return html;
}

// ===========================================================================
// History persistence
// ===========================================================================
// Persist the list of committed expressions (results are recomputed on load by
// replaying them once through the engine — which also rebuilds qalc's ans chain
// and any session variables so state matches exactly).
function saveHistory() {
  const exprs = entries.map((e) => e.expr);
  while (exprs.length > MAX_HISTORY) exprs.shift();
  localStorage.setItem(HISTORY_KEY, JSON.stringify(exprs));
}
function loadHistoryArr() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}

// Replay stored expressions through the engine once at startup to rebuild the
// history entries with correct results (respecting persisted config + the ans
// chain).
async function restoreHistory() {
  const hist = loadHistoryArr();
  if (!hist.length) return;
  entries = [];
  await runExclusive(async () => {
    for (const expr of hist) {
      let items;
      try {
        const out = await engineEval(expr);
        items = parseQalcOutput(out);
      } catch { continue; }
      const rec = { expr, items };
      entries.push(rec);
      renderEntry(rec);
    }
  });
  scrollToBottom();
}

// ===========================================================================
// Input handling
// ===========================================================================
inputEl.addEventListener('input', () => { autosize(); updatePreview(); });

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    commit(inputEl.value);
  } else if (e.key === 'ArrowUp' && inputEl.value === '') {
    e.preventDefault();
    recallHistory(-1);
  } else if (e.key === 'ArrowDown' && histCursor !== null) {
    e.preventDefault();
    recallHistory(1);
  }
});

let histCursor = null;
function recallHistory(dir) {
  const hist = loadHistoryArr();
  if (!hist.length) return;
  if (histCursor === null) histCursor = hist.length;
  histCursor += dir;
  if (histCursor < 0) histCursor = 0;
  if (histCursor >= hist.length) { histCursor = null; inputEl.value = ''; autosize(); return; }
  inputEl.value = hist[histCursor];
  autosize();
  updatePreview();
}

function autosize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, window.innerHeight * 0.4) + 'px';
}

function scrollToBottom() {
  requestAnimationFrame(() => { historyEl.scrollTop = historyEl.scrollHeight; });
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
}

// ---- clear history ----
// Only clears the visible/stored history. Settings live in qalc.cfg (IDBFS) and
// are untouched, so precision/base/etc. survive. We deliberately do NOT run
// qalc's "clear history" command (it is unnecessary and only affects qalc's own
// in-memory expression history, not our persisted config).
$('clear-btn').addEventListener('click', () => {
  if (!confirm('Clear all history? (Settings are kept.)')) return;
  localStorage.removeItem(HISTORY_KEY);
  entries = [];
  histCursor = null;
  historyInner.innerHTML = '';
});

// ---- example chips ----
document.addEventListener('click', (e) => {
  const ex = e.target.closest('code.ex');
  if (ex) { inputEl.value = ex.textContent; inputEl.focus(); autosize(); updatePreview(); }
});

// ---- help modal ----
const helpModal = $('help-modal');
$('help-btn').addEventListener('click', () => { fillHelp(); helpModal.classList.remove('hidden'); });
$('help-close').addEventListener('click', () => helpModal.classList.add('hidden'));
helpModal.addEventListener('click', (e) => { if (e.target === helpModal) helpModal.classList.add('hidden'); });

function fillHelp() {
  const body = $('help-body');
  if (body.dataset.filled) return;
  body.dataset.filled = '1';
  body.innerHTML = `
    <h3>Expressions</h3>
    <table>
      <tr><td><code>5 + 3 * 2</code></td><td>arithmetic (exact where possible)</td></tr>
      <tr><td><code>sqrt(2)^2</code></td><td>functions & powers</td></tr>
      <tr><td><code>50 kg to lb</code></td><td>unit conversion</td></tr>
      <tr><td><code>5 km + 3 mi to m</code></td><td>mixed units</td></tr>
      <tr><td><code>d/dx x^3</code></td><td>differentiation</td></tr>
      <tr><td><code>integrate x^2 dx</code></td><td>integration</td></tr>
      <tr><td><code>solve(x^2=4, x)</code></td><td>equation solving</td></tr>
      <tr><td><code>factor 6x^2+11x+3</code></td><td>factorisation</td></tr>
      <tr><td><code>ans * 2</code></td><td>reuse the last answer</td></tr>
      <tr><td><code>1/3 + 1/6</code></td><td>fractions</td></tr>
      <tr><td><code>25% of 80</code></td><td>percentages</td></tr>
      <tr><td><code>(2+3i)^2</code></td><td>complex numbers</td></tr>
    </table>
    <h3>Commands (settings persist automatically)</h3>
    <table>
      <tr><td><code>set precision 30</code></td><td>significant digits</td></tr>
      <tr><td><code>set base 16</code></td><td>output base (2, 8, 16, roman…)</td></tr>
      <tr><td><code>set exact</code> / <code>set approximate</code></td><td>result mode</td></tr>
      <tr><td><code>set angle deg</code></td><td>angle unit</td></tr>
      <tr><td><code>mode</code></td><td>show all current settings</td></tr>
      <tr><td><code>info meter</code></td><td>describe a unit/function</td></tr>
      <tr><td><code>help</code></td><td>full qalc help</td></tr>
    </table>
    <h3>Tips</h3>
    <table>
      <tr><td>Enter</td><td>evaluate · Shift+Enter for newline</td></tr>
      <tr><td>↑ / ↓</td><td>recall previous inputs (empty box)</td></tr>
      <tr><td>Click a result</td><td>copy to clipboard</td></tr>
    </table>`;
}

// Persist config when the page is hidden/closed too.
window.addEventListener('beforeunload', () => { if (ready) syncFS(false); });
document.addEventListener('visibilitychange', () => { if (document.hidden && ready) syncFS(false); });

boot();
