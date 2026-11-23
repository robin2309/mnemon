import { createClient } from '@supabase/supabase-js';
import { isSecretKey } from './utils.js';

// Both values end up in the public JavaScript bundle. That is expected for the
// publishable (anon) key: it grants nothing without a signed-in session, because the
// database only lets the owner of a row read or change it (see supabase/migrations).
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function checkConfig() {
  if (!url || !key) {
    return 'Configuration manquante : VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY.';
  }
  if (isSecretKey(key)) {
    // A secret / service_role key bypasses row-level security: refuse to use it.
    return 'Clé Supabase secrète détectée : utilisez la clé publishable (anon), jamais la clé secrète.';
  }
  return null;
}

export const configError = checkConfig();

export const supabase = configError
  ? null
  : createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
