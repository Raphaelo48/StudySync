/**
 * Драйвер SqlDriver поверх expo-sqlite (реальная работа приложения).
 */
import * as SQLite from 'expo-sqlite';
import type { RunResult, SqlDriver, SqlParam } from '../driver';

export function createExpoDriver(dbName = 'studysync.db'): SqlDriver {
  const db = SQLite.openDatabaseSync(dbName);

  return {
    async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
      const res = await db.runAsync(sql, ...params);
      return { changes: res.changes, lastInsertRowId: Number(res.lastInsertRowId) };
    },
    async getAll<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
      return db.getAllAsync<T>(sql, ...params);
    },
    async getFirst<T>(sql: string, params: SqlParam[] = []): Promise<T | null> {
      return db.getFirstAsync<T>(sql, ...params);
    },
    async exec(sql: string): Promise<void> {
      await db.execAsync(sql);
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      let result: T | undefined;
      await db.withTransactionAsync(async () => {
        result = await fn();
      });
      return result as T;
    },
    async close(): Promise<void> {
      await db.closeAsync();
    },
  };
}
