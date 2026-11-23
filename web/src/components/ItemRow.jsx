import { useEffect, useId, useRef, useState } from 'react';
import { TITLE_MAX, domainOf, formatDate, isHttpUrl, validateDraft } from '../utils.js';
import CategoryPicker, { pickerState, resolvePicker, validatePicker } from './CategoryPicker.jsx';

export default function ItemRow({ item, section, categories, onToggle, onEdit, onAddCategory, onDelete }) {
  const [editing, setEditing] = useState(false);
  // The item's other categories (it is also listed in their sections).
  const others = categories.filter((c) => c.key !== section && item.categories.includes(c.key));
  return (
    <li className={`item${item.done ? ' is-done' : ''}`}>
      {editing ? (
        <EditForm
          item={item}
          categories={categories}
          onSave={onEdit}
          onAddCategory={onAddCategory}
          onClose={() => setEditing(false)}
        />
      ) : (
        <View item={item} others={others} onToggle={onToggle} onEditStart={() => setEditing(true)} onDelete={onDelete} />
      )}
    </li>
  );
}

function View({ item, others, onToggle, onEditStart, onDelete }) {
  const checkboxId = useId();
  // Defence in depth: the server already rejects non-http(s) URLs.
  const safeUrl = item.url && isHttpUrl(item.url) ? item.url : null;
  const created = formatDate(item.createdAt);

  return (
    <div className="item-view">
      <label className="check" htmlFor={checkboxId}>
        <input
          id={checkboxId}
          type="checkbox"
          checked={item.done}
          onChange={() => onToggle(item)}
          aria-label={item.done ? `Marquer « ${item.title} » comme non fait` : `Marquer « ${item.title} » comme fait`}
        />
      </label>
      <div className="item-main">
        {safeUrl ? (
          <a className="item-title" href={safeUrl} target="_blank" rel="noopener noreferrer">
            {item.title}
          </a>
        ) : (
          <span className="item-title">{item.title}</span>
        )}
        {safeUrl && <span className="domain">{domainOf(safeUrl)}</span>}
        {created.short && (
          <time className="date" dateTime={item.createdAt} title={`Ajouté le ${created.full}`}>
            {created.short}
          </time>
        )}
        {others.length > 0 && (
          <span className="tags" aria-label={`Aussi dans : ${others.map((c) => c.label).join(', ')}`}>
            {others.map((c) => (
              <span key={c.key} className="tag">
                {c.label}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="item-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={onEditStart}>
          Modifier
        </button>
        <button type="button" className="btn btn-ghost btn-small btn-danger" onClick={() => onDelete(item)}>
          Supprimer
        </button>
      </div>
    </div>
  );
}

function EditForm({ item, categories, onSave, onAddCategory, onClose }) {
  const ids = useId();
  const titleRef = useRef(null);
  const [title, setTitle] = useState(item.title);
  const [url, setUrl] = useState(item.url ?? '');
  const [picker, setPicker] = useState(() => pickerState(item.categories));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    const draft = { title: title.trim(), url: url.trim() };
    const msg = validateDraft(draft) ?? validatePicker(picker);
    if (msg) {
      setError(msg);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { keys, state } = await resolvePicker(picker, categories, onAddCategory);
      setPicker(state);
      await onSave(item.id, { ...draft, categories: keys });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <form className="edit-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown} noValidate aria-label="Modifier l’idée">
      <div className="field">
        <label htmlFor={`${ids}-title`}>Titre</label>
        <input
          ref={titleRef}
          id={`${ids}-title`}
          type="text"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-url`}>Lien</label>
        <input
          id={`${ids}-url`}
          type="url"
          inputMode="url"
          value={url}
          placeholder="https://…"
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <CategoryPicker categories={categories} value={picker} onChange={setPicker} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="edit-actions">
        <button type="button" className="btn" onClick={onClose}>
          Annuler
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Enregistrer
        </button>
      </div>
    </form>
  );
}
