import { fireEvent, waitFor } from '@testing-library/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { moduleFactory } = vi.hoisted(() => ({ moduleFactory: vi.fn() }));

vi.mock('../../web/qalc-loader.js', () => ({
  default: (...args) => moduleFactory(...args),
}));

const page = `
  <main id="history"><div id="history-inner"></div></main>
  <div id="preview" class="hidden" aria-hidden="true"></div>
  <textarea id="expr"></textarea>
  <div id="status"></div>
  <button id="theme-btn"></button>
  <button id="clear-btn"></button>
  <button id="help-btn"></button>
  <div id="help-modal" class="hidden"><button id="help-close"></button><div id="help-body"><code class="ex">3 * 3</code></div></div>`;

function makeEngine({
  outputs = {},
  preview = (expr) => `preview:${expr}`,
  failBoot,
  loadStates = [],
  loadGate,
  storedRates = JSON.stringify({ date: new Date().toISOString().slice(0, 10), eur: { eur: 1 } }),
} = {}) {
  let print;
  const calls = [];
  const functions = {
    qalc_web_start: vi.fn(async () => {}),
    qalc_web_eval: vi.fn(async (expr) => {
      calls.push(expr);
      for (const line of outputs[expr] || [`  ${expr} = result`]) print(line);
    }),
    qalc_web_preview: vi.fn(preview),
    qalc_web_set_userdir: vi.fn(),
  };
  const fs = {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn((path) => {
      if (storedRates === null) throw new Error('ENOENT');
      if (path.endsWith('eurofxref-daily.xml')) {
        return `<Cube time='${JSON.parse(storedRates).date}'>`;
      }
      return storedRates;
    }),
  };
  const engine = {
    FS: fs,
    cwrap: vi.fn((name) => functions[name]),
  };
  moduleFactory.mockImplementation(async (options) => {
    if (failBoot) throw new Error('load failed');
    print = options.print;
    for (const state of loadStates) options.onLoadState(state);
    if (loadGate) await loadGate;
    return engine;
  });
  return { calls, engine, functions };
}

async function loadApp() {
  document.body.innerHTML = page;
  await import('../../web/app.js');
  await waitFor(() => expect(document.querySelector('#status')).toHaveClass('ready'));
}

