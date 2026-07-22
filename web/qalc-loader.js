// This stable, tracked boundary keeps generated Emscripten output out of tests.
import createQalcModule from './qalc.mjs';

const WASM_URL = new URL('./qalc.wasm', import.meta.url);

async function downloadWasm(reportProgress) {
  const response = await fetch(WASM_URL, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());

  const total = Number(response.headers.get('content-length'));
  if (!response.body || !Number.isFinite(total) || total <= 0) {
    const binary = new Uint8Array(await response.arrayBuffer());
    reportProgress(100);
    return binary;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    reportProgress(Math.min(100, Math.round((loaded / total) * 100)));
  }

  const binary = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    binary.set(chunk, offset);
    offset += chunk.byteLength;
  }
  reportProgress(100);
  return binary;
}

export default async function QalcModule(options = {}) {
  const { onLoadState, ...moduleOptions } = options;
  let lastProgress = -1;
  const reportProgress = (progress) => {
    const nextProgress = Math.max(lastProgress, Math.min(100, Math.round(progress)));
    if (nextProgress === lastProgress) return;
    lastProgress = nextProgress;
    onLoadState?.({ phase: 'download', percent: nextProgress });
  };

  reportProgress(0);
  const wasmBinary = await downloadWasm(reportProgress);
  onLoadState?.({ phase: 'compile' });
  const module = await createQalcModule({ ...moduleOptions, wasmBinary });
  return module;
}
