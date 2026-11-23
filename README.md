# Mnémon

Application web personnelle pour noter des idées à **faire**, **investiguer**, **lire** et **regarder**, depuis l'ordinateur ou le téléphone. Spécifications : [`SPECS.md`](SPECS.md). Conception technique : [`specs/mnemon_design.md`](specs/mnemon_design.md).

- Front : React 19, construit par Vite dans `dist/`, hébergé sur **Netlify**
- Données et connexion : **Supabase** (Postgres + Auth), appelé directement depuis le navigateur avec `@supabase/supabase-js`
- Pas de serveur à faire tourner.

## Sécurité : ce qui est public, ce qui ne l'est pas

Le front contient l'URL du projet Supabase et sa **clé publishable** (ex-clé `anon`). C'est voulu et inévitable : l'écran de connexion doit pouvoir parler à Supabase. Cette clé ne donne accès à **rien** sans être connecté :

- un visiteur non connecté n'a aucun droit sur la table `items` (lecture comme écriture) ;
- un utilisateur connecté ne voit et ne modifie que **ses** items (row-level security sur `user_id`) ;
- le propriétaire, l'id et les dates sont fixés par la base, pas par le navigateur ;
- les inscriptions sont fermées (à configurer, voir plus bas) : personne d'autre ne peut créer de compte.

Ces règles sont dans [`supabase/migrations/`](supabase/migrations/) et testées par `npm test`.

**Ne jamais** mettre la clé *secret* / `service_role` dans ce projet ni dans Netlify : elle contourne toutes ces protections. L'app refuse de démarrer si elle en détecte une.

## Mise en place de Supabase (une fois)

1. Créer un projet sur [supabase.com](https://supabase.com).
2. **SQL Editor** → coller et exécuter [`supabase/migrations/20261122000000_create_items.sql`](supabase/migrations/20261122000000_create_items.sql).
   (Ou, avec la CLI Supabase : `supabase link` puis `supabase db push`.)
3. **Authentication → Users → Add user** : créer votre compte (email + mot de passe long), en cochant *Auto Confirm User*.
4. **Authentication → Sign In / Providers** : désactiver **Allow new users to sign up**. Indispensable : sinon n'importe qui pourrait se créer un compte (il ne verrait pas vos items, mais pourrait remplir la base).
5. **Project Settings → API Keys** : noter l'URL du projet et la clé **publishable**.

## Lancement local

```sh
npm install
cp .env.example .env      # puis renseigner VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev               # http://localhost:5173
```

Tests : `npm test` (fonctions du front, règles d'accès de la base sur un Postgres en mémoire, import). Node ≥ 22.13.

## Déploiement sur Netlify

1. **Add new site → Import from Git** et choisir ce dépôt. Build et dossier publié sont lus dans [`netlify.toml`](netlify.toml) (`npm run build`, `dist`).
2. **Site configuration → Environment variables** : ajouter `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` (sans cocher *Contains secret values* : elles finissent dans le JS public).
3. Déployer. Chaque push sur `main` redéploie.
4. Optionnel : dans Supabase, **Authentication → URL Configuration**, mettre l'URL Netlify comme *Site URL* (utile pour les emails de réinitialisation de mot de passe).

`netlify.toml` pose aussi les en-têtes de sécurité (CSP limitée au site et à `*.supabase.co`, pas d'iframe, `noindex`).

## Sauvegarde et restauration

```sh
npm run export                       # → ./mnemon-<date>.json
npm run export -- --out backups/
```

Le script lit la config Supabase dans `.env`, se connecte avec votre compte (`MNEMON_EMAIL` / `MNEMON_PASSWORD`, sinon demandés au clavier, jamais en argument) et écrit tous vos items en JSON. Il n'écrase jamais un fichier existant.

Pour restaurer, ou pour **migrer les données de l'ancienne version Fly.io** (fichier SQLite `.db`) :

```sh
npm run import -- mnemon-2026-11-22.json --email vous@exemple.fr --out import.sql
npm run import -- ancien-mnemon.db       --email vous@exemple.fr --out import.sql
```

Puis coller `import.sql` dans le **SQL Editor** de Supabase et l'exécuter. Le script ne contacte rien : il génère seulement le SQL (dans une transaction, en gardant dates et états « fait », rattaché au compte de cet email).

Supabase fait aussi ses propres sauvegardes quotidiennes de la base (selon l'offre).
