#!/usr/bin/env node
// Turns a backup into SQL you paste into the Supabase SQL editor.
//
//   npm run import -- <backup> --email <your Supabase account email> [--out import.sql]
//
// <backup> is either:
//   * a .json file from `npm run export` (restore), or
//   * a .db SQLite file from the old Fly.io version of Mnémon (migration).
//
// The SQL runs as the database owner in the SQL editor, so it can keep each item's
// creation date and done state, and attach every item to the account with that email.
// Nothing is sent anywhere by this script.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CATEGORY_ORDER, toRow, validateDraft } from '../web/src/utils.js';
import { fail } from './lib/prompt.js';

const USAGE = `Usage: npm run import -- <backup.json|mnemon.db> --email <email> [--out import.sql]`;

function readBackup(file) {
  if (/\.json$/i.test(file)) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data?.app !== 'mnemon' || !Array.isArray(data.items)) fail("ce JSON n'est pas un export Mnémon.");
    return data.items;
  }
  return readSqlite(file);
}

async function readSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare('SELECT title, url, category, done, created_at, updated_at FROM items ORDER BY id')
      .all()
      .map((r) => ({ ...r, done: r.done === 1 }));
  } finally {
    db.close();
  }
}

const sqlString = (value) => (value == null ? 'null' : `'${String(value).replace(/'/g, "''")}'`);

function isTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: { email: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
    });
  } catch (err) {
    fail(`${err.message}\n\n${USAGE}`);
  }
  const { values: args, positionals } = parsed;
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (positionals.length !== 1 || !args.email) fail(USAGE);

  const cwd = process.env.INIT_CWD ?? process.cwd();
  const file = path.resolve(cwd, positionals[0]);
  if (!fs.existsSync(file)) fail(`fichier introuvable : ${file}`);

  const items = await readBackup(file);
  const values = [];
  const skipped = [];
  for (const item of items) {
    const row = toRow({ title: item.title ?? '', url: item.url, category: item.category, done: item.done });
    const problem =
      validateDraft({ title: row.title, url: row.url ?? '' }) ??
      (CATEGORY_ORDER.includes(row.category) ? null : `catégorie inconnue (${row.category})`);
    if (problem) {
      skipped.push(`« ${item.title} » : ${problem}`);
      continue;
    }
    const createdAt = isTimestamp(item.created_at) ? sqlString(item.created_at) : 'now()';
    const updatedAt = isTimestamp(item.updated_at) ? sqlString(item.updated_at) : createdAt;
    values.push(
      `  (${sqlString(row.title)}, ${sqlString(row.url)}, ${sqlString(row.category)}, ${row.done}, ${createdAt}, ${updatedAt})`,
    );
  }

  const sql = `-- Mnémon import: ${values.length} items from ${path.basename(file)}
-- Paste into Supabase > SQL Editor and run. Everything is in one transaction.
begin;

do $$
begin
  if not exists (select 1 from auth.users where email = ${sqlString(args.email)}) then
    raise exception 'No Supabase user with email %', ${sqlString(args.email)};
  end if;
end $$;

${
  values.length === 0
    ? '-- Nothing to import.'
    : `insert into public.items (user_id, title, url, category, done, created_at, updated_at)
select u.id, v.title, v.url, v.category, v.done, v.created_at::timestamptz, v.updated_at::timestamptz
from auth.users u
cross join (values
${values.join(',\n')}
) as v (title, url, category, done, created_at, updated_at)
where u.email = ${sqlString(args.email)};`
}

commit;
`;

  if (args.out) {
    const outPath = path.resolve(cwd, args.out);
    fs.writeFileSync(outPath, sql, { flag: 'wx' });
    console.error(`SQL écrit dans ${outPath}`);
  } else {
    process.stdout.write(sql);
  }
  console.error(`${values.length} items prêts à importer.`);
  if (skipped.length) console.error(`${skipped.length} ignorés :\n  ${skipped.join('\n  ')}`);
}

main().catch((err) => {
  if (err.code === 'EEXIST') fail(`le fichier existe déjà : ${err.path}`);
  fail(err.message);
});
