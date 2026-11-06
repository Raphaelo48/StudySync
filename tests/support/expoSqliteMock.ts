/**
 * Мок expo-sqlite для UI/навигационных тестов.
 *
 * Поведение полностью соответствует реальному драйверу (src/db/drivers/expoDriver.ts),
 * но работает на SQL.js в Node. Модуль sql.js инициализируется заранее
 * (globalThis.__SQLJS__), чтобы openDatabaseSync оставался синхронным,
 * как в настоящем expo-sqlite.
 */
import type { Database as SqlJsDatabase, Statement, BindParams } from 'sql.js';

interface SqlJsModule {
  Database: new () => SqlJsDatabase;
}

declare global {
  // eslint-disable-next-line no-var
  var __SQLJS__: SqlJsModule | undefined;
}

function getSqlJs(): SqlJsModule {
  const mod = globalThis.__SQLJS__;
  if (!mod) throw new Error('SQL.js не инициализирован: вызов initSqlJs() до рендера');
  return mod;
}

function toBind(params: unknown[]): BindParams {
  return params.map((p) =>
    typeof p === 'boolean' ? (p ? 1 : 0) : (p as string | number | null)
  ) as BindParams;
}

function query(raw: SqlJsDatabase, sql: string, params: unknown[]): Record<string, unknown>[] {
  let stmt: Statement | null = null;
  try {
    stmt = raw.prepare(sql);
    if (params.length > 0) stmt.bind(toBind(params));
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
    return rows;
  } finally {
    stmt?.free();
  }
}

export interface MockExpoDatabase {
  runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  execAsync(sql: string): Promise<void>;
  withTransactionAsync<T>(fn: () => Promise<T>): Promise<T>;
  closeAsync(): Promise<void>;
}

/** Хранилище всех созданных «баз» — тесты могут обращаться к данным напрямую. */
export const mockDatabases: SqlJsDatabase[] = [];

export function openDatabaseSync(_name?: string): MockExpoDatabase {
  const SQL = getSqlJs();
  const raw = new SQL.Database();
  mockDatabases.push(raw);
  let inTransaction = false;

  return {
    async runAsync(sql: string, ...params: unknown[]) {
      raw.run(sql, toBind(params));
      const changes = Number(query(raw, 'SELECT changes() AS n', [])[0]?.n ?? 0);
      const lastInsertRowId = Number(query(raw, 'SELECT last_insert_rowid() AS n', [])[0]?.n ?? 0);
      return { changes, lastInsertRowId };
    },
    async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      return query(raw, sql, params) as T[];
    },
    async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
      const rows = query(raw, sql, params);
      return (rows[0] as T) ?? null;
    },
    async execAsync(sql: string): Promise<void> {
      raw.run(sql);
    },
    async withTransactionAsync<T>(fn: () => Promise<T>): Promise<T> {
      if (inTransaction) return fn();
      inTransaction = true;
      raw.run('BEGIN IMMEDIATE');
      try {
        const result = await fn();
        raw.run('COMMIT');
        return result;
      } catch (error) {
        try {
          raw.run('ROLLBACK');
        } catch {
          /* noop */
        }
        throw error;
      } finally {
        inTransaction = false;
      }
    },
    async closeAsync(): Promise<void> {},
  };
}
