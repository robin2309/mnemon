// The import script's SQL must run cleanly against the real schema.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from './helpers/pg.js';

const A = '11111111-1111-1111-1111-111111111111';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemon-import-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function runImport(file) {
  return execFileSync(process.execPath, ['scripts/import.js', file, '--email', 'user0@example.com'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('imports a SQLite database from the Fly.io version', async () => {
  const file = path.join(tmp, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT, url TEXT, category TEXT, done INTEGER,
    created_at TEXT, updated_at TEXT)`);
  const insert = old.prepare('INSERT INTO items (title, url, category, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run("L'Étranger", null, 'read', 1, '2025-03-01T10:00:00.000Z', '2025-03-02T10:00:00.000Z');
  insert.run('Vidéo', 'https://youtube.com/watch?v=x', 'watch', 0, '2025-04-01T10:00:00.000Z', '2025-04-01T10:00:00.000Z');
  insert.run('Bad', 'javascript:alert(1)', 'todo', 0, '2025-04-01T10:00:00.000Z', '2025-04-01T10:00:00.000Z');
  old.close();

  const { db } = await createDatabase([A]);
  await db.exec(runImport(file));
  const { rows } = await db.query(
    `select user_id, title, url, category, done, created_at::text as created from public.items order by id`,
  );
  assert.deepEqual(
    rows.map(({ user_id, title, url, category, done }) => ({ user_id, title, url, category, done })),
    [
      { user_id: A, title: "L'Étranger", url: null, category: 'read', done: true },
      { user_id: A, title: 'Vidéo', url: 'https://youtube.com/watch?v=x', category: 'watch', done: false },
    ],
  );
  assert.match(rows[0].created, /^2025-03-01 10:00:00/);
  await db.close();
});

test('restores a JSON export and refuses an unknown email', async () => {
  const file = path.join(tmp, 'backup.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      app: 'mnemon',
      version: 1,
      items: [{ id: 9, title: 'Todo', url: null, category: 'todo', done: false, created_at: '2026-01-01T00:00:00Z' }],
    }),
  );
  const { db } = await createDatabase([A]);
  const sql = runImport(file);
  await db.exec(sql);
  assert.equal((await db.query('select count(*)::int as n from public.items')).rows[0].n, 1);

  const { db: other } = await createDatabase([]);
  await assert.rejects(other.exec(sql), /No Supabase user with email/);
  await db.close();
});
