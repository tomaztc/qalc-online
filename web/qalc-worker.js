// Dedicated worker that exclusively owns the Wasm module and qalc session.

import { createQalcEngine } from './qalc-engine.js';

const OPERATIONS = new Set(['evaluate', 'evaluateWithExchangeRates', 'preview']);
let engine;

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack,
  };
}

self.addEventListener('message', async (event) => {
  const { id, method, args = [] } = event.data || {};
  try {
    if (!engine) throw new Error('Qalculate engine is not ready');
    if (!OPERATIONS.has(method)) throw new Error(`Unknown engine operation: ${method}`);
    const result = await engine[method](...args);
    self.postMessage({ type: 'response', id, result });
  } catch (error) {
    self.postMessage({ type: 'response', id, error: serializeError(error) });
  }
});

try {
  engine = await createQalcEngine((state) => {
    self.postMessage({ type: 'load-state', state });
  });
  self.postMessage({ type: 'ready' });
} catch (error) {
  self.postMessage({ type: 'init-error', error: serializeError(error) });
}
