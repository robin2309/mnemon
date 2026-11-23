#!/usr/bin/env node
// Turns a backup into SQL you paste into the Supabase SQL editor.
//
//   npm run import -- <backup> --email <your Supabase account email> [--out import.sql]
//
// <backup> is either:
//   * a .json file from `npm run export` (restore, any version), or
//   * a .db SQLite file from the old Fly.io version of Mnémon (migration).
//
// The SQL runs as the database owner in the SQL editor, so it can keep each item's
// creation date and done state, and attach every item to the account with that email.
// Missing categories are created; existing ones (same name, any case) are reused.
// Nothing is sent anywhere by this script.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { toRow, validateCategoryLabel, validateDraft } from '../web/src/utils.js';
import { fail } from './lib/prompt.js';

const USAGE = `Usage: npm run import -- <backup.json|mnemon.db> --email <email> [--out import.sql]`;

// Fixed category keys used by the Fly.io version and by version 1 JSON exports.
const LEGACY_LABELS = { todo: 'À faire', investigate: 'À investiguer', read: 'À lire', watch: 'À regarder' };

/**
 * Returns { categories: [label…] in display order, items: [{ …, categories: [label…] }] }.
 * Reads JSON exports version 1 (one fixed key), 2 (one name) and 3 (list of names),
 * and the SQLite database of the Fly.io version.
 */
async function readBackup(file) {
  if (/\.json$/i.test(file)) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data?.app !== 'mnemon' || !Array.isArray(data.items)) fail("ce JSON n'est pas un export Mnémon.");
    if (data.version === 1) {
      return {
        categories: Object.values(LEGACY_LABELS),
        items: data.items.map((i) => ({ ...i, categories: [LEGACY_LABELS[i.category] ?? i.category] })),
      };
    }
    return {
      categories: Array.isArray(data.categories) ? data.categories : [],
      items: data.items.map((i) => ({ ...i, categories: Array.isArray(i.categories) ? i.categories : [i.category] })),
    };
  }

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const items = db
      .prepare('SELECT title, url, category, done, created_at, updated_at FROM items ORDER BY id')
      .all()
      .map((r) => ({ ...r, done: r.done === 1, categories: [LEGACY_LABELS[r.category] ?? r.category] }));
    return { categories: Object.values(LEGACY_LABELS), items };
  } finally {
    db.close();
  }
}

const sqlString = (value) => (value == null ? 'null' : `'${String(value).replace(/'/g, "''")}'`);

function isTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** Valid, trimmed, case-insensitively unique labels, in order. */
function cleanLabels(raw) {
  const labels = [];
  const seen = new Set();
  for (const value of raw) {
    const label = typeof value === 'string' ? value.trim() : '';
    const key = label.toLocaleLowerCase('fr');
    if (validateCategoryLabel(label) || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
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

  const backup = await readBackup(file);

  // Category names: the backup's list first (display order), then any others items use.
  const labels = cleanLabels([...backup.categories, ...backup.items.flatMap((i) => i.categories)]);

  const values = [];
  const skipped = [];
  for (const item of backup.items) {
    const row = toRow({ title: item.title ?? '', url: item.url, done: item.done });
    const categories = cleanLabels(item.categories);
    const problem =
      validateDraft({ title: row.title, url: row.url ?? '' }) ?? (categories.length === 0 ? 'aucune catégorie valide' : null);
    if (problem) {
      skipped.push(`« ${item.title} » : ${problem}`);
      continue;
    }
    const createdAt = isTimestamp(item.created_at) ? sqlString(item.created_at) : 'now()';
    const updatedAt = isTimestamp(item.updated_at) ? sqlString(item.updated_at) : createdAt;
    values.push(
      `      (${values.length}, ${sqlString(row.title)}, ${sqlString(row.url)}, ${row.done}, ` +
        `${createdAt}::timestamptz, ${updatedAt}::timestamptz, array[${categories.map(sqlString).join(', ')}]::text[])`,
    );
  }

  const email = sqlString(args.email);
  const body = `
declare
  uid uuid;
  r record;
  new_id bigint;
begin
  select id into uid from auth.users where email = ${email};
  if uid is null then
    raise exception 'No Supabase user with email %', ${email};
  end if;
${
  labels.length === 0
    ? ''
    : `
  -- Categories that do not exist yet for this user, in order.
  insert into public.categories (user_id, label)
  select uid, l.label
  from (values
${labels.map((l, i) => `      (${i}, ${sqlString(l)})`).join(',\n')}
  ) as l (pos, label)
  order by l.pos
  on conflict (user_id, lower(label)) do nothing;
`
}${
  values.length === 0
    ? ''
    : `
  for r in
    select * from (values
${values.join(',\n')}
    ) as v (pos, title, url, done, created_at, updated_at, labels)
    order by v.pos
  loop
    insert into public.items (user_id, title, url, done, created_at, updated_at)
    values (uid, r.title, r.url, r.done, r.created_at, r.updated_at)
    returning id into new_id;
    insert into public.item_categories (user_id, item_id, category_id)
    select uid, new_id, c.id
    from public.categories c
    where c.user_id = uid and lower(c.label) in (select lower(x) from unnest(r.labels) as x);
  end loop;
`
}end`;
  // Dollar-quote tag that cannot appear in the data.
  let tag = '$import$';
  while (body.includes(tag)) tag = `$import_${Math.random().toString(36).slice(2, 8)}$`;

  const sql = `-- Mnémon import: ${values.length} items, ${labels.length} categories from ${path.basename(file)}
-- Paste into Supabase > SQL Editor and run. Everything is in one transaction.
begin;

do ${tag}${body}
${tag};

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
