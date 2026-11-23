import { useId, useRef, useState } from 'react';
import { TITLE_MAX, isHttpUrl, loadLastCategories, saveLastCategories, validateDraft } from '../utils.js';
import CategoryPicker, { pickerState, resolvePicker, validatePicker } from './CategoryPicker.jsx';

/** Categories picked for the previous item if they still exist, else the first one. */
function initialPicker(categories) {
  const last = loadLastCategories().filter((k) => categories.some((c) => c.key === k));
  if (last.length > 0) return pickerState(last);
  if (categories.length > 0) return pickerState([categories[0].key]);
  return { ...pickerState([]), adding: true };
}

export default function AddForm({ categories, onAdd, onAddCategory }) {
  const ids = useId();
  const titleRef = useRef(null);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [picker, setPicker] = useState(() => initialPicker(categories));
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
      await onAdd({ ...draft, categories: keys });
      setTitle('');
      setUrl('');
      saveLastCategories(keys);
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
      <CategoryPicker categories={categories} value={picker} onChange={setPicker} />
      <button type="submit" className="btn btn-primary" disabled={busy}>
        Ajouter
      </button>
      {error && (
        <p id={`${ids}-err`} className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
