import { useId, useState } from 'react';
import { supabase } from '../supabase.js';

export default function Login() {
  const ids = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) {
        setError(
          authError.status === 400 || authError.code === 'invalid_credentials'
            ? 'Email ou mot de passe incorrect.'
            : authError.status === 429
              ? 'Trop de tentatives, réessayez dans quelques minutes.'
              : authError.message,
        );
      }
      // On success, onAuthStateChange in main.jsx swaps this screen for the app.
    } catch {
      setError('Connexion au serveur impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login card">
      <h1>Mnémon</h1>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <form onSubmit={submit}>
        <label htmlFor={`${ids}-email`}>Email</label>
        <input
          id={`${ids}-email`}
          type="email"
          autoComplete="username"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor={`${ids}-password`}>Mot de passe</label>
        <input
          id={`${ids}-password`}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </main>
  );
}
