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
  src/utils.js             CATEGORIES, validation, row mapping, sorting, secret-key check
  src/components/*.jsx     Login, AddForm, Filters, Section, ItemRow, Toast
  public/                  manifest.webmanifest, icon.svg
supabase/migrations/       SQL schema, privileges and row-level security
scripts/export.js          JSON backup through the API (as the signed-in user)
scripts/import.js          JSON backup or old SQLite file → SQL for the SQL editor
netlify.toml               build settings and security headers
test/                      node:test — utils, database rules (PGlite), import
```

## Data model (`public.items`)

| Column | Type | Rule |
|---|---|---|
| `id` | `bigint` identity | set by the database |
| `user_id` | `uuid` → `auth.users` | defaults to `auth.uid()`, not writable by clients |
| `title` | `text` | trimmed, 1–200 chars |
| `url` | `text` null | `^https?://\S+$`, ≤ 2048 chars |
| `category` | `text` | `todo`, `investigate`, `read`, `watch` |
| `done` | `boolean` | default `false` |
| `created_at`, `updated_at` | `timestamptz` | set by the database; `updated_at` by trigger |

The front end validates the same rules first to show readable messages; the database is the source of truth.

## Security

The publishable key and project URL are in the public bundle (the login screen needs them). The key is harmless on its own because access control lives in Postgres:

- `anon` has no privilege on `items`.
- `authenticated` has `select`/`delete` on the table, and `insert`/`update` on `title, url, category, done` only, so owner, id and timestamps cannot be forged.
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

## Acceptance criteria mapping

Automated (`npm test`): 1 (database side: no access without a session), 4 (database checks), user isolation, import.
Manual (browser): 2, 3, 5, 6, 7, 9, 10. Criterion 8 (persistence) is Supabase's.
