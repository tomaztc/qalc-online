const UNSUPPORTED_COMMANDS = new Map([
  ['history', 'qalc history is unavailable'],
  ['clear history', 'use the Clear button instead'],
  ['clear', 'use the Clear button instead'],
  ['quit', 'use the Clear button instead'],
  ['exit', 'use the Clear button instead'],
]);
const UNSUPPORTED_SETTINGS = new Map([
  ['calculate as you type', 'the webapp always provides its own live preview'],
  ['autocalc', 'the webapp always provides its own live preview'],
  ['completion', 'readline completion is unavailable in the browser'],
  ['clear history', 'qalc terminal history is unavailable in the browser'],
  ['max history', 'browser history is not limited by qalc'],
  ['prompt', 'the webapp uses its own prompt'],
  ['sigint action', 'terminal signals are unavailable in the browser'],
  ['sigint', 'terminal signals are unavailable in the browser'],
  ['update exchange rates', 'the webapp updates exchange rates automatically'],
  ['upxrates', 'the webapp updates exchange rates automatically'],
]);

export function unsupportedInputReason(expression) {
  const input = expression.trim().replace(/^\/\s*/, '');
  const normalized = input.toLowerCase().replace(/\s+/g, ' ');
  if (UNSUPPORTED_COMMANDS.has(normalized)) return UNSUPPORTED_COMMANDS.get(normalized);

  const setting = normalized.match(/^set (.+)$/)?.[1];
  if (setting) {
    for (const [option, reason] of UNSUPPORTED_SETTINGS) {
      if (setting === option || setting.startsWith(`${option} `)) return reason;
    }
  }

  if (/^plot\b/i.test(input) || /\bplot\s*\(/i.test(input)) {
    return 'plotting is not available in this browser build';
  }
  if (/^command\b/i.test(input) || /\bcommand\s*\(/i.test(input)) {
    return 'external commands cannot run in the browser';
  }
  return null;
}
