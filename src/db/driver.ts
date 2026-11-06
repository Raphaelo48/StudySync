/**
 * Абстракция SQL-драйвера.
 *
 * Слой репозиториев и бизнес-логика зависят только от этого интерфейса.
 * В приложении он реализуется через expo-sqlite (src/db/drivers/expoDriver.ts),
 * в тестах — через SQL.js (tests/support/sqljsDriver.ts). Это позволяет
 * тестировать реальный SQL (внешние ключи, транзакции, ограничения) в Node.
 */

export type SqlParam = string | number | null;

export interface RunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface SqlDriver {
  /** Выполнить запрос без результата (INSERT/UPDATE/DELETE/PRAGMA). */
  run(sql: string, params?: SqlParam[]): Promise<RunResult>;
  /** SELECT всех строк. */
  getAll<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /** SELECT первой строки или null. */
  getFirst<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T | null>;
  /** Выполнить несколько операторов без параметров (DDL, PRAGMA). */
  exec(sql: string): Promise<void>;
  /** Атомарная транзакция: при исключении — откат. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Ошибка уровня базы данных с понятным сообщением для разработчика. */
export class DatabaseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'DatabaseError';
  }
}
