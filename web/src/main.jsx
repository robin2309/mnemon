import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Login from './components/Login.jsx';
import { configError, supabase } from './supabase.js';
import './style.css';

/** Shows the login screen until there is a Supabase session, then the app. */
function Root() {
  const [session, setSession] = useState(undefined); // undefined = still checking

  useEffect(() => {
    if (!supabase) return undefined;
    // Fires once with the stored session (INITIAL_SESSION), then on every sign in / out.
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (configError) {
    return (
      <p className="load-error" role="alert">
        {configError}
      </p>
    );
  }
  if (session === undefined) return <p className="muted center">Chargement…</p>;
  if (!session) return <Login />;
  return <App key={session.user.id} />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
