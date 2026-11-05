import { useEffect } from 'react';

export default function Toast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  return (
    <div className="toast-region" aria-live="assertive" aria-atomic="true">
      {toast && (
        <div className="toast" role="alert" key={toast.id}>
          <span>{toast.message}</span>
          <button type="button" className="btn btn-ghost btn-small" onClick={onDismiss} aria-label="Fermer">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
