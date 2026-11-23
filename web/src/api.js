import { supabase } from './supabase.js';
import { toCategory, toItem, toItemParams, toRow } from './utils.js';

const ITEM_COLUMNS = 'id, title, url, done, created_at, updated_at, item_categories(category_id)';
const PAGE_SIZE = 1000; // Supabase's default max rows per request

/** Supabase / PostgREST error → readable French message. */
function toError(error) {
  const code = error?.code ?? '';
  if (code === '23514' && /category/.test(error?.message ?? '')) return new Error('Choisissez au moins une catégorie.');
  if (code === '23514' || code === '22001') return new Error('Données refusées : vérifiez les champs saisis.');
  if (code === 'P0002') return new Error('Item introuvable.');
  if (code === '23505') return new Error('Cette catégorie existe déjà.');
  if (code === '23503') return new Error('Catégorie introuvable, rechargez la page.');
  if (code === '42501' || code === 'PGRST301' || code === 'PGRST303' || error?.status === 401) {
    // Session missing or expired: sign out locally, the app falls back to the login screen.
    supabase.auth.signOut({ scope: 'local' });
    return new Error('Session expirée, reconnectez-vous.');
  }
  if (/fetch|network|load failed/i.test(error?.message ?? '')) return new Error('Connexion au serveur impossible.');
  return new Error(error?.message || 'Erreur serveur.');
}

async function run(query) {
  let result;
  try {
    result = await query;
  } catch (err) {
    throw toError(err);
  }
  if (result.error) throw toError(result.error);
  return result.data;
}

/** All rows of a table, page by page, ordered by id. */
async function selectAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await run(supabase.from(table).select(columns).order('id').range(from, from + PAGE_SIZE - 1));
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export const api = {
  /** Categories in display order (creation order). */
  async categories() {
    return (await selectAll('categories', 'id, label')).map(toCategory);
  },

  async createCategory(label) {
    return toCategory(await run(supabase.from('categories').insert({ label: label.trim() }).select('id, label').single()));
  },

  async items() {
    return (await selectAll('items', ITEM_COLUMNS)).map(toItem);
  },

  async item(id) {
    const data = await run(supabase.from('items').select(ITEM_COLUMNS).eq('id', id));
    if (data.length === 0) throw new Error('Item introuvable.');
    return toItem(data[0]);
  },

  /** Creates an item with its categories in one transaction. draft: { title, url, categories }. */
  async create(draft) {
    return this.item(await run(supabase.rpc('create_item', toItemParams(draft))));
  },

  /** Replaces title, link and categories in one transaction. */
  async save(id, draft) {
    return this.item(await run(supabase.rpc('update_item', { p_id: id, ...toItemParams(draft) })));
  },

  async setDone(id, done) {
    const data = await run(supabase.from('items').update(toRow({ done })).eq('id', id).select(ITEM_COLUMNS));
    if (data.length === 0) throw new Error('Item introuvable.');
    return toItem(data[0]);
  },

  async remove(id) {
    const data = await run(supabase.from('items').delete().eq('id', id).select('id'));
    if (data.length === 0) throw new Error('Item introuvable.');
  },
};
