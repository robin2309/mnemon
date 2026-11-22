import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { openDb, validateCreate, validatePatch } from '../db.js';

const PASSWORD = 'correct horse battery staple';
const SECRET = 'x'.repeat(48);
const ORIGIN = 'http://localhost';
const HEADERS = { Origin: ORIGIN, Host: 'localhost' };

function makeApp(db) {
  return createApp({ db, password: PASSWORD, sessionSecret: SECRET, loginDelayMs: 0 });
}

async function login(app, password = PASSWORD) {
  return app.request('/login', {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }),
    redirect: 'manual',
  });
}

function client(app, cookie) {
  const req = (method, url, body) =>
    app.request(url, {
      method,
      headers: {
        ...HEADERS,
        Cookie: cookie,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  return {
    get: (u) => req('GET', u),
    post: (u, b) => req('POST', u, b),
    patch: (u, b) => req('PATCH', u, b),
    del: (u) => req('DELETE', u),
  };
}

describe('validation', () => {
  test('create: trims title, empty url → null', () => {
    assert.deepEqual(validateCreate({ title: '  Dune ', url: '', category: 'read' }).value, {
      title: 'Dune',
      url: null,
      category: 'read',
    });
  });
  test('create: rejects bad input', () => {
    for (const body of [
      null,
      [],
      { title: '', category: 'read' },
      { title: '   ', category: 'read' },
      { title: 'a'.repeat(201), category: 'read' },
      { title: 'x', category: 'nope' },
      { title: 'x', category: 'read', url: 'javascript:alert(1)' },
      { title: 'x', category: 'read', url: 'ftp://x' },
      { title: 'x', category: 'read', url: 'not a url' },
      { title: 'x', category: 'read', url: 42 },
      { title: 42, category: 'read' },
    ]) {
      assert.ok(validateCreate(body).error, JSON.stringify(body));
    }
  });
  test('patch: requires at least one known field, done must be boolean', () => {
    assert.ok(validatePatch({}).error);
    assert.ok(validatePatch({ foo: 1 }).error);
    assert.ok(validatePatch({ done: 'true' }).error);
    assert.deepEqual(validatePatch({ done: true }).value, { done: 1 });
  });
});

describe('auth', () => {
  let db, app;
  before(() => {
    db = openDb(':memory:');
    app = makeApp(db);
  });
  after(() => db.close());

  test('AC1: / redirects to /login and /api/items is 401 without session', async () => {
    const r1 = await app.request('/', { redirect: 'manual' });
    assert.equal(r1.status, 302);
    assert.equal(r1.headers.get('location'), '/login');
    const r2 = await app.request('/api/items');
    assert.equal(r2.status, 401);
  });

  test('public paths reachable without session', async () => {
    const r = await app.request('/login');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /type="password"/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  });

  test('wrong password redirects to /login?error=1 and sets no cookie', async () => {
    const r = await login(app, 'wrong');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login?error=1');
    assert.equal(r.headers.get('set-cookie'), null);
    const page = await app.request('/login?error=1');
    assert.match(await page.text(), /Mot de passe incorrect/);
  });

  test('good password sets a hardened session cookie', async () => {
    const r = await login(app);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/');
    const cookie = r.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Max-Age=31536000/);
  });

  test('forged / tampered cookie is rejected', async () => {
    const r = await app.request('/api/items', { headers: { Cookie: 'mnemon_session=v1.9999999999999.forged' } });
    assert.equal(r.status, 401);
  });

  test('cross-origin form login is blocked (CSRF)', async () => {
    const r = await app.request('/login', {
      method: 'POST',
      headers: { Host: 'localhost', Origin: 'https://evil.example', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: PASSWORD }),
    });
    assert.equal(r.status, 403);
  });

  test('logout clears the cookie', async () => {
    const cookie = (await login(app)).headers.get('set-cookie').split(';')[0];
    const r = await app.request('/logout', {
      method: 'POST',
      headers: { ...HEADERS, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login');
    assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  });
});

describe('items API', () => {
  let db, app, api, cookie;
  before(async () => {
    db = openDb(':memory:');
    app = makeApp(db);
    cookie = (await login(app)).headers.get('set-cookie').split(';')[0];
    api = client(app, cookie);
  });
  after(() => db.close());

  test('categories in display order', async () => {
    const r = await api.get('/api/categories');
    assert.deepEqual(
      (await r.json()).map((c) => c.key),
      ['todo', 'investigate', 'read', 'watch'],
    );
  });

  test('AC2/AC3: create items, newest first within category', async () => {
    const a = await api.post('/api/items', { title: 'Ancien', category: 'read' });
    assert.equal(a.status, 201);
    const r = await api.post('/api/items', { title: 'Dune', category: 'read' });
    assert.equal(r.status, 201);
    const dune = await r.json();
    assert.equal(dune.url, null);
    assert.equal(dune.done, false);
    assert.ok(dune.createdAt && dune.updatedAt);

    const yt = await api.post('/api/items', {
      title: 'Vidéo',
      url: 'https://www.youtube.com/watch?v=x',
      category: 'watch',
    });
    assert.equal((await yt.json()).url, 'https://www.youtube.com/watch?v=x');
    await api.post('/api/items', { title: 'Tâche', category: 'todo' });

    const items = await (await api.get('/api/items')).json();
    assert.deepEqual(
      items.map((i) => i.title),
      ['Tâche', 'Dune', 'Ancien', 'Vidéo'],
    );
  });

  test('AC4: javascript: and ftp: links rejected with readable message', async () => {
    for (const url of ['javascript:alert(1)', 'ftp://x']) {
      const r = await api.post('/api/items', { title: 'x', url, category: 'read' });
      assert.equal(r.status, 400);
      assert.equal(typeof (await r.json()).error, 'string');
    }
  });

  test('malformed requests', async () => {
    const bad = await app.request('/api/items', {
      method: 'POST',
      headers: { ...HEADERS, Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(bad.status, 400);
    const r = await api.patch('/api/items/abc', { done: true });
    assert.equal(r.status, 404);
    const r2 = await api.patch('/api/items/99999', { done: true });
    assert.equal(r2.status, 404);
    const r3 = await api.del('/api/items/99999');
    assert.equal(r3.status, 404);
    const r4 = await api.post('/api/items', { title: 'x'.repeat(20000), category: 'read' });
    assert.equal(r4.status, 413);
  });

  test('AC5/AC6: toggle done and change category', async () => {
    const items = await (await api.get('/api/items')).json();
    const dune = items.find((i) => i.title === 'Dune');

    const r = await api.patch(`/api/items/${dune.id}`, { done: true });
    assert.equal(r.status, 200);
    const patched = await r.json();
    assert.equal(patched.done, true);
    assert.ok(patched.updatedAt >= dune.updatedAt);

    let list = await (await api.get('/api/items')).json();
    assert.deepEqual(
      list.filter((i) => i.category === 'read').map((i) => i.title),
      ['Ancien', 'Dune'], // done items after not-done
    );

    await api.patch(`/api/items/${dune.id}`, { done: false, category: 'watch', title: '  Dune (film) ' });
    list = await (await api.get('/api/items')).json();
    const moved = list.find((i) => i.id === dune.id);
    assert.equal(moved.category, 'watch');
    assert.equal(moved.title, 'Dune (film)');

    const clear = await api.patch(`/api/items/${dune.id}`, { url: '' });
    assert.equal((await clear.json()).url, null);
  });

  test('AC7: delete', async () => {
    const created = await (await api.post('/api/items', { title: 'À supprimer', category: 'todo' })).json();
    const r = await api.del(`/api/items/${created.id}`);
    assert.equal(r.status, 204);
    const list = await (await api.get('/api/items')).json();
    assert.ok(!list.some((i) => i.id === created.id));
  });
});

test('AC8: data persists across DB reopen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideas-test-'));
  const file = path.join(dir, 'nested', 'ideas.db');
  try {
    const db1 = openDb(file);
    db1.createItem({ title: 'Persistant', url: null, category: 'todo' });
    db1.close();
    const db2 = openDb(file);
    assert.deepEqual(
      db2.listItems().map((i) => i.title),
      ['Persistant'],
    );
    db2.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('export', () => {
  let db, app, api, tmp;
  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemon-export-'));
    db = openDb(path.join(tmp, 'live.db')); // file-backed, WAL mode like production
    app = makeApp(db);
    const cookie = (await login(app)).headers.get('set-cookie').split(';')[0];
    api = client(app, cookie);
  });
  after(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('requires a session', async () => {
    const r = await app.request('/api/export');
    assert.equal(r.status, 401);
  });

  test('returns a usable SQLite snapshot including recent writes', async () => {
    await api.post('/api/items', { title: 'Sauvegarder', category: 'todo' });
    await api.post('/api/items', { title: 'Dune', category: 'read', url: 'https://example.com' });

    const r = await api.get('/api/export');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/vnd.sqlite3');
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="mnemon-[\w-]+\.db"$/);
    assert.equal(r.headers.get('cache-control'), 'no-store');

    const file = path.join(tmp, 'snapshot.db');
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    const copy = openDb(file);
    try {
      assert.deepEqual(
        copy.listItems().map((i) => i.title).sort(),
        ['Dune', 'Sauvegarder'],
      );
    } finally {
      copy.close();
    }
  });
});
