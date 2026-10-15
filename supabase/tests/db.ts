import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

/**
 * Base de test : PGlite (PostgreSQL compilé pour Node, sans Docker),
 * socle Supabase simulé, puis toutes les migrations dans l'ordre.
 */

const root = join(__dirname, "..");

export function migrationFiles(): string[] {
  return readdirSync(join(root, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function createDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { citext, pgcrypto } });
  await db.exec(readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(root, "migrations", file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} : ${(error as Error).message}`);
    }
  }
  return db;
}

type Tx = Transaction;

/**
 * Exécute `fn` comme le ferait l'API Supabase pour un utilisateur connecté :
 * rôle « authenticated » et identifiant dans les claims du jeton.
 * La transaction est toujours annulée : aucun test ne modifie l'état des autres.
 */
export async function asUser<T>(db: PGlite, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runAs(db, "authenticated", { sub: userId, role: "authenticated" }, fn);
}

/** Comme un visiteur non connecté (clé « anon »). */
export async function asAnon<T>(db: PGlite, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runAs(db, "anon", { role: "anon" }, fn);
}

/** Comme une tâche système de l'API (clé « service role », RLS contournée). */
export async function asService<T>(db: PGlite, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runAs(db, "service_role", { role: "service_role" }, fn);
}

const ROLLBACK = Symbol("rollback");

async function runAs<T>(db: PGlite, role: string, claims: Record<string, string>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await tx.exec(`set local role ${role}`);
      result = await fn(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return result as T;
}

/** Message d'erreur d'une requête qui doit échouer, ou null si elle réussit. */
export async function failure(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
