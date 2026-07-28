// Worker-owned implementation around the real qalc WebAssembly REPL.

import QalcModule from './qalc-loader.js';
import { unsupportedInputReason } from './qalc-input.js';

const CONFIG_DIR = '/qalc';
const EXCHANGE_RATES_FILE = `${CONFIG_DIR}/rates.json`;
const ECB_RATES_FILE = `${CONFIG_DIR}/eurofxref-daily.xml`;
const BITCOIN_RATE_FILE = `${CONFIG_DIR}/btc.json`;
const EXCHANGE_RATE_URLS = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json',
  'https://latest.currency-api.pages.dev/v1/currencies/eur.json',
];
const BITCOIN_RATE_URL = 'https://api.coinbase.com/v2/prices/BTC-EUR/spot';
const FETCH_TIMEOUT_MS = 15_000;
const ECB_CURRENCIES = [
  'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'GBP', 'HKD', 'HUF',
  'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD',
  'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
];

function isExchangeRatesCommand(expression) {
  return /^\/?exrates$/i.test(expression.trim());
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseGeneralRates(text) {
  try {
    const payload = JSON.parse(text);
    return /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
      && payload.eur
      && typeof payload.eur === 'object'
      && payload.eur.eur === 1
      ? payload
      : null;
  } catch {
    return null;
  }
}

function buildEcbRatesXml(payload) {
  const rates = ECB_CURRENCIES
    .filter((currency) => Number.isFinite(payload.eur[currency.toLowerCase()]))
    .map((currency) => `      <Cube currency='${currency}' rate='${payload.eur[currency.toLowerCase()]}'/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Envelope>
  <Cube>
    <Cube time='${payload.date}'>
${rates}
    </Cube>
  </Cube>
</Envelope>
`;
}

function validBitcoinRate(text) {
  try {
    const payload = JSON.parse(text);
    return payload.data?.currency === 'EUR'
      && Number.isFinite(Number(payload.data?.amount));
  } catch {
    return false;
  }
}

async function downloadExchangeRates() {
  let lastError;
  let generalRates;
  let ecbRates;
  for (const url of EXCHANGE_RATE_URLS) {
    try {
      const text = await fetchText(url);
      const payload = parseGeneralRates(text);
      if (!payload) throw new Error('invalid response');
      generalRates = text;
      ecbRates = buildEcbRatesXml(payload);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!generalRates) throw new Error(`all exchange-rate providers failed (${lastError})`);

  // Coinbase is optional: the general feed also contains BTC, but this gives
  // qalc the fresher spot rate when the endpoint is reachable.
  let bitcoinRate;
  try {
    const text = await fetchText(BITCOIN_RATE_URL);
    if (validBitcoinRate(text)) bitcoinRate = text;
  } catch {
    // Keep the daily BTC rate from the general feed.
  }
  return { generalRates, ecbRates, bitcoinRate };
}

export async function createQalcEngine(onLoadState = () => {}) {
  const output = [];
  const module = await QalcModule({
    print: (text) => output.push(text),
    printErr: (text) => output.push(text),
    onLoadState,
  });
  module.FS.mkdir(CONFIG_DIR);

  const start = module.cwrap('qalc_web_start', null, [], { async: true });
  const evaluate = module.cwrap('qalc_web_eval', null, ['string'], { async: true });
  const preview = module.cwrap('qalc_web_preview', 'string', ['string']);
  const usesExchangeRates = module.cwrap(
    'qalc_web_uses_exchange_rates', 'number', ['string'],
  );
  module.cwrap('qalc_web_set_userdir', null, ['string'])(CONFIG_DIR);

  output.length = 0;
  onLoadState({ phase: 'start' });
  await start();
  output.length = 0;
  return new QalcEngine(module, output, evaluate, preview, usesExchangeRates);
}

class QalcEngine {
  #module;
  #output;
  #evaluate;
  #preview;
  #usesExchangeRates;
  #engineTail = Promise.resolve();
  #exchangeRatesRequested = false;

  constructor(module, output, evaluate, preview, usesExchangeRates) {
    this.#module = module;
    this.#output = output;
    this.#evaluate = evaluate;
    this.#preview = preview;
    this.#usesExchangeRates = usesExchangeRates;
  }

  // This is the definitive single entry point into the stateful Wasm engine.
  // A failed operation does not poison subsequent work.
  #runExclusive(operation) {
    const result = this.#engineTail.then(operation);
    this.#engineTail = result.catch(() => {});
    return result;
  }

  async #installExchangeRates() {
    const { generalRates, ecbRates, bitcoinRate } = await downloadExchangeRates();
    this.#module.FS.writeFile(EXCHANGE_RATES_FILE, generalRates);
    this.#module.FS.writeFile(ECB_RATES_FILE, ecbRates);
    if (bitcoinRate) this.#module.FS.writeFile(BITCOIN_RATE_FILE, bitcoinRate);
    return parseGeneralRates(generalRates).date;
  }

  async #captureEvaluation(expression) {
    this.#output.length = 0;
    try {
      await this.#evaluate(expression);
      return this.#output.slice();
    } finally {
      this.#output.length = 0;
    }
  }

  async #evaluateExchangeRatesCommand() {
    try {
      const date = await this.#installExchangeRates();
      console.log(`Qalculate: exchange rates updated (${date}).`);
    } catch (error) {
      console.warn(`Qalculate: exchange-rate update failed; using stored rates. ${error}`);
    }
    return this.#captureEvaluation('exrates');
  }

  async evaluate(expression, { refreshExchangeRates = true } = {}) {
    const unsupported = unsupportedInputReason(expression);
    if (unsupported) throw new Error(`Unsupported input: ${unsupported}.`);

    return this.#runExclusive(async () => {
      if (refreshExchangeRates && isExchangeRatesCommand(expression)) {
        this.#exchangeRatesRequested = true;
        return this.#evaluateExchangeRatesCommand();
      }
      return this.#captureEvaluation(expression);
    });
  }

  async evaluateWithExchangeRates(expression) {
    const unsupported = unsupportedInputReason(expression);
    if (unsupported) throw new Error(`Unsupported input: ${unsupported}.`);

    return this.#runExclusive(async () => {
      const evaluations = [];
      if (!this.#exchangeRatesRequested
        && !isExchangeRatesCommand(expression)
        && this.#usesExchangeRates(expression)) {
        this.#exchangeRatesRequested = true;
        evaluations.push({
          expression: 'exrates',
          lines: await this.#evaluateExchangeRatesCommand(),
        });
      }

      if (isExchangeRatesCommand(expression)) {
        this.#exchangeRatesRequested = true;
        evaluations.push({
          expression,
          lines: await this.#evaluateExchangeRatesCommand(),
        });
      } else {
        evaluations.push({
          expression,
          lines: await this.#captureEvaluation(expression),
        });
      }
      return evaluations;
    });
  }

  preview(expression) {
    if (unsupportedInputReason(expression)) return Promise.resolve('');
    return this.#runExclusive(() => this.#preview(expression));
  }
}
