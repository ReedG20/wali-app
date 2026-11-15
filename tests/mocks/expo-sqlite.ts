// expo-sqlite fake backed by node:sqlite (real SQL, file-backed so "restarts" keep data).
import { DatabaseSync } from "node:sqlite";

type G = typeof globalThis & { __testDbPath?: string };

export function openDatabaseSync(_name: string) {
  const db = new DatabaseSync((globalThis as G).__testDbPath ?? ":memory:");
  const args = (p?: unknown[]) => (p ?? []) as never[];
  return {
    execSync: (sql: string) => db.exec(sql),
    getFirstSync: <T>(sql: string, p?: unknown[]) => (db.prepare(sql).get(...args(p)) as T | undefined) ?? null,
    getAllSync: <T>(sql: string, p?: unknown[]) => db.prepare(sql).all(...args(p)) as T[],
    runSync: (sql: string, p?: unknown[]) => db.prepare(sql).run(...args(p)),
    closeSync: () => db.close(),
  };
}
export type SQLiteDatabase = ReturnType<typeof openDatabaseSync>;
export type SQLiteBindValue = string | number | null | Uint8Array;
