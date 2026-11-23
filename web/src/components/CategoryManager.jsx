import { useState } from 'react';

/**
 * Content of the "Gérer les catégories" modal: every category with the number of ideas
 * filed under it. Only an unused category can be deleted (the database enforces it too).
 */
export default function CategoryManager({ categories, items, onDelete }) {
  const [error, setError] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const usage = new Map(categories.map((c) => [c.key, 0]));
  for (const item of items) {
    for (const key of item.categories) usage.set(key, (usage.get(key) ?? 0) + 1);
  }

  async function handleDelete(category) {
    if (!window.confirm(`Supprimer la catégorie « ${category.label} » ?`)) return;
    setBusyKey(category.key);
    setError(null);
    try {
      await onDelete(category);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="category-manager">
      <p className="muted category-manager-hint">
        Une catégorie ne peut être supprimée que si aucune idée n’y est rangée.
      </p>
      {categories.length === 0 ? (
        <p className="empty">Aucune catégorie.</p>
      ) : (
        <ul className="category-list">
          {categories.map((c) => {
            const count = usage.get(c.key) ?? 0;
            const used = count > 0;
            return (
              <li key={c.key} className="category-row">
                <div className="category-row-main">
                  <span className="category-row-label">{c.label}</span>
                  <span className="category-row-count">
                    {used ? `${count} idée${count > 1 ? 's' : ''}` : 'Aucune idée'}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-small btn-danger"
                  disabled={used || busyKey !== null}
                  title={used ? 'Utilisée : retirez-la d’abord de ses idées' : undefined}
                  aria-label={`Supprimer la catégorie « ${c.label} »`}
                  onClick={() => handleDelete(c)}
                >
                  Supprimer
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
