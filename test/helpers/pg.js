import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = path.join(import.meta.dirname, '../../supabase/migrations');

/**
 * In-memory Postgres with a minimal stand-in for what Supabase provides (anon and
 * authenticated roles, auth.users, auth.uid() reading the JWT subject, default grants),
 * then the migrations applied in order (all of them, or only those before `before`;
 * call `migrate()` to apply the rest).
 */
export async function createDatabase(userIds, { before } = {}) {
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
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let applied = 0;
  /** Applies pending migrations, stopping before the first file name >= `stop`. */
  async function migrate(stop) {
    for (; applied < files.length && !(stop && files[applied] >= stop); applied++) {
      await db.exec(fs.readFileSync(path.join(MIGRATIONS, files[applied]), 'utf8'));
    }
  }
  await migrate(before);

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

  /** Adds a Supabase user (as the auth service would), returning its id. */
  async function addUser(id, email) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
    return id;
  }

  /** Id of the user's category with this label. */
  async function categoryId(userId, label) {
    const { rows } = await db.query('select id from public.categories where user_id = $1 and label = $2', [userId, label]);
    return rows[0]?.id;
  }

  return { db, as, migrate, addUser, categoryId };
}
