# Mnémon — Technical design

Implements `SPECS.md`. The app is a static React front end on Netlify that talks directly to Supabase (Postgres + Auth). There is no application server.

## Layout

```
web/                       Vite root (React source)
  index.html
  src/main.jsx             Root: waits for the Supabase session, shows Login or App
  src/App.jsx              state, optimistic updates, filters
  src/api.js               items CRUD with supabase-js, error mapping
  src/supabase.js          client from VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
  src/utils.js             validation, row mapping, sorting, secret-key check
  src/components/*.jsx     Login, AddForm, CategoryPicker, Filters, Section, ItemRow, Toast
  public/                  manifest.webmanifest, icon.svg
supabase/migrations/       SQL schema, privileges and row-level security
scripts/export.js          JSON backup through the API (as the signed-in user)
scripts/import.js          JSON backup or old SQLite file → SQL for the SQL editor
netlify.toml               build settings and security headers
test/                      node:test — utils, database rules (PGlite), import
```

## Data model

`public.categories`: `id`, `user_id` (defaults to `auth.uid()`), `label` (trimmed, 1–40 chars, unique per user ignoring case), `created_at`. Display order is creation order (`id`). Every user gets the four defaults (À faire, À investiguer, À lire, À regarder): existing users in the migration, new ones through a `security definer` trigger on `auth.users` (`seed_default_categories`, not executable by API roles). Categories can be added and deleted from the app, not renamed. Deleting is allowed only for an unused category: the `item_categories` foreign key (`on delete restrict`) refuses the others with `23503`, which the client turns into a readable message (migration `20261125000000_delete_unused_categories.sql`).

`public.items`:

| Column | Type | Rule |
|---|---|---|
| `id` | `bigint` identity | set by the database |
| `user_id` | `uuid` → `auth.users` | defaults to `auth.uid()`, not writable by clients |
| `title` | `text` | trimmed, 1–200 chars |
| `url` | `text` null | `^https?://\S+$`, ≤ 2048 chars |
| `done` | `boolean` | default `false` |
| `created_at`, `updated_at` | `timestamptz` | set by the database; `updated_at` by trigger |

`public.item_categories` (many-to-many): `item_id`, `category_id`, `user_id` (defaults to `auth.uid()`), primary key `(item_id, category_id)`. Composite FKs `(item_id, user_id)` → `items (id, user_id)` `on delete cascade` and `(category_id, user_id)` → `categories (id, user_id)` `on delete restrict`, so a link only joins rows of the same owner, and a category in use cannot be deleted.

Every item has at least one category: deferred constraint triggers (`items_need_category` after insert on `items`, `item_categories_keep_one` after delete on `item_categories`) check it at commit. Writes go through `create_item(p_title, p_url, p_category_ids)` and `update_item(p_id, p_title, p_url, p_category_ids)`, `security invoker` functions that write the item and its links in one transaction; toggling `done` is a plain update.

The front end validates the same rules first to show readable messages; the database is the source of truth.

## Security

The publishable key and project URL are in the public bundle (the login screen needs them). The key is harmless on its own because access control lives in Postgres:

- `anon` has no privilege on `items`, `categories` or `item_categories`, nor on the two functions.
- `authenticated` has `select`/`delete` on `items`, and `insert`/`update` on `title, url, done` only, so owner, id and timestamps cannot be forged; on `categories`, `select`, `insert (label)` and `delete` (own rows only, by policy); on `item_categories`, `select`/`delete` and `insert (item_id, category_id)`; `execute` on `create_item` / `update_item`. The trigger functions are not executable by API roles.
- RLS policies restrict every operation to `auth.uid() = user_id`.
- Sign-ups are disabled in the Supabase dashboard; the single account is created by hand.
- The client refuses to start with a secret / `service_role` key (`isSecretKey`).
- Sessions: supabase-js stores the session in `localStorage` and refreshes it; it lasts until sign-out (refresh tokens do not expire by default).
- Netlify headers: CSP (`connect-src 'self' https://*.supabase.co`, no inline scripts, `frame-ancestors 'none'`), `nosniff`, `no-referrer`, HSTS, `noindex`.
- React escapes text; links render as `<a>` only for `http(s)` URLs, with `rel="noopener noreferrer"`.

`test/database.test.js` runs the migration on PGlite with a stand-in for Supabase's roles and `auth.uid()`, and checks each of these rules.

## Front end behaviour

- `Root` subscribes to `onAuthStateChange`: no session → `Login` (email + password), session → `App`.
- Toggle and delete are optimistic with rollback and a toast; create and edit wait for the database.
- A permission / expired-session error signs out locally, which brings back the login screen.
- Lists are fetched in pages of 1000 rows (Supabase's default limit) and sorted client-side.
- In the UI, a category's key is its id as a string (`toCategory`); an item's `categories` is a list of keys (`toItem`, from the embedded `item_categories`), and `toItemParams` builds the function parameters.
- `CategoryPicker` (add and edit forms) is a set of toggle chips plus "+ Nouvelle", which shows a name field; on submit it reuses a category with the same name (case-insensitive) or creates one, then saves the item with it.
- An item is listed in the section of each of its categories; the row shows its other categories as tags.
- Backups: `npm run export` writes version 3 JSON (`categories`: names in order; each item's `categories` is a list of names). `npm run import` accepts versions 3, 2 (one name), 1 (fixed keys) and the old SQLite file, creating missing categories.

## Acceptance criteria mapping

Automated (`npm test`): 1 (database side: no access without a session), 4 (database checks), user isolation, import.
Manual (browser): 2, 3, 5, 6, 7, 9, 10. Criterion 8 (persistence) is Supabase's.
