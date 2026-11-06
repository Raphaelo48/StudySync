/**
 * SqlDriver на SQL.js (SQLite, скомпилированный в WASM) для тестов в Node.
 *
 * Даёт настоящую семантику SQLite: внешние ключи (PRAGMA foreign_keys),
 * транзакции с откатом, CHECK-ограничения — без нативной сборки.
 */
import type { Database as SqlJsDatabase, SqlJsStatic, BindParams, Statement } from 'sql.js';
import type { RunResult, SqlDriver, SqlParam } from '../../src/db/driver';

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    const initSqlJs = require('sql.js') as typeof import('sql.js');
    sqlJsPromise = (initSqlJs.default ?? initSqlJs)();
  }
  return sqlJsPromise;
}

export async function createRawSqlJsDatabase(): Promise<SqlJsDatabase> {
  const SQL = await getSqlJs();
  return new SQL.Database();
}

function toBindParams(params: SqlParam[]): BindParams {
  // sql.js ожидает JS-примитивы; boolean не поддерживается — только number|string|null
  return params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p)) as BindParams;
}

export function createSqlJsDriver(raw: SqlJsDatabase): SqlDriver {
  let inTransaction = false;

  const query = (sql: string, params: SqlParam[]): Record<string, unknown>[] => {
    let stmt: Statement | null = null;
    try {
      stmt = raw.prepare(sql);
      if (params.length > 0) stmt.bind(toBindParams(params));
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as Record<string, unknown>);
      }
      return rows;
    } finally {
      stmt?.free();
    }
  };

  return {
    async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
      raw.run(sql, toBindParams(params));
      const changes = query('SELECT changes() AS n', [])[0]?.n as number;
      const lastInsertRowId = query('SELECT last_insert_rowid() AS n', [])[0]?.n as number;
      return { changes: changes ?? 0, lastInsertRowId: lastInsertRowId ?? 0 };
    },
    async getAll<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
      return query(sql, params) as T[];
    },
    async getFirst<T>(sql: string, params: SqlParam[] = []): Promise<T | null> {
      const rows = query(sql, params);
      return (rows[0] as T) ?? null;
    },
    async exec(sql: string): Promise<void> {
      raw.run(sql);
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (inTransaction) {
        // SQLite не поддерживает вложенные транзакции — выполняем inline,
        // как и expo-sqlite (withTransactionAsync допускает вложенные вызовы
        // через savepoints; в тестах достаточно плоского поведения).
        return fn();
      }
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
          // игнорируем ошибку отката
        }
        throw error;
      } finally {
        inTransaction = false;
      }
    },
    async close(): Promise<void> {
      // Сырую БД не закрываем: она переиспользуется для проверки персистентности.
    },
  };
}
