// Row-level security and constraints of the Supabase schema, run against an in-memory
// Postgres. These are the rules that keep the public publishable key harmless.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from './helpers/pg.js';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('items table', () => {
  let db, as, idA;
  before(async () => {
    ({ db, as } = await createDatabase([A, B]));
    const r = await as('authenticated', A, `insert into public.items (title, category) values ('Todo A', 'todo') returning *`);
    idA = r.rows[0].id;
    await as('authenticated', B, `insert into public.items (title, url, category) values ('Lire B', 'https://example.com', 'read')`);
  });
  after(() => db.close());

  test('the owner is set from the session', async () => {
    const { rows } = await as('authenticated', A, `select user_id, done from public.items where id = $1`, [idA]);
    assert.deepEqual(rows, [{ user_id: A, done: false }]);
  });

  test('each user only sees their own items', async () => {
    assert.deepEqual((await as('authenticated', A, 'select title from public.items')).rows, [{ title: 'Todo A' }]);
    assert.deepEqual((await as('authenticated', B, 'select title from public.items')).rows, [{ title: 'Lire B' }]);
  });

  test('visitors without a session get nothing', async () => {
    assert.match((await as('anon', null, 'select * from public.items')).error, /permission denied/);
    assert.match(
      (await as('anon', null, `insert into public.items (title, category) values ('x', 'todo')`)).error,
      /permission denied/,
    );
    assert.match((await as('anon', null, 'delete from public.items')).error, /permission denied/);
    assert.deepEqual((await as('authenticated', null, 'select * from public.items')).rows, []);
  });

  test("a user cannot touch someone else's items", async () => {
    assert.deepEqual((await as('authenticated', B, `update public.items set done = true where id = $1 returning id`, [idA])).rows, []);
    assert.deepEqual((await as('authenticated', B, `delete from public.items where id = $1 returning id`, [idA])).rows, []);
  });

  test('owner, id and timestamps cannot be set by the client', async () => {
    for (const sql of [
      `insert into public.items (title, category, user_id) values ('x', 'todo', '${B}')`,
      `update public.items set user_id = '${B}' where id = ${idA}`,
      `update public.items set created_at = now() - interval '1 year' where id = ${idA}`,
      `update public.items set updated_at = now() - interval '1 year' where id = ${idA}`,
    ]) {
      assert.match((await as('authenticated', A, sql)).error ?? '', /permission denied/, sql);
    }
  });

  test('updating bumps updated_at', async () => {
    const before = (await as('authenticated', A, 'select updated_at from public.items where id = $1', [idA])).rows[0].updated_at;
    await new Promise((r) => setTimeout(r, 5));
    const { rows } = await as('authenticated', A, 'update public.items set done = true where id = $1 returning done, updated_at', [idA]);
    assert.equal(rows[0].done, true);
    assert.ok(rows[0].updated_at > before);
  });

  test('API roles cannot call the trigger function directly', async () => {
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await as(role, null, "select has_function_privilege('public.items_set_updated_at()', 'execute') as ok");
      assert.equal(rows[0].ok, false, role);
    }
  });

  test('invalid data is rejected by the database', async () => {
    for (const [title, url, category] of [
      ['x', 'javascript:alert(1)', 'todo'],
      ['x', 'ftp://x', 'todo'],
      ['x', 'https://a b', 'todo'],
      ['', null, 'todo'],
      [' x ', null, 'todo'],
      ['a'.repeat(201), null, 'todo'],
      ['x', null, 'nope'],
    ]) {
      const r = await as('authenticated', A, 'insert into public.items (title, url, category) values ($1, $2, $3)', [title, url, category]);
      assert.match(r.error ?? '', /check constraint/, JSON.stringify([title, url, category]));
    }
  });

  test('the owner can delete their item', async () => {
    assert.equal((await as('authenticated', A, 'delete from public.items where id = $1 returning id', [idA])).rows.length, 1);
  });
});
