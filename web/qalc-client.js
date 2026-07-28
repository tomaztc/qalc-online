// Main-thread proxy for the worker-owned qalc WebAssembly engine.

import { unsupportedInputReason } from './qalc-input.js';

export { unsupportedInputReason } from './qalc-input.js';

function deserializeError(payload, fallbackMessage) {
  const error = new Error(payload?.message || fallbackMessage);
  error.name = payload?.name || 'Error';
  if (payload?.stack) error.stack = payload.stack;
  return error;
}

export async function createQalcClient(onLoadState = () => {}) {
  const worker = new Worker(new URL('./qalc-worker.js', import.meta.url), { type: 'module' });
  const client = new QalcClient(worker, onLoadState);
  try {
    await client.ready();
    return client;
  } catch (error) {
    client.terminate();
    throw error;
  }
}

class QalcClient {
  #worker;
  #onLoadState;
  #pending = new Map();
  #nextRequestId = 1;
  #engineTail = Promise.resolve();
  #readyPromise;
  #resolveReady;
  #rejectReady;
  #readySettled = false;
  #terminated = false;

  constructor(worker, onLoadState) {
    this.#worker = worker;
    this.#onLoadState = onLoadState;
    this.#readyPromise = new Promise((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });

    worker.addEventListener('message', (event) => this.#handleMessage(event.data));
    worker.addEventListener('error', (event) => {
      this.#fail(new Error(event.message || 'Qalculate worker failed'));
    });
    worker.addEventListener('messageerror', () => {
      this.#fail(new Error('Qalculate worker sent an unreadable response'));
    });
  }

  ready() {
    return this.#readyPromise;
  }

  #handleMessage(message) {
    if (this.#terminated) return;

    if (message?.type === 'load-state') {
      this.#onLoadState(message.state);
      return;
    }
    if (message?.type === 'ready') {
      this.#readySettled = true;
      this.#resolveReady();
      return;
    }
    if (message?.type === 'init-error') {
      this.#fail(deserializeError(message.error, 'Failed to initialize Qalculate worker'));
      return;
    }
    if (message?.type !== 'response') return;

    const request = this.#pending.get(message.id);
    if (!request) return;
    this.#pending.delete(message.id);
    if (message.error) {
      request.reject(deserializeError(message.error, 'Qalculate worker operation failed'));
    } else {
      request.resolve(message.result);
    }
  }

  #fail(error) {
    if (this.#terminated) return;
    if (!this.#readySettled) {
      this.#readySettled = true;
      this.#rejectReady(error);
    }
    for (const request of this.#pending.values()) request.reject(error);
    this.#pending.clear();
    this.#worker.terminate();
    this.#terminated = true;
  }

  #request(method, args) {
    if (this.#terminated) return Promise.reject(new Error('Qalculate worker is unavailable'));

    const id = this.#nextRequestId;
    this.#nextRequestId += 1;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      try {
        this.#worker.postMessage({ id, method, args });
      } catch (error) {
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  // Preserve the asynchronous engine queue on the UI side. Besides maintaining
  // call order, this lets stale previews be discarded before they reach the worker.
  #runExclusive(operation) {
    const result = this.#engineTail.then(operation);
    this.#engineTail = result.catch(() => {});
    return result;
  }

  async evaluate(expression, { refreshExchangeRates = true } = {}) {
    const unsupported = unsupportedInputReason(expression);
    if (unsupported) throw new Error(`Unsupported input: ${unsupported}.`);
    return this.#runExclusive(
      () => this.#request('evaluate', [expression, { refreshExchangeRates }]),
    );
  }

  async evaluateWithExchangeRates(expression) {
    const unsupported = unsupportedInputReason(expression);
    if (unsupported) throw new Error(`Unsupported input: ${unsupported}.`);
    return this.#runExclusive(
      () => this.#request('evaluateWithExchangeRates', [expression]),
    );
  }

  preview(expression, isCurrent = () => true) {
    if (unsupportedInputReason(expression)) return Promise.resolve('');
    return this.#runExclusive(
      () => (isCurrent() ? this.#request('preview', [expression]) : ''),
    );
  }

  whenIdle() {
    return this.#runExclusive(() => {});
  }

  terminate() {
    if (this.#terminated) return;
    const error = new Error('Qalculate worker was terminated');
    if (!this.#readySettled) {
      this.#readySettled = true;
      this.#rejectReady(error);
    }
    for (const request of this.#pending.values()) request.reject(error);
    this.#pending.clear();
    this.#worker.terminate();
    this.#terminated = true;
  }
}
