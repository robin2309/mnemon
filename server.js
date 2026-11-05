import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { csrf } from 'hono/csrf';
import { bodyLimit } from 'hono/body-limit';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { getConnInfo } from '@hono/node-server/conninfo';
import { CATEGORIES, openDb, validateCreate, validatePatch } from './db.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SESSION_COOKIE = 'ideas_session';
const SESSION_MAX_AGE_S = 365 * 24 * 60 * 60; // 1 year
const PUBLIC_PATHS = new Set(['/login', '/manifest.webmanifest', '/icon.svg']);

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(event, data = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));
}

function clientIp(c) {
  const fwd = c.req.header('fly-client-ip');
  if (fwd) return fwd;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function parseId(raw) {
  if (!/^[1-9]\d{0,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Builds the Hono app. Kept separate from `serve()` so tests can call `app.request()`.
 * @param {{ db: ReturnType<typeof openDb>, password: string, sessionSecret: string,
 *           secureCookies?: boolean, distDir?: string, loginDelayMs?: number }} opts
 */
export function createApp({
  db,
  password,
  sessionSecret,
  secureCookies = false,
  distDir = path.join(ROOT, 'dist'),
  loginDelayMs = 1000,
}) {
  const passwordHash = sha256(password);

  const loginHtmlPath = [path.join(distDir, 'login.html'), path.join(ROOT, 'web', 'login.html')].find((p) =>
    fs.existsSync(p),
  );
  const loginHtml = loginHtmlPath ? fs.readFileSync(loginHtmlPath, 'utf8') : '<!doctype html><p>login.html manquant</p>';
  // Static, server-controlled string — no user input is ever injected here.
  const loginHtmlError = loginHtml.replace(
    '<!--LOGIN_ERROR-->',
    '<p class="error" role="alert">Mot de passe incorrect.</p>',
  );

  async function hasValidSession(c) {
    const value = await getSignedCookie(c, sessionSecret, SESSION_COOKIE);
    if (!value) return false;
    const m = /^v1\.(\d{13})$/.exec(value);
    if (!m) return false;
    const issuedAt = Number(m[1]);
    const age = Date.now() - issuedAt;
    return age >= -60_000 && age < SESSION_MAX_AGE_S * 1000;
  }

  const app = new Hono();

  // --- Security headers -----------------------------------------------------
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: 'no-referrer',
      strictTransportSecurity: secureCookies ? 'max-age=31536000; includeSubDomains' : false,
    }),
  );

  // Origin check for "simple" (form / text) state-changing requests: login, logout, DELETE.
  // Compared on host only: TLS is terminated by the Fly proxy, so the request URL seen
  // by Node is http:// while the browser's Origin is https://.
  app.use(
    '*',
    csrf({
      origin: (origin, c) => {
        try {
          return new URL(origin).host === c.req.header('host');
        } catch {
          return false;
        }
      },
    }),
  );

  // --- Error handling -------------------------------------------------------
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    log('error', { path: c.req.path, message: err.message, stack: err.stack });
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'Erreur serveur.' }, 500);
    return c.text('Erreur serveur.', 500);
  });

  // --- Public routes --------------------------------------------------------
  app.get('/login', async (c) => {
    if (await hasValidSession(c)) return c.redirect('/', 302);
    c.header('Cache-Control', 'no-store');
    return c.html(c.req.query('error') ? loginHtmlError : loginHtml);
  });

  app.post('/login', bodyLimit({ maxSize: 4 * 1024 }), async (c) => {
    let submitted = '';
    try {
      const body = await c.req.parseBody();
      if (typeof body.password === 'string') submitted = body.password;
    } catch {
      /* treated as a failed attempt */
    }
    const ok = crypto.timingSafeEqual(sha256(submitted), passwordHash);
    const ip = clientIp(c);
    if (!ok) {
      log('login_failed', { ip });
      await sleep(loginDelayMs);
      return c.redirect('/login?error=1', 302);
    }
    await setSignedCookie(c, SESSION_COOKIE, `v1.${Date.now()}`, sessionSecret, {
      path: '/',
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'Lax',
      maxAge: SESSION_MAX_AGE_S,
    });
    log('login_success', { ip });
    return c.redirect('/', 302);
  });

  // --- Auth gate ------------------------------------------------------------
  app.use('*', async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) return next();
    if (await hasValidSession(c)) return next();
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) {
      return c.json({ error: 'Non authentifié.' }, 401);
    }
    return c.redirect('/login', 302);
  });

  app.post('/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: secureCookies });
    log('logout', { ip: clientIp(c) });
    return c.redirect('/login', 302);
  });

  // --- API ------------------------------------------------------------------
  const api = new Hono();

  api.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });
  api.use('*', bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: 'Requête trop volumineuse.' }, 413) }));

  async function readJson(c) {
    const ct = c.req.header('content-type') ?? '';
    if (!ct.toLowerCase().startsWith('application/json')) {
      throw new HTTPException(415, { res: c.json({ error: 'Content-Type application/json attendu.' }, 415) });
    }
    try {
      return await c.req.json();
    } catch {
      throw new HTTPException(400, { res: c.json({ error: 'JSON invalide.' }, 400) });
    }
  }

  api.get('/categories', (c) => c.json(CATEGORIES));

  api.get('/items', (c) => c.json(db.listItems()));

  api.post('/items', async (c) => {
    const { value, error } = validateCreate(await readJson(c));
    if (error) return c.json({ error }, 400);
    return c.json(db.createItem(value), 201);
  });

  api.patch('/items/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    if (id === null) return c.json({ error: 'Item introuvable.' }, 404);
    const { value, error } = validatePatch(await readJson(c));
    if (error) return c.json({ error }, 400);
    const item = db.updateItem(id, value);
    if (!item) return c.json({ error: 'Item introuvable.' }, 404);
    return c.json(item);
  });

  api.delete('/items/:id', (c) => {
    const id = parseId(c.req.param('id'));
    if (id === null || !db.deleteItem(id)) return c.json({ error: 'Item introuvable.' }, 404);
    return c.body(null, 204);
  });

  api.notFound((c) => c.json({ error: 'Route inconnue.' }, 404));
  app.route('/api', api);

  // --- Static front-end (built by Vite into dist/) ---------------------------
  const relDist = path.relative(process.cwd(), distDir) || '.';
  app.use(
    '*',
    serveStatic({
      root: relDist,
      onFound: (p, c) => {
        c.header('Cache-Control', p.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );

  return app;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

function main() {
  const { APP_PASSWORD, SESSION_SECRET } = process.env;
  const PORT = Number(process.env.PORT ?? 3000);
  const DB_PATH = process.env.DB_PATH ?? './data/ideas.db';
  const isProd = process.env.NODE_ENV === 'production';

  if (!APP_PASSWORD) {
    console.error('APP_PASSWORD est obligatoire. Arrêt.');
    process.exit(1);
  }
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    console.error('SESSION_SECRET est obligatoire (32 caractères minimum). Arrêt.');
    process.exit(1);
  }
  const distDir = path.join(ROOT, 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    console.warn('dist/index.html introuvable : lancez `npm run build` (ou `npm run dev`).');
  }

  const db = openDb(DB_PATH);
  const app = createApp({ db, password: APP_PASSWORD, sessionSecret: SESSION_SECRET, secureCookies: isProd, distDir });

  const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
    log('listening', { port: info.port, db: DB_PATH, prod: isProd });
  });

  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
