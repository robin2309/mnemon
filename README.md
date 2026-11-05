# Ideas

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
fly volumes create ideas_data --size 1     # même région que primary_region
fly secrets set APP_PASSWORD='…' SESSION_SECRET="$(openssl rand -hex 32)"
fly deploy
fly scale count 1                          # SQLite : une seule machine
```

Déploiements suivants : `fly deploy`.

Changer `SESSION_SECRET` déconnecte tous les appareils.

## Sauvegarde de la base

```sh
fly ssh sftp get /data/ideas.db ./ideas-backup.db
```

La base est en mode WAL : pour une copie parfaitement cohérente, faire la sauvegarde quand l'app est au repos (ou `fly ssh console -C "sqlite3 /data/ideas.db '.backup /data/backup.db'"` si `sqlite3` est installé dans l'image).

## Sécurité, en bref

- Mot de passe unique comparé en temps constant (SHA-256 + `timingSafeEqual`), délai d'1 s sur chaque échec, tentatives journalisées avec l'IP.
- Cookie de session signé, `HttpOnly`, `SameSite=Lax`, `Secure` en production, valable 1 an.
- Protection CSRF (vérification de l'origine + corps JSON obligatoire pour l'API), en-têtes de sécurité et CSP stricte.
- Toutes les entrées validées côté serveur ; requêtes SQL paramétrées ; seuls les liens `http(s)` sont acceptés et affichés.
