import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findCategoryByLabel,
  isSecretKey,
  sortItems,
  toCategory,
  toItem,
  toItemParams,
  toRow,
  validateCategoryLabel,
  validateDraft,
} from '../web/src/utils.js';

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
  assert.deepEqual(toRow({ title: '  Dune ', url: '  ', categories: ['7'], id: 3, user_id: 'x' }), {
    title: 'Dune',
    url: null,
  });
  assert.deepEqual(toRow({ done: true }), { done: true });
  assert.deepEqual(toRow({ url: ' https://a.b ' }), { url: 'https://a.b' });
});

test('toItemParams: draft → create_item / update_item parameters', () => {
  assert.deepEqual(toItemParams({ title: ' Dune ', url: '', categories: ['7', '2', '7'] }), {
    p_title: 'Dune',
    p_url: null,
    p_category_ids: [7, 2],
  });
});

test('toItem / toCategory: database rows → UI objects keyed by id string', () => {
  assert.deepEqual(
    toItem({
      id: 1,
      title: 't',
      url: null,
      done: false,
      created_at: 'c',
      updated_at: 'u',
      item_categories: [{ category_id: 12 }, { category_id: 7 }],
    }),
    { id: 1, title: 't', url: null, categories: ['7', '12'], done: false, createdAt: 'c', updatedAt: 'u' },
  );
  assert.deepEqual(toCategory({ id: 7, label: 'Podcasts' }), { key: '7', label: 'Podcasts' });
});

test('category labels: validation and case-insensitive lookup', () => {
  assert.equal(validateCategoryLabel(' Podcasts '), null);
  assert.ok(validateCategoryLabel('  '));
  assert.ok(validateCategoryLabel('a'.repeat(41)));
  const cats = [{ key: '1', label: 'À faire' }, { key: '2', label: 'Podcasts' }];
  assert.equal(findCategoryByLabel(cats, ' podcasts ')?.key, '2');
  assert.equal(findCategoryByLabel(cats, 'à FAIRE')?.key, '1');
  assert.equal(findCategoryByLabel(cats, 'Films'), null);
});

test('validateDraft', () => {
  assert.equal(validateDraft({ title: 'x', url: '' }), null);
  assert.ok(validateDraft({ title: ' ', url: '' }));
  assert.ok(validateDraft({ title: 'x', url: 'javascript:alert(1)' }));
  assert.ok(validateDraft({ title: 'a'.repeat(201), url: '' }));
  assert.equal(validateDraft({ title: 'x', url: '', categories: ['1'] }), null);
  assert.ok(validateDraft({ title: 'x', url: '', categories: [] }));
});

test('sortItems: not done first, newest first, then highest id', () => {
  const items = [
    { id: 1, done: false, createdAt: '2026-01-01' },
    { id: 2, done: true, createdAt: '2026-01-03' },
    { id: 3, done: false, createdAt: '2026-01-01' },
    { id: 4, done: false, createdAt: '2026-01-02' },
  ];
  assert.deepEqual(sortItems(items).map((i) => i.id), [4, 3, 1, 2]);
});
