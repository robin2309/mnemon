#!/usr/bin/env node
// Downloads all your Mnémon items from Supabase as a JSON backup.
//
//   npm run export [-- --out backups/]
//
// Supabase project: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (read from .env).
// Credentials:      MNEMON_EMAIL / MNEMON_PASSWORD, otherwise asked interactively
//                   (never passed as arguments, so they stay out of shell history).
// Output:           --out <file.json | directory>, default: current directory.
//
// The script signs in as you, so it goes through the same row-level security as the app.
// Restore with: npm run import -- <backup.json> --email <you>

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { isSecretKey } from '../web/src/utils.js';
import { fail, prompt } from './lib/prompt.js';

const USAGE = `Usage: npm run export [-- --out <file.json|dir>]

Needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (in .env).
Email and password come from MNEMON_EMAIL / MNEMON_PASSWORD, or are asked.`;

const PAGE_SIZE = 1000;

async function main() {
  let args;
  try {
    ({ values: args } = parseArgs({
      options: { out: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
    }));
  } catch (err) {
    fail(`${err.message}\n\n${USAGE}`);
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) fail(`configuration Supabase manquante.\n\n${USAGE}`);
  if (isSecretKey(key)) fail('VITE_SUPABASE_PUBLISHABLE_KEY contient une clé secrète : utilisez la clé publishable.');

  const email = process.env.MNEMON_EMAIL ?? (await prompt('Email : '));
  const password = process.env.MNEMON_PASSWORD ?? (await prompt('Mot de passe : ', { hidden: true }));

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  console.error(`Connexion à ${new URL(url).host}…`);
  const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (authError) fail(authError.code === 'invalid_credentials' ? 'email ou mot de passe incorrect.' : authError.message);

  async function selectAll(table, columns) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase.from(table).select(columns).order('id').range(from, from + PAGE_SIZE - 1);
      if (error) fail(`lecture impossible (${table}) : ${error.message}`);
      rows.push(...data);
      if (data.length < PAGE_SIZE) return rows;
    }
  }

  let categories, items;
  try {
    // Categories by name (in display order), items with their categories' names.
    const rows = await selectAll('categories', 'id, label');
    const labelOf = new Map(rows.map((c) => [c.id, c.label]));
    categories = rows.map((c) => c.label);
    items = (await selectAll('items', 'id, title, url, done, created_at, updated_at, item_categories(category_id)')).map(
      ({ item_categories, ...item }) => ({
        ...item,
        categories: item_categories
          .map((l) => l.category_id)
          .sort((a, b) => a - b)
          .map((id) => labelOf.get(id)),
      }),
    );
  } finally {
    await supabase.auth.signOut({ scope: 'local' });
  }

  const exportedAt = new Date().toISOString();
  const fileName = `mnemon-${exportedAt.replace(/[:.]/g, '-')}.json`;
  // `npm run` changes the working directory to the project root; INIT_CWD is where the user ran it.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const out = args.out ?? '.';
  let outPath = path.resolve(cwd, out);
  const isDir =
    out.endsWith('/') || out.endsWith(path.sep) || fs.statSync(outPath, { throwIfNoEntry: false })?.isDirectory();
  if (isDir) {
    fs.mkdirSync(outPath, { recursive: true });
    outPath = path.join(outPath, fileName);
  } else {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
  }
  // version 3: each item has a list of category names. Version 2 had one name per item
  // (`category`), version 1 one of the fixed keys todo / investigate / read / watch.
  const body = JSON.stringify({ app: 'mnemon', version: 3, exportedAt, categories, items }, null, 2);
  fs.writeFileSync(outPath, `${body}\n`, { flag: 'wx' }); // never overwrite an existing backup

  console.error(`Export OK : ${categories.length} catégories, ${items.length} items`);
  console.log(outPath);
}

main().catch((err) => {
  if (err.code === 'EEXIST') fail(`le fichier existe déjà : ${err.path}`);
  fail(err.cause?.message ?? err.message);
});
