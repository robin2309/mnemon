import { useId, useRef, useState } from 'react';
import { TITLE_MAX, isHttpUrl, loadLastCategory, saveLastCategory, validateDraft } from '../utils.js';

export default function AddForm({ categories, onAdd }) {
  const ids = useId();
  const titleRef = useRef(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState(() => {
    const last = loadLastCategory();
    return categories.some((c) => c.key === last) ? last : categories[0].key;
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Quick add: pasting a lone URL into the title moves it to the link field.
  function handleTitlePaste(e) {
    const text = e.clipboardData.getData('text').trim();
    if (!isHttpUrl(text) || /\s/.test(text)) return;
    const input = e.currentTarget;
    const replacesAll = input.selectionStart === 0 && input.selectionEnd === input.value.length;
    if (title.trim() !== '' && !replacesAll) return;
    e.preventDefault();
    setUrl(text);
    setTitle('');
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    const draft = { title: title.trim(), url: url.trim(), category };
    const msg = validateDraft(draft);
    if (msg) {
      setError(msg);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAdd(draft);
      setTitle('');
      setUrl('');
      saveLastCategory(category);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      titleRef.current?.focus();
    }
  }

  return (
    <form className="add-form card" onSubmit={handleSubmit} noValidate aria-label="Ajouter une idée">
      <div className="field">
        <label htmlFor={`${ids}-title`}>Titre</label>
        <input
          ref={titleRef}
          id={`${ids}-title`}
          type="text"
          value={title}
          maxLength={TITLE_MAX}
          placeholder="Une idée…"
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => setTitle(e.target.value)}
          onPaste={handleTitlePaste}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${ids}-err` : undefined}
        />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-url`}>Lien (optionnel)</label>
        <input
          id={`${ids}-url`}
          type="url"
          inputMode="url"
          value={url}
          placeholder="https://…"
          autoComplete="off"
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="add-row">
        <div className="field grow">
          <label htmlFor={`${ids}-cat`}>Catégorie</label>
          <select id={`${ids}-cat`} value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Ajouter
        </button>
      </div>
      {error && (
        <p id={`${ids}-err`} className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
