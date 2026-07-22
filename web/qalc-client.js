import QalcModule from './qalc-loader.js';

const CONFIG_DIR = '/qalc';
const PERSIST_DELAY_MS = 400;
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

function syncFileSystem(module, fromDatabase) {
  return new Promise((resolve, reject) => {
    module.FS.syncfs(fromDatabase, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function mountConfig(module) {
  try {
    module.FS.mkdir(CONFIG_DIR);
    module.FS.mount(module.IDBFS, {}, CONFIG_DIR);
  } catch (error) {
    console.warn('IDBFS unavailable, config will not persist:', error);
    return false;
  }

  try {
    await syncFileSystem(module, true);
  } catch (error) {
    // The mount is still usable for this session, and a later flush may recover.
    console.warn('Could not restore qalc settings:', error);
  }
  return true;
}

export async function createQalcClient() {
  const output = [];
  const module = await QalcModule({
    print: (text) => output.push(text),
    printErr: (text) => output.push(text),
  });
  const configMounted = await mountConfig(module);

  const start = module.cwrap('qalc_web_start', null, [], { async: true });
  const evaluate = module.cwrap('qalc_web_eval', null, ['string'], { async: true });
  const preview = module.cwrap('qalc_web_preview', 'string', ['string']);
  if (configMounted) {
    module.cwrap('qalc_web_set_userdir', null, ['string'])(CONFIG_DIR);
  }

  output.length = 0;
  await start();
  output.length = 0;
  return new QalcClient(module, output, evaluate, preview, configMounted);
}

class QalcClient {
  #module;
  #output;
  #evaluate;
  #preview;
  #configMounted;
  #engineTail = Promise.resolve();
  #syncTail = Promise.resolve();
  #persistTimer;

  constructor(module, output, evaluate, preview, configMounted) {
    this.#module = module;
    this.#output = output;
    this.#evaluate = evaluate;
    this.#preview = preview;
    this.#configMounted = configMounted;
  }

  // The engine uses cooperative fibers, so every call crosses one serialized
  // boundary. Keeping the queue here prevents future UI features from bypassing
  // that invariant. A failed operation does not poison subsequent work.
  #runExclusive(operation) {
    const result = this.#engineTail.then(operation);
    this.#engineTail = result.catch(() => {});
    return result;
  }

  async evaluate(expression, { persist = true } = {}) {
    const lines = await this.#runExclusive(async () => {
      this.#output.length = 0;
      try {
        if (persist && isExchangeRatesCommand(expression)) {
          const { generalRates, ecbRates, bitcoinRate } = await downloadExchangeRates();
          this.#module.FS.writeFile(EXCHANGE_RATES_FILE, generalRates);
          this.#module.FS.writeFile(ECB_RATES_FILE, ecbRates);
          if (bitcoinRate) this.#module.FS.writeFile(BITCOIN_RATE_FILE, bitcoinRate);
        }
        await this.#evaluate(expression);
        return this.#output.slice();
      } finally {
        this.#output.length = 0;
      }
    });
    if (persist) this.persistSoon();
    return lines;
  }

  preview(expression, isCurrent = () => true) {
    return this.#runExclusive(() => (isCurrent() ? this.#preview(expression) : ''));
  }

  persistSoon() {
    if (!this.#configMounted) return;
    clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => this.flush(), PERSIST_DELAY_MS);
  }

  flush() {
    clearTimeout(this.#persistTimer);
    if (!this.#configMounted) return Promise.resolve();

    const result = this.#syncTail.then(() => syncFileSystem(this.#module, false));
    this.#syncTail = result.catch((error) => {
      console.warn('Could not persist qalc settings:', error);
    });
    return this.#syncTail;
  }
}
