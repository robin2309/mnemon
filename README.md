# Mnémon

Application web personnelle pour noter des idées à **faire**, **investiguer**, **lire** et **regarder**, depuis l'ordinateur ou le téléphone. Spécifications : [`SPECS.md`](SPECS.md). Conception technique : [`specs/ideas_design.md`](specs/ideas_design.md).

- Serveur : Node.js ≥ 22, [Hono](https://hono.dev), SQLite (`better-sqlite3`)
- Front : React 19, construit par Vite dans `dist/` et servi par le même serveur

> **Écart avec SPECS.md** : le front est en React (source dans `web/`) au lieu de JS vanilla dans `public/`. Il faut donc une étape de build (`npm run build`), faite automatiquement dans le `Dockerfile`.

## Lancement local

```sh
npm install
cp .env.example .env      # puis renseigner APP_PASSWORD et SESSION_SECRET
npm run dev
```

Ouvrir <http://localhost:5173> (Vite, rechargement à chaud). Vite redirige `/api`, `/login` et `/logout` vers le serveur Hono sur le port 3000.

Pour tester la version de production en local :

```sh
npm run build
node --env-file=.env server.js   # http://localhost:3000
```

Tests de l'API : `npm test`.

> Node 23 n'est pas pris en charge : `better-sqlite3` 13 y plante au chargement. Utiliser Node 22 (LTS) ou 24+.

## Premier déploiement (Fly.io)

```sh
fly launch --no-deploy                     # garder le fly.toml existant, choisir un nom d'app
fly volumes create mnemon_data --size 1     # même région que primary_region
fly secrets set APP_PASSWORD='…' SESSION_SECRET="$(openssl rand -hex 32)"
fly deploy
fly scale count 1                          # SQLite : une seule machine
```

Déploiements suivants : `fly deploy`.

Changer `SESSION_SECRET` déconnecte tous les appareils.

## Sauvegarde de la base

L'app expose `GET /api/export` (session requise) : il renvoie une copie cohérente et autonome de toute la base SQLite, même pendant que l'app tourne. Pour la récupérer depuis votre machine :

```sh
npm run export -- --url https://<app>.fly.dev              # → ./mnemon-<date>.db
npm run export -- --url https://<app>.fly.dev --out backups/
```

- Mot de passe : variable `MNEMON_PASSWORD`, sinon demandé au clavier (jamais en argument, pour ne pas finir dans l'historique du shell).
- URL : `--url` ou variable `MNEMON_URL`.
- Le script vérifie l'intégrité de la copie, affiche le nombre d'items et n'écrase jamais un fichier existant.
- HTTPS obligatoire, sauf pour `localhost`.

Pour quitter Fly.io : récupérer un export, le placer sur le nouvel hôte et pointer `DB_PATH` dessus.

Sans le script, le même fichier se télécharge depuis un navigateur connecté en ouvrant `https://<app>.fly.dev/api/export`.

## Sécurité, en bref

- Mot de passe unique comparé en temps constant (SHA-256 + `timingSafeEqual`), délai d'1 s sur chaque échec, tentatives journalisées avec l'IP.
- Cookie de session signé, `HttpOnly`, `SameSite=Lax`, `Secure` en production, valable 1 an.
- Protection CSRF (vérification de l'origine + corps JSON obligatoire pour l'API), en-têtes de sécurité et CSP stricte.
- Toutes les entrées validées côté serveur ; requêtes SQL paramétrées ; seuls les liens `http(s)` sont acceptés et affichés.
