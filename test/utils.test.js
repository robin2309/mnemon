import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY_ORDER, isSecretKey, sortItems, toItem, toRow, validateDraft } from '../web/src/utils.js';

const jwt = (payload) =>
  ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

test('isSecretKey: refuses secret and service_role keys, accepts publishable/anon', () => {
  assert.equal(isSecretKey('sb_secret_abc'), true);
  assert.equal(isSecretKey(jwt({ role: 'service_role' })), true);
  assert.equal(isSecretKey('sb_publishable_abc'), false);
  assert.equal(isSecretKey(jwt({ role: 'anon' })), false);
  assert.equal(isSecretKey(undefined), false);
  assert.equal(isSecretKey('not.a.jwt'), false);
});

test('toRow: keeps writable fields only, trims, empty link → null', () => {
  assert.deepEqual(toRow({ title: '  Dune ', url: '  ', category: 'read', id: 3, user_id: 'x' }), {
    title: 'Dune',
    url: null,
    category: 'read',
  });
  assert.deepEqual(toRow({ done: true }), { done: true });
  assert.deepEqual(toRow({ url: ' https://a.b ' }), { url: 'https://a.b' });
});

test('toItem: database row → UI item', () => {
  assert.deepEqual(
    toItem({ id: 1, title: 't', url: null, category: 'todo', done: false, created_at: 'c', updated_at: 'u' }),
    { id: 1, title: 't', url: null, category: 'todo', done: false, createdAt: 'c', updatedAt: 'u' },
  );
});

test('validateDraft', () => {
  assert.equal(validateDraft({ title: 'x', url: '' }), null);
  assert.ok(validateDraft({ title: ' ', url: '' }));
  assert.ok(validateDraft({ title: 'x', url: 'javascript:alert(1)' }));
  assert.ok(validateDraft({ title: 'a'.repeat(201), url: '' }));
});

test('sortItems: category order, not done first, newest first', () => {
  const items = [
    { id: 1, category: 'read', done: false, createdAt: '2026-01-01' },
    { id: 2, category: 'todo', done: true, createdAt: '2026-01-03' },
    { id: 3, category: 'todo', done: false, createdAt: '2026-01-01' },
    { id: 4, category: 'todo', done: false, createdAt: '2026-01-02' },
  ];
  assert.deepEqual(sortItems(items, CATEGORY_ORDER).map((i) => i.id), [4, 3, 2, 1]);
});
