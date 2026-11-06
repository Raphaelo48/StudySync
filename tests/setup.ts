/**
 * Глобальная настройка Jest: гасим шумные логи, добавляем отсутствующие API.
 */

// Консоль в тестах не нужна (logger пишет только в __DEV__)
if (typeof (globalThis as { __DEV__?: boolean }).__DEV__ === 'undefined') {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
}

const originalError = console.error;
const originalWarn = console.warn;
console.error = (...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.includes('Not implemented:') || msg.includes('useNativeDriver')) return;
  originalError(...(args as []));
};
console.warn = (...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.includes('Animated') || msg.includes('useNativeDriver')) return;
  originalWarn(...(args as []));
};