function submit(value) {
  const input = document.querySelector('#expr');
  input.value = value;
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('application boot', () => {
  beforeEach(() => { moduleFactory.mockReset(); });

  it('creates a session-only qalc directory before starting', async () => {
    const { engine, functions } = makeEngine();
    await loadApp();

    expect(engine.FS.mkdir).toHaveBeenCalledWith('/qalc');
    expect(engine).not.toHaveProperty('IDBFS');
    expect(engine.FS).not.toHaveProperty('syncfs');
    expect(functions.qalc_web_set_userdir).toHaveBeenCalledWith('/qalc');
    expect(functions.qalc_web_start).toHaveBeenCalledOnce();
    expect(functions.qalc_web_eval).not.toHaveBeenCalled();
    expect(document.querySelector('#status')).toBeEmptyDOMElement();
    expect(document.querySelector('#expr')).toHaveFocus();
  });

  it('updates stale exchange rates before accepting the first command', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rates = JSON.stringify({ date: today, eur: { eur: 1, usd: 2 } });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => rates })
      .mockRejectedValueOnce(new Error('Coinbase unavailable')));
    const { functions, engine } = makeEngine({
      storedRates: JSON.stringify({ date: '2000-01-01', eur: { eur: 1 } }),
    });

    await loadApp();

    expect(engine.FS.writeFile).toHaveBeenCalledWith('/qalc/rates.json', rates);
    expect(functions.qalc_web_eval).toHaveBeenCalledOnce();
    expect(functions.qalc_web_eval).toHaveBeenCalledWith('exrates');
  });

  it('reports an engine loading failure', async () => {
    makeEngine({ failBoot: true });
    document.body.innerHTML = page;
    await import('../../web/app.js');

    await waitFor(() => expect(document.querySelector('#status')).toHaveTextContent('Failed to load engine: Error: load failed'));
    expect(document.querySelector('#status')).toHaveClass('error');
  });

  it('shows byte progress while downloading the engine', async () => {
    let finishLoading;
    const loadGate = new Promise((resolve) => { finishLoading = resolve; });
    makeEngine({
      loadStates: [
        { phase: 'download', percent: 18 },
        { phase: 'download', percent: 67 },
      ],
      loadGate,
    });
    document.body.innerHTML = page;
    await import('../../web/app.js');

    await waitFor(() => expect(document.querySelector('#status'))
      .toHaveTextContent('Downloading engine… 67%'));
    expect(document.querySelector('#status')).toHaveClass('loading');

    finishLoading();
    await waitFor(() => expect(document.querySelector('#status')).toHaveClass('ready'));
  });

  it('opens the help dialog and sends a selected example to the input', async () => {
    makeEngine();
    await loadApp();

    fireEvent.click(document.querySelector('#help-btn'));
    expect(document.querySelector('#help-modal')).not.toHaveClass('hidden');
    expect(document.querySelector('#help-close')).toHaveFocus();

    fireEvent.click(document.querySelector('#help-body .ex'));
    expect(document.querySelector('#help-modal')).toHaveClass('hidden');
    expect(document.querySelector('#expr')).toHaveValue('3 * 3');
    expect(document.querySelector('#expr')).toHaveFocus();
  });

  it('defaults to the system theme and toggles between dark and light', async () => {
    makeEngine();
    await loadApp();
    const themeButton = document.querySelector('#theme-btn');

    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(themeButton).toHaveTextContent('Dark');
    expect(themeButton).toHaveAttribute('aria-label', 'Switch to dark theme');

    fireEvent.click(themeButton);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(themeButton).toHaveTextContent('Light');
    expect(localStorage.getItem('qalc.theme.v1')).toBe('dark');

    fireEvent.click(themeButton);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(themeButton).toHaveTextContent('Dark');
    expect(localStorage.getItem('qalc.theme.v1')).toBe('light');
  });

  it('restores a saved theme preference instead of the system theme', async () => {
    localStorage.setItem('qalc.theme.v1', 'dark');
    makeEngine();
    await loadApp();

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(document.querySelector('#theme-btn')).toHaveTextContent('Light');
  });

  it('offers Light when the system defaults to dark', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    makeEngine();
    await loadApp();

    expect(document.documentElement).not.toHaveAttribute('data-theme');
    expect(document.querySelector('#theme-btn')).toHaveTextContent('Light');
  });
});

