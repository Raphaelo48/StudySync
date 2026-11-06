/**
 * Журнал разработки.
 *
 * Правила приватности:
 * - В журнал НЕ пишутся пользовательские данные (названия задач, имена, расписание).
 * - Допускаются только технические сообщения и идентификаторы сущностей.
 * - В release-сборке вывод в консоль отключается (флаг __DEV__).
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const PREFIX = '[StudySync]';

function emit(level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>) {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) return;
  const line = `${PREFIX} ${level.toUpperCase()} ${scope}: ${message}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta && Object.keys(meta).length > 0) fn(line, meta);
  else fn(line);
}

export const logger = {
  debug: (scope: string, message: string, meta?: Record<string, unknown>) => emit('debug', scope, message, meta),
  info: (scope: string, message: string, meta?: Record<string, unknown>) => emit('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: Record<string, unknown>) => emit('warn', scope, message, meta),
  /** Ошибка с техническим описанием; пользовательские данные не передавать. */
  error: (scope: string, message: string, error?: unknown) => {
    const meta: Record<string, unknown> = {};
    if (error instanceof Error) {
      meta.name = error.name;
      meta.message = error.message;
    } else if (typeof error === 'string') {
      meta.detail = error;
    }
    emit('error', scope, message, meta);
  },
};
