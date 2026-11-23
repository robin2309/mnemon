import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = path.join(import.meta.dirname, '../../supabase/migrations');

/**
 * In-memory Postgres with a minimal stand-in for what Supabase provides (anon and
 * authenticated roles, auth.users, auth.uid() reading the JWT subject, default grants),
 * then every migration applied in order.
 */
export async function createDatabase(userIds) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key, email text unique);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
  `);
  for (const [i, id] of userIds.entries()) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `user${i}@example.com`]);
  }
  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  }

  /** Runs `sql` as `role`, signed in as `userId` (null = no session). Returns { rows } or { error }. */
  async function as(role, userId, sql, params) {
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
    await db.exec(`set role ${role}`);
    try {
      return { rows: (await db.query(sql, params)).rows };
    } catch (err) {
      return { error: err.message };
    } finally {
      await db.exec('reset role');
    }
  }

  return { db, as };
}