describe('preview and committed evaluation', () => {
  beforeEach(() => { moduleFactory.mockReset(); });

  it('shows side-effect-free previews with ANSI token styling and suppresses commands', async () => {
    const { functions } = makeEngine({ preview: () => '\u001b[36m2\u001b[0m' });
    await loadApp();
    const input = document.querySelector('#expr');

    fireEvent.input(input, { target: { value: '1 + 1' } });
    await waitFor(() => expect(document.querySelector('#preview')).toHaveTextContent('=2'));
    expect(document.querySelector('#preview')).toHaveAttribute('aria-hidden', 'false');
    expect(document.querySelector('#preview .tok-num')).toHaveTextContent('2');

    fireEvent.input(input, { target: { value: 'set precision 30' } });
    expect(document.querySelector('#preview')).toHaveClass('hidden');

    fireEvent.input(input, { target: { value: '# a comment' } });
    expect(document.querySelector('#preview')).toHaveClass('hidden');
    expect(functions.qalc_web_preview).toHaveBeenCalledTimes(1);
  });

  it('replaces typed ASCII plus/minus forms with the qalc Unicode operator', async () => {
    const { functions } = makeEngine();
    await loadApp();
    const input = document.querySelector('#expr');

    input.value = '5 +/- 1';
    input.setSelectionRange(5, 5);
    fireEvent.input(input);

    expect(input).toHaveValue('5 ± 1');
    expect(input.selectionStart).toBe(3);
    await waitFor(() => expect(functions.qalc_web_preview).toHaveBeenCalledWith('5 ± 1'));

    fireEvent.input(input, { target: { value: '8 +- 2' } });
    expect(input).toHaveValue('8 ± 2');
  });

  it('debounces rapid input and previews only the latest expression', async () => {
    const { functions } = makeEngine();
    await loadApp();
    const input = document.querySelector('#expr');

    fireEvent.input(input, { target: { value: '1' } });
    fireEvent.input(input, { target: { value: '1 +' } });
    fireEvent.input(input, { target: { value: '1 + 1' } });

    await waitFor(() => expect(functions.qalc_web_preview).toHaveBeenCalledOnce());
    expect(functions.qalc_web_preview).toHaveBeenCalledWith('1 + 1');
  });

  it('serializes previews with evaluations and discards stale preview results', async () => {
    let finishEvaluation;
    const { functions } = makeEngine({ preview: (expr) => `preview:${expr}` });
    functions.qalc_web_eval.mockImplementation(() => new Promise((resolve) => {
      finishEvaluation = resolve;
    }));
    await loadApp();

    submit('slow');
    await waitFor(() => expect(finishEvaluation).toBeTypeOf('function'));
    const input = document.querySelector('#expr');
    fireEvent.input(input, { target: { value: 'old' } });
    fireEvent.input(input, { target: { value: 'new' } });
    expect(functions.qalc_web_preview).not.toHaveBeenCalled();

    finishEvaluation();
    await waitFor(() => expect(functions.qalc_web_preview).toHaveBeenCalledOnce());
    expect(functions.qalc_web_preview).toHaveBeenCalledWith('new');
    await waitFor(() => expect(document.querySelector('#preview')).toHaveTextContent('preview:new'));
    expect(document.querySelector('#preview')).not.toHaveTextContent('preview:old');
  });

  it('commits through the REPL, classifies output, and saves only expressions', async () => {
    makeEngine({ outputs: {
      'bad input': ['', 'Warning: check this', 'Error: invalid', ''],
    } });
    await loadApp();

    submit('  bad input  ');
    await waitFor(() => expect(document.querySelectorAll('.entry')).toHaveLength(1));

    expect(document.querySelector('.entry-input')).toHaveTextContent('bad input');
    expect(document.querySelector('.warn')).toHaveTextContent('Warning: check this');
    expect(document.querySelector('.error')).toHaveTextContent('Error: invalid');
    expect(localStorage.getItem('qalc.history.v1')).toBe('["bad input"]');
  });

  it('colors every continuation line of a multiline warning', async () => {
    makeEngine({ outputs: {
      uncertain: [
        'Warning: result might be misleading',
        'because the interval is very wide',
        '  uncertain = 1 ± 1',
      ],
    } });
    await loadApp();

    submit('uncertain');
    await waitFor(() => expect(document.querySelectorAll('.entry-message.warn')).toHaveLength(2));

    expect([...document.querySelectorAll('.entry-message.warn')].map((line) => line.textContent))
      .toEqual(['Warning: result might be misleading', 'because the interval is very wide']);
    expect(document.querySelector('.entry-result')).toHaveTextContent('uncertain = 1 ± 1');
  });

  it('colors every continuation line of a multiline error', async () => {
    makeEngine({ outputs: {
      invalid: [
        'Error: cannot evaluate this expression',
        'because its argument is outside the allowed range',
      ],
    } });
    await loadApp();

    submit('invalid');
    await waitFor(() => expect(document.querySelectorAll('.entry-message.error')).toHaveLength(2));

    expect([...document.querySelectorAll('.entry-message.error')].map((line) => line.textContent))
      .toEqual([
        'Error: cannot evaluate this expression',
        'because its argument is outside the allowed range',
      ]);
  });

  it('escapes engine output while preserving ANSI token styling', async () => {
    makeEngine({ outputs: { x: ['  x = \u001b[32m<unit>&\u001b[0m'] } });
    await loadApp();
    submit('x');

    await waitFor(() => expect(document.querySelector('.entry-result')).not.toBeNull());
    expect(document.querySelector('.entry-result')).toHaveTextContent('x = <unit>&');
    expect(document.querySelector('.entry-result .tok-unit')).toHaveTextContent('<unit>&');
    expect(document.querySelector('.entry-result').querySelector('unit')).toBeNull();
  });

  it('serializes rapid evaluations through the single engine queue', async () => {
    const pending = [];
    let active = 0;
    let maxActive = 0;
    const { functions } = makeEngine();
    functions.qalc_web_eval.mockImplementation((expr) => new Promise((resolve) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      pending.push({ expr, resolve: () => { active -= 1; resolve(); } });
    }));
    await loadApp();

    submit('first');
    submit('second');
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].expr).toBe('first');
    pending.shift().resolve();
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].expr).toBe('second');
    pending.shift().resolve();
    await waitFor(() => expect(document.querySelectorAll('.entry')).toHaveLength(2));
    expect(maxActive).toBe(1);
  });

  it('keeps the engine queue usable after an evaluation fails', async () => {
    const { functions } = makeEngine();
    functions.qalc_web_eval.mockRejectedValueOnce(new Error('temporary failure'));
    await loadApp();

    submit('first');
    await waitFor(() => expect(document.querySelector('.entry-message.error')).toHaveTextContent('temporary failure'));
    submit('second');

    await waitFor(() => expect(document.querySelectorAll('.entry')).toHaveLength(2));
    expect(document.querySelectorAll('.entry-result')[0]).toHaveTextContent('second = result');
  });

  it('downloads live rates before sending exrates through the qalc REPL', async () => {
    const rates = JSON.stringify({ date: '2026-07-22', eur: { eur: 1, usd: 1.17 } });
    const bitcoin = JSON.stringify({ data: { amount: '101234.56', currency: 'EUR' } });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, text: async () => rates })
      .mockResolvedValueOnce({ ok: true, text: async () => bitcoin }));
    const { engine, functions } = makeEngine({ outputs: { exrates: ['Exchange rates updated.'] } });
    await loadApp();

    submit('exrates');

    await waitFor(() => expect(functions.qalc_web_eval).toHaveBeenCalledWith('exrates'));
    expect(engine.FS.writeFile).toHaveBeenCalledWith('/qalc/rates.json', rates);
    expect(engine.FS.writeFile).toHaveBeenCalledWith(
      '/qalc/eurofxref-daily.xml',
      expect.stringContaining("<Cube currency='USD' rate='1.17'/>")
    );
    expect(engine.FS.writeFile).toHaveBeenCalledWith('/qalc/btc.json', bitcoin);
    expect(document.querySelector('.entry-result')).toHaveTextContent('Exchange rates updated.');
  });

  it('uses the fallback rate provider and keeps daily BTC when Coinbase fails', async () => {
    const rates = JSON.stringify({ date: '2026-07-22', eur: { eur: 1, gbp: 0.87 } });
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(new Error('primary unavailable'))
      .mockResolvedValueOnce({ ok: true, text: async () => rates })
      .mockRejectedValueOnce(new Error('Coinbase unavailable')));
    const { engine, functions } = makeEngine();
    await loadApp();

    submit('/exrates');

    await waitFor(() => expect(functions.qalc_web_eval).toHaveBeenCalledWith('/exrates'));
    expect(engine.FS.writeFile).toHaveBeenCalledTimes(2);
    expect(engine.FS.writeFile).toHaveBeenCalledWith('/qalc/rates.json', rates);
    expect(engine.FS.writeFile).toHaveBeenCalledWith(
      '/qalc/eurofxref-daily.xml',
      expect.stringContaining("<Cube currency='GBP' rate='0.87'/>")
    );
  });

  it('reuses inputs while results remain non-interactive', async () => {
    const { functions } = makeEngine();
    await loadApp();
    submit('2 + 2');
    await waitFor(() => expect(document.querySelector('.entry-result')).not.toBeNull());

    fireEvent.click(document.querySelector('.entry-input'));
    expect(document.querySelector('#expr')).toHaveValue('2 + 2');
    await waitFor(() => expect(functions.qalc_web_preview).toHaveBeenCalledWith('2 + 2'));

    expect(document.querySelector('.entry-result').tagName).toBe('DIV');
    fireEvent.click(document.querySelector('.entry-result'));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(document.querySelector('.copy-hint')).toBeNull();
  });

  it.each([
    'history', 'clear history', 'clear', 'quit', 'exit',
    'set completion on', 'set max history 10', 'set prompt hello',
    'set sigint action interrupt', 'set update exchange rates 1',
    'plot(x^2; -5; 5)', '1 + command("date")',
  ])('blocks unavailable input without calling qalc: %s', async (expression) => {
    const { functions } = makeEngine();
    await loadApp();

    submit(expression);

    await waitFor(() => expect(document.querySelector('.entry-message.error')).toHaveTextContent('Unavailable:'));
    expect(functions.qalc_web_eval).not.toHaveBeenCalled();
    expect(localStorage.getItem('qalc.history.v1')).toBeNull();
  });
});

