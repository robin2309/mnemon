import { useId, useState } from 'react';
import ItemRow from './ItemRow.jsx';

export default function Section({ category, categories, items, searching, onToggle, onEdit, onAddCategory, onDelete }) {
  const headingId = useId();
  const [showDone, setShowDone] = useState(false);
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  const row = (item) => (
    <ItemRow
      key={item.id}
      item={item}
      section={category.key}
      categories={categories}
      onToggle={onToggle}
      onEdit={onEdit}
      onAddCategory={onAddCategory}
      onDelete={onDelete}
    />
  );

  return (
    <section className="section" aria-labelledby={headingId}>
      <h2 id={headingId} className="section-title">
        {category.label}
        <span className="count" aria-label={`${open.length} à traiter`}>
          {open.length}
        </span>
      </h2>

      {items.length === 0 ? (
        <p className="empty">{searching ? 'Aucun résultat' : 'Rien pour l’instant'}</p>
      ) : (
        <>
          {open.length > 0 && <ul className="items">{open.map(row)}</ul>}
          {done.length > 0 && (
            <>
              <button
                type="button"
                className="btn btn-link toggle-done"
                aria-expanded={showDone}
                onClick={() => setShowDone((v) => !v)}
              >
                {showDone
                  ? 'Masquer les terminés'
                  : `Afficher les ${done.length} terminé${done.length > 1 ? 's' : ''}`}
              </button>
              {showDone && <ul className="items items-done">{done.map(row)}</ul>}
            </>
          )}
        </>
      )}
    </section>
  );
}
