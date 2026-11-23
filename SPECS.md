# Mnémon — Spécifications

Application web personnelle pour noter des idées de choses à **faire**, **investiguer**, **lire** et **regarder**, accessible depuis plusieurs appareils (ordinateur + téléphone).

---

## 1. Spécifications fonctionnelles

### 1.1 Utilisateur
- Un seul utilisateur (moi). Pas de multi-comptes, pas de partage.
- L'app est exposée sur internet : elle doit être protégée par une connexion (email + mot de passe).

### 1.2 Objet métier : Item
| Champ | Obligatoire | Description |
|---|---|---|
| Titre | Oui | Texte libre, 1 à 200 caractères |
| Lien | Non | URL `http://` ou `https://` |
| Catégorie | Oui | Une parmi : `À faire`, `À investiguer`, `À lire`, `À regarder` |
| Fait | — | Booléen, `false` à la création |
| Date de création | — | Automatique |

### 1.3 Fonctionnalités

**F1 — Ajouter un item**
- Formulaire en haut de page : titre, lien (optionnel), catégorie (sélecteur, mémorise la dernière catégorie utilisée).
- Validation : titre non vide ; si un lien est saisi, il doit être une URL http(s) valide.
- Touche Entrée = valider. Après ajout, le formulaire se vide et le focus revient sur le titre.
- Ajout rapide : si l'utilisateur colle une URL seule dans le champ titre, elle est déplacée dans le champ lien (le titre reste à saisir).

