// Row-level security and constraints of the Supabase schema, run against an in-memory
// Postgres. These are the rules that keep the public publishable key harmless.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from './helpers/pg.js';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';
const DEFAULT_LABELS = ['À faire', 'À investiguer', 'À lire', 'À regarder'];

describe('categories', () => {
  let db, as, addUser;
  before(async () => {
    ({ db, as, addUser } = await createDatabase([A, B]));
  });
  after(() => db.close());

  test('existing users get the four default categories, in order', async () => {
    const { rows } = await as('authenticated', A, 'select label from public.categories order by id');
    assert.deepEqual(rows.map((r) => r.label), DEFAULT_LABELS);
  });

  test('new users get them too', async () => {
    await addUser(C, 'new@example.com');
    const { rows } = await as('authenticated', C, 'select label from public.categories order by id');
    assert.deepEqual(rows.map((r) => r.label), DEFAULT_LABELS);
  });

  test('a user can add a category and only sees their own', async () => {
    const r = await as('authenticated', A, `insert into public.categories (label) values ('Podcasts') returning user_id`);
    assert.deepEqual(r.rows, [{ user_id: A }]);
    assert.equal((await as('authenticated', A, 'select * from public.categories')).rows.length, 5);
    assert.equal((await as('authenticated', B, 'select * from public.categories')).rows.length, 4);
  });

  test('labels are unique per user, ignoring case, but two users may share one', async () => {
    assert.match((await as('authenticated', A, `insert into public.categories (label) values ('podcasts')`)).error, /duplicate key/);
    assert.equal((await as('authenticated', B, `insert into public.categories (label) values ('Podcasts') returning id`)).rows.length, 1);
  });

  test('invalid labels are rejected', async () => {
    for (const label of ['', ' x', 'a'.repeat(41)]) {
      const r = await as('authenticated', A, 'insert into public.categories (label) values ($1)', [label]);
      assert.match(r.error ?? '', /check constraint/, JSON.stringify(label));
    }
  });

  test('visitors cannot read or add categories; owner and id are not writable', async () => {
    assert.match((await as('anon', null, 'select * from public.categories')).error, /permission denied/);
    assert.match((await as('anon', null, `insert into public.categories (label) values ('x')`)).error, /permission denied/);
    assert.match(
      (await as('authenticated', A, `insert into public.categories (label, user_id) values ('x', '${B}')`)).error,
      /permission denied/,
    );
  });

  test('categories cannot be renamed or deleted from the API (not supported yet)', async () => {
    assert.match((await as('authenticated', A, `update public.categories set label = 'x'`)).error, /permission denied/);
    assert.match((await as('authenticated', A, 'delete from public.categories')).error, /permission denied/);
  });

  test('API roles cannot call the seeding function', async () => {
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await as(role, null, "select has_function_privilege('public.seed_default_categories()', 'execute') as ok");
      assert.equal(rows[0].ok, false, role);
    }
  });
});

