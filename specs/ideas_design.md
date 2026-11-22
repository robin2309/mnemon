# Mnémon — Technical design

Implements `SPECS.md`, with one deliberate deviation requested by the owner: **the front end is React** (instead of vanilla JS).

## Deviation from SPECS.md §2.1 / §2.2 / §2.7

| SPECS.md | Implemented | Why |
|---|---|---|
| `public/index.html` + `app.js` + `style.css`, vanilla JS, no build | React 19 app in `web/`, built by Vite into `dist/` | Owner asked for React. Vite is the smallest viable build step. Still JavaScript (no TypeScript). |
| `public/login.html` | `web/login.html` — plain HTML form, **no JS**, copied to `dist/login.html` by the build | Login must work without loading the (protected) app bundle. |
| `public/manifest.webmanifest`, `public/icon.svg` | `web/public/…` → copied as-is to `dist/` | Vite convention. |
| Dockerfile `npm ci --omit=dev` | Multi-stage: build stage runs `npm ci && npm run build`; runtime stage `npm ci --omit=dev` + `dist/` | React/Vite are devDependencies; runtime only needs Hono + better-sqlite3. |

Everything else (API, data model, auth, deployment) follows SPECS.md as written.

## Layout

```
server.js        Hono app: security headers, auth, /api, static dist/
db.js            SQLite connection, migration, CATEGORIES, queries, validation
web/             Vite root (React source)
  index.html, login.html
  src/main.jsx, App.jsx, api.js, utils.js, components/*.jsx, style.css
  public/manifest.webmanifest, public/icon.svg
dist/            build output (gitignored), served by server.js
test/api.test.js node:test suite against app.request() with an in-memory DB
```

## Three perspectives

**Backend**
- `db.js` owns `CATEGORIES` (single source of truth) and pure validators `validateCreate` / `validatePatch` that return `{ value }` or `{ error }`.
- All SQL uses prepared statements with bound parameters. PATCH builds its `SET` clause only from a fixed whitelist of column names.
- Errors: validation → `400 { error }`, unknown id / non-integer id → `404`, malformed JSON → `400`, body > 16 KB → `413`, unexpected → `500 { error: "Erreur serveur" }` (details only in server log).

**Frontend**
- `App` loads categories + items, holds state, derives filtered/grouped sections with `useMemo`.
- Toggle and delete are optimistic with rollback + error toast; create and edit wait for the server so server validation messages can be shown.
- Any `401` → `location.assign('/login')`.
- React escapes text by default; no `dangerouslySetInnerHTML`. Links are only rendered as `<a>` if the protocol is `http(s)` (defence in depth), with `target="_blank" rel="noopener noreferrer"`.

**Security**
- Auth: single password compared with `timingSafeEqual` on SHA-256 digests; 1 s delay on failures; signed `HttpOnly`, `SameSite=Lax`, `Secure` (prod) cookie carrying the issue timestamp, rejected after 1 year. Rotating `SESSION_SECRET` revokes every session.
- Server refuses to start without `APP_PASSWORD` / `SESSION_SECRET` (and requires a ≥ 32-char secret).
- Authorization: single user, so being authenticated is the only gate; every `/api/*` route sits behind the middleware.
- CSRF: `SameSite=Lax` + Hono `csrf()` (Origin check) on all non-GET requests + API only accepts `application/json` bodies (forces a CORS preflight cross-origin).
- Headers: `secureHeaders()` with a strict CSP (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`).
- Logging: login success/failure (with client IP), logout, and unexpected errors.
- No sensitive data in responses — items only.

## Acceptance criteria mapping

Automated (`npm test`): 1, 4, 8 (persistence via file DB reopen), API side of 2, 3, 5, 6, 7.
Manual (browser): UI side of 2, 3, 5, 6, 7, 9, 10.
