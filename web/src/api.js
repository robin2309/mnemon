import { supabase } from './supabase.js';
import { CATEGORY_ORDER, sortItems, toItem, toRow } from './utils.js';

const COLUMNS = 'id, title, url, category, done, created_at, updated_at';
const PAGE_SIZE = 1000; // Supabase's default max rows per request

/** Supabase / PostgREST error → readable French message. */
function toError(error) {
  const code = error?.code ?? '';
  if (code === '23514' || code === '22001') return new Error('Données refusées : vérifiez le titre et le lien.');
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

export const api = {
  async items() {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const page = await run(
        supabase.from('items').select(COLUMNS).order('id').range(from, from + PAGE_SIZE - 1),
      );
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    return sortItems(rows.map(toItem), CATEGORY_ORDER);
  },

  async create(draft) {
    const row = toRow({ title: draft.title, url: draft.url, category: draft.category });
    return toItem(await run(supabase.from('items').insert(row).select(COLUMNS).single()));
  },

  async update(id, patch) {
    const data = await run(supabase.from('items').update(toRow(patch)).eq('id', id).select(COLUMNS));
    if (data.length === 0) throw new Error('Item introuvable.');
    return toItem(data[0]);
  },

  async remove(id) {
    const data = await run(supabase.from('items').delete().eq('id', id).select('id'));
    if (data.length === 0) throw new Error('Item introuvable.');
  },
};