describe('items and their categories', () => {
  let db, as, categoryId, idA, todoA, readA, readB, podcastsA;
  const create = (user, title, cats, url = null) =>
    as('authenticated', user, 'select public.create_item($1, $2, $3) as id', [title, url, cats]);
  const catsOf = async (user, id) =>
    (await as('authenticated', user, 'select category_id from public.item_categories where item_id = $1 order by 1', [id])).rows.map(
      (r) => r.category_id,
    );

  before(async () => {
    ({ db, as, categoryId } = await createDatabase([A, B]));
    todoA = await categoryId(A, 'À faire');
    readA = await categoryId(A, 'À lire');
    readB = await categoryId(B, 'À lire');
    idA = (await create(A, 'Todo A', [todoA])).rows[0].id;
    await create(B, 'Lire B', [readB], 'https://example.com');
  });
  after(() => db.close());

  test('the owner is set from the session, on the item and its links', async () => {
    assert.deepEqual((await as('authenticated', A, 'select user_id, done from public.items where id = $1', [idA])).rows, [
      { user_id: A, done: false },
    ]);
    assert.deepEqual((await as('authenticated', A, 'select user_id from public.item_categories')).rows, [{ user_id: A }]);
  });

  test('an item can have several categories, listed once each', async () => {
    const { rows } = await create(A, 'Les deux', [readA, todoA, readA]);
    assert.deepEqual(await catsOf(A, rows[0].id), [todoA, readA].sort((a, b) => a - b));
    await as('authenticated', A, 'delete from public.items where id = $1', [rows[0].id]);
  });

  test('an item needs at least one category', async () => {
    assert.match((await create(A, 'x', [])).error ?? '', /at least one category/);
    assert.match((await as('authenticated', A, `insert into public.items (title) values ('x')`)).error ?? '', /at least one category/);
    assert.match(
      (await as('authenticated', A, 'delete from public.item_categories where item_id = $1', [idA])).error ?? '',
      /at least one category/,
    );
    assert.deepEqual(await catsOf(A, idA), [todoA]);
  });

  test('update_item replaces title, link and categories together', async () => {
    const { rows } = await as('authenticated', A, `insert into public.categories (label) values ('Podcasts') returning id`);
    podcastsA = rows[0].id;
    const r = await as('authenticated', A, 'select public.update_item($1, $2, $3, $4)', [idA, 'Todo A2', 'https://a.fr', [readA, podcastsA]]);
    assert.equal(r.error, undefined);
    assert.deepEqual((await as('authenticated', A, 'select title, url from public.items where id = $1', [idA])).rows, [
      { title: 'Todo A2', url: 'https://a.fr' },
    ]);
    assert.deepEqual(await catsOf(A, idA), [readA, podcastsA]);
    assert.match((await as('authenticated', A, 'select public.update_item($1, $2, $3, $4)', [idA, 'x', null, []])).error, /at least one/);
    await as('authenticated', A, 'select public.update_item($1, $2, $3, $4)', [idA, 'Todo A', null, [todoA]]);
  });

  test('each user only sees their own items and links', async () => {
    assert.deepEqual((await as('authenticated', A, 'select title from public.items')).rows, [{ title: 'Todo A' }]);
    assert.deepEqual((await as('authenticated', B, 'select title from public.items')).rows, [{ title: 'Lire B' }]);
    assert.equal((await as('authenticated', B, 'select * from public.item_categories')).rows.length, 1);
  });

  test('visitors without a session get nothing', async () => {
    for (const sql of [
      'select * from public.items',
      'select * from public.item_categories',
      'delete from public.items',
      `select public.create_item('x', null, array[${todoA}]::bigint[])`,
      `select public.update_item(${idA}, 'x', null, array[${todoA}]::bigint[])`,
    ]) {
      assert.match((await as('anon', null, sql)).error ?? '', /permission denied/, sql);
    }
    assert.deepEqual((await as('authenticated', null, 'select * from public.items')).rows, []);
  });

  test("a user cannot touch someone else's items", async () => {
    assert.deepEqual((await as('authenticated', B, 'update public.items set done = true where id = $1 returning id', [idA])).rows, []);
    assert.deepEqual((await as('authenticated', B, 'delete from public.items where id = $1 returning id', [idA])).rows, []);
    assert.deepEqual((await as('authenticated', B, 'delete from public.item_categories where item_id = $1 returning item_id', [idA])).rows, []);
    assert.match((await as('authenticated', B, 'select public.update_item($1, $2, $3, $4)', [idA, 'x', null, [readB]])).error, /not found/);
    assert.match(
      (await as('authenticated', B, 'insert into public.item_categories (item_id, category_id) values ($1, $2)', [idA, readB])).error ?? '',
      /foreign key/,
    );
  });

  test("a user cannot file an item under someone else's category", async () => {
    assert.match((await create(A, 'x', [readB])).error ?? '', /foreign key/);
    const r = await as('authenticated', A, 'insert into public.item_categories (item_id, category_id) values ($1, $2)', [idA, readB]);
    assert.match(r.error ?? '', /foreign key/);
  });

  test('owner, id and timestamps cannot be set by the client', async () => {
    for (const sql of [
      `insert into public.items (title, user_id) values ('x', '${B}')`,
      `insert into public.item_categories (item_id, category_id, user_id) values (${idA}, ${readA}, '${B}')`,
      `update public.items set user_id = '${B}' where id = ${idA}`,
      `update public.items set created_at = now() - interval '1 year' where id = ${idA}`,
      `update public.items set updated_at = now() - interval '1 year' where id = ${idA}`,
      `update public.item_categories set category_id = ${readA}`,
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

  test('API roles cannot call the trigger functions directly', async () => {
    for (const fn of ['public.items_set_updated_at()', 'public.items_check_has_category()']) {
      for (const role of ['anon', 'authenticated']) {
        const { rows } = await as(role, null, `select has_function_privilege('${fn}', 'execute') as ok`);
        assert.equal(rows[0].ok, false, `${role} ${fn}`);
      }
    }
  });

  test('invalid data is rejected by the database', async () => {
    for (const [title, url] of [
      ['x', 'javascript:alert(1)'],
      ['x', 'ftp://x'],
      ['x', 'https://a b'],
      ['', null],
      [' x ', null],
      ['a'.repeat(201), null],
    ]) {
      assert.match((await create(A, title, [todoA], url)).error ?? '', /check constraint/, JSON.stringify([title, url]));
    }
  });

  test('a category in use cannot be deleted, even by the database owner', async () => {
    await assert.rejects(db.query('delete from public.categories where id = $1', [todoA]), /foreign key/);
  });

  test('deleting an item removes its links', async () => {
    assert.equal((await as('authenticated', A, 'delete from public.items where id = $1 returning id', [idA])).rows.length, 1);
    assert.deepEqual(await catsOf(A, idA), []);
  });
});

describe('migration to custom categories', () => {
  test('existing items keep their category', async () => {
    const { db, migrate } = await createDatabase([A], { before: '20261124' });
    await db.query(
      `insert into public.items (user_id, title, category) values ($1, 'a', 'todo'), ($1, 'b', 'investigate'), ($1, 'c', 'read'), ($1, 'd', 'watch')`,
      [A],
    );
    await migrate();
    const { rows } = await db.query(
      `select i.title, c.label from public.items i
       join public.item_categories ic on ic.item_id = i.id
       join public.categories c on c.id = ic.category_id order by i.title`,
    );
    assert.deepEqual(
      rows.map((r) => [r.title, r.label]),
      [['a', 'À faire'], ['b', 'À investiguer'], ['c', 'À lire'], ['d', 'À regarder']],
    );
    await db.close();
  });
});