**F2 — Consulter les items par catégorie**
- La page affiche une section par catégorie, dans l'ordre : À faire, À investiguer, À lire, À regarder.
- Chaque section affiche son nombre d'items non faits.
- Dans une section : items non faits d'abord (plus récent en haut), puis items faits (grisés, barrés), repliés par défaut derrière « Afficher les X terminés ».
- Une section vide affiche un message discret (« Rien pour l'instant »).
- Si un item a un lien : le titre est cliquable et ouvre le lien dans un nouvel onglet ; le domaine (ex. `youtube.com`) est affiché à côté en petit.

**F3 — Marquer comme fait / non fait**
- Case à cocher sur chaque item. Changement immédiat (UI optimiste).

**F4 — Modifier un item**
- Bouton « Modifier » : édition en place du titre, du lien et de la catégorie. Enregistrer / Annuler (Échap).

**F5 — Supprimer un item**
- Bouton « Supprimer » avec confirmation.

**F6 — Filtrer**
- Onglets/chips en haut de liste : « Tout » + une par catégorie, pour n'afficher qu'une section (utile sur mobile).
- Champ de recherche texte (filtre côté client sur titre et lien).

**F7 — Authentification**
- Accès protégé par un compte unique (email + mot de passe) géré par Supabase Auth ; pas d'inscription possible.
- Une fois connecté sur un appareil, on reste connecté jusqu'à la déconnexion.
- Bouton « Se déconnecter ».

### 1.4 Ergonomie
- Mobile-first : utilisable confortablement sur un écran de 375 px de large, cibles tactiles ≥ 44 px.
- Thème clair/sombre automatique (`prefers-color-scheme`).
- Interface en français.
- Installable sur l'écran d'accueil du téléphone (manifest PWA minimal : nom, icône, `display: standalone`). Pas de mode hors-ligne requis.

### 1.5 Hors périmètre (v1)
- Multi-utilisateurs, partage.
- Catégories personnalisées, tags, priorités, dates d'échéance.
- Mode hors-ligne / synchronisation.
- Récupération automatique du titre d'une page à partir de son URL.

---

## 2. Spécifications techniques

### 2.1 Stack
| Couche | Choix | Raison |
|---|---|---|
| Front | React 19, construit par Vite dans `dist/` (JavaScript, pas de TypeScript) | Une seule app statique |
| Données | Supabase Postgres, appelé depuis le navigateur avec `@supabase/supabase-js` | Pas de serveur applicatif à maintenir |
| Authentification | Supabase Auth, email + mot de passe, inscriptions fermées | Compte unique créé à la main |
| Hébergement | Netlify (site statique, HTTPS fourni) | Accès multi-appareils |

### 2.2 Arborescence
```
mnemon/
├── web/                     # source React (index.html, src/, public/)
├── supabase/migrations/     # schéma, droits, row-level security
├── scripts/                 # export (sauvegarde JSON) et import (SQL)
├── test/
├── netlify.toml             # build + en-têtes de sécurité
├── .env.example
└── package.json
```

### 2.3 Configuration (variables d'environnement)
| Variable | Rôle |
|---|---|
| `VITE_SUPABASE_URL` | URL du projet Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clé publishable (ex-`anon`). Publique par nature, inutile sans session. Jamais la clé secrète / `service_role` |

Les deux sont lues au build (Netlify ou `.env` en local) et se retrouvent dans le JS public.

### 2.4 Modèle de données
```sql
create table public.items (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  title       text        not null check (char_length(title) between 1 and 200 and title = btrim(title)),
  url         text        check (url is null or (char_length(url) <= 2048 and url ~* '^https?://\S+$')),
  category    text        not null check (category in ('todo', 'investigate', 'read', 'watch')),
  done        boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()   -- mis à jour par trigger
);
```
- Libellés affichés : `todo` → À faire, `investigate` → À investiguer, `read` → À lire, `watch` → À regarder. La liste est définie à un seul endroit côté front (`CATEGORIES` dans `web/src/utils.js`) et doit rester alignée avec la contrainte SQL.
- Ordre d'affichage : catégorie, puis non faits d'abord, puis plus récents d'abord (tri côté client).

### 2.5 Accès aux données
Le front lit et écrit `public.items` directement via supabase-js. La sécurité est portée par la base (fichier `supabase/migrations/…_create_items.sql`) :
- rôle `anon` (non connecté) : aucun droit sur la table ;
- rôle `authenticated` : `select` / `delete`, et `insert` / `update` limités aux colonnes `title`, `url`, `category`, `done` ;
- row-level security : chaque opération est limitée aux lignes où `user_id = auth.uid()` ;
- validation : les contraintes `check` ci-dessus ; le front applique les mêmes règles avant envoi pour afficher des messages lisibles.

### 2.6 Authentification
- Écran de connexion React (email + mot de passe) → `supabase.auth.signInWithPassword`.
- Session conservée par supabase-js dans le navigateur et rafraîchie automatiquement : on reste connecté jusqu'à « Se déconnecter ».
- Inscriptions désactivées dans Supabase (Authentication → Sign In / Providers) ; le compte est créé à la main dans le tableau de bord.
- Le front refuse de démarrer avec une clé secrète / `service_role`.

### 2.7 Front
- Mises à jour optimistes (cocher, supprimer) avec retour arrière + message d'erreur.
- Une session expirée ou refusée ramène à l'écran de connexion.
- React échappe le texte ; les liens ne sont rendus que s'ils sont en `http(s)`, avec `target="_blank" rel="noopener noreferrer"`.
- CSS : variables de couleurs sur `:root`, redéfinies dans `@media (prefers-color-scheme: dark)`. Pas de framework CSS.

### 2.8 Déploiement (Netlify)
- `netlify.toml` : `npm run build`, dossier publié `dist`, Node 22.
- En-têtes : CSP (`connect-src 'self' https://*.supabase.co`, pas de script inline, `frame-ancestors 'none'`), HSTS, `nosniff`, `no-referrer`, `X-Robots-Tag: noindex`.
- Variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` dans les réglages du site.
- Sauvegarde : `npm run export` (JSON) ; restauration / migration depuis l'ancienne base SQLite : `npm run import` génère le SQL à exécuter dans Supabase.

### 2.9 Critères d'acceptation
1. Sans connexion, l'app affiche l'écran de connexion, et une requête à la table `items` avec la seule clé publishable ne renvoie rien (ni lecture ni écriture).
2. Après connexion, ajouter « Dune » sans lien dans « À lire » : l'item apparaît en tête de la section, compteur à jour.
3. Ajouter un item avec le lien `https://www.youtube.com/watch?v=x` : titre cliquable, `youtube.com` affiché.
4. Un lien `javascript:alert(1)` ou `ftp://x` est refusé avec message affiché (et rejeté par la base s'il est envoyé directement).
5. Cocher un item le passe dans les « terminés » repliés ; le décocher le remet en haut.
6. Modifier la catégorie d'un item le déplace dans la bonne section.
7. Supprimer demande confirmation puis retire l'item.
8. Après un redéploiement Netlify, les items sont toujours là.
9. Un item ajouté depuis le téléphone apparaît sur l'ordinateur après rechargement.
10. Affichage correct et sans scroll horizontal à 375 px de large, en clair et en sombre.
