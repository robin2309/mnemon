#!/usr/bin/env node
// Downloads a full backup of a Mnémon instance's SQLite database.
//
//   npm run export -- --url https://<app>.fly.dev [--out backups/]
//
// URL:      --url, or the MNEMON_URL environment variable.
// Password: the MNEMON_PASSWORD environment variable, otherwise asked interactively
//           (never passed as an argument, so it stays out of shell history).
// Output:   --out <file.db | directory>, default: current directory, with the
//           timestamped file name sent by the server.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';

const USAGE = `Usage: npm run export -- --url https://<app>.fly.dev [--out <file.db|dir>]

Options:
  --url <url>   App URL (or MNEMON_URL)
  --out <path>  Output file or directory (default: current directory)
  -h, --help    Show this help

The password is read from MNEMON_PASSWORD, or asked interactively.`;

function fail(message) {
  console.error(`Erreur : ${message}`);
  process.exit(1);
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    if (!stdin.isTTY) return reject(new Error('pas de terminal interactif ; définir MNEMON_PASSWORD.'));
    stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stderr.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          stderr.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  let args;
  try {
    ({ values: args } = parseArgs({
      options: {
        url: { type: 'string' },
        out: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (err) {
    fail(`${err.message}\n\n${USAGE}`);
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const rawUrl = args.url ?? process.env.MNEMON_URL;
  if (!rawUrl) fail(`URL manquante.\n\n${USAGE}`);
  let base;
  try {
    base = new URL(rawUrl);
  } catch {
    fail(`URL invalide : ${rawUrl}`);
  }
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.protocol !== 'https:' && !isLocal) fail('HTTPS obligatoire (le mot de passe transite sur le réseau).');

  const password = process.env.MNEMON_PASSWORD ?? (await promptHidden('Mot de passe : '));

  // 1. Log in to get a session cookie. The machine may be stopped: Fly starts it on this request.
  console.error(`Connexion à ${base.origin}…`);
  const loginRes = await fetch(new URL('/login', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base.origin },
    body: new URLSearchParams({ password }),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const location = loginRes.headers.get('location') ?? '';
  const sessionCookie = loginRes.headers.getSetCookie().find((c) => c.startsWith('mnemon_session='));
  if (loginRes.status !== 302 || location.includes('error') || !sessionCookie) {
    fail(loginRes.status === 302 ? 'mot de passe incorrect.' : `connexion refusée (HTTP ${loginRes.status}).`);
  }

  // 2. Download the snapshot.
  const res = await fetch(new URL('/api/export', base), {
    headers: { Cookie: sessionCookie.split(';')[0] },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) fail(`export refusé (HTTP ${res.status}).`);
  const data = Buffer.from(await res.arrayBuffer());
  if (!data.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) {
    fail("la réponse n'est pas une base SQLite.");
  }

  // 3. Write it next to the user, never overwriting an existing file.
  const serverName = /filename="([\w.-]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  const fileName = serverName ?? `mnemon-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
  // `npm run` changes the working directory to the project root; INIT_CWD is where the user ran it.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const out = args.out ?? '.';
  let outPath = path.resolve(cwd, out);
  const isDir = out.endsWith('/') || out.endsWith(path.sep) || fs.statSync(outPath, { throwIfNoEntry: false })?.isDirectory();
  if (isDir) {
    fs.mkdirSync(outPath, { recursive: true });
    outPath = path.join(outPath, fileName);
  } else {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
  }
  fs.writeFileSync(outPath, data, { flag: 'wx' });

  // 4. Check the copy is usable.
  const db = new Database(outPath, { readonly: true });
  try {
    const check = db.pragma('quick_check', { simple: true });
    if (check !== 'ok') fail(`la copie est corrompue (${check}) : ${outPath}`);
    const { n } = db.prepare('SELECT count(*) AS n FROM items').get();
    console.error(`Export OK : ${n} items, ${(data.length / 1024).toFixed(1)} Ko`);
  } finally {
    db.close();
  }
  console.log(outPath);
}

main().catch((err) => {
  if (err.code === 'EEXIST') fail(`le fichier existe déjà : ${err.path}`);
  fail(err.cause?.message ?? err.message);
});