describe('history persistence and state restoration', () => {
  beforeEach(() => { moduleFactory.mockReset(); });

  it('replays stored expressions in order to restore state and ans', async () => {
    localStorage.setItem('qalc.history.v1', JSON.stringify(['2 + 2', 'ans * 3']));
    const { calls } = makeEngine();
    await loadApp();

    await waitFor(() => expect(document.querySelectorAll('.entry')).toHaveLength(2));
    expect(calls).toEqual(['2 + 2', 'ans * 3']);
    expect([...document.querySelectorAll('.entry-input')].map((entry) => entry.textContent))
      .toEqual(['›ans * 3', '›2 + 2']);
  });

  it('ignores invalid history values without limiting restored history', async () => {
    const stored = [null, 123, '', ...Array.from({ length: 205 }, (_, index) => `expr ${index}`)];
    localStorage.setItem('qalc.history.v1', JSON.stringify(stored));
    const { calls } = makeEngine();
    await loadApp();

    expect(calls).toHaveLength(205);
    expect(calls[0]).toBe('expr 0');
    expect(calls.at(-1)).toBe('expr 204');
    expect(document.querySelectorAll('.entry')).toHaveLength(205);
  });

  it('recalls history with arrow keys', async () => {
    localStorage.setItem('qalc.history.v1', JSON.stringify(['one', 'two']));
    makeEngine();
    await loadApp();
    const input = document.querySelector('#expr');
    await waitFor(() => expect(document.querySelectorAll('.entry')).toHaveLength(2));

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveValue('two');
    input.value = '';
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveValue('one');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveValue('two');
  });

  it('clears UI history with one confirmation and leaves the current engine running', async () => {
    localStorage.setItem('qalc.history.v1', JSON.stringify(['1 + 1']));
    const { functions } = makeEngine();
    await loadApp();
    await waitFor(() => expect(document.querySelectorAll('.entry')).toHaveLength(1));
    confirm.mockReturnValueOnce(true);

    fireEvent.click(document.querySelector('#clear-btn'));

    expect(localStorage.getItem('qalc.history.v1')).toBeNull();
    expect(document.querySelectorAll('.entry')).toHaveLength(0);
    expect(functions.qalc_web_eval).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledOnce();
  });
});
