import { useId } from 'react';
import { CATEGORY_LABEL_MAX, findCategoryByLabel, validateCategoryLabel } from '../utils.js';

/**
 * Multi-select of categories (toggle chips), plus a "+ Nouvelle" chip that shows a name
 * field. The parent owns the state: { selected: [key], adding: bool, newLabel: string }.
 */
export default function CategoryPicker({ categories, value, onChange, autoFocusNew = true }) {
  const ids = useId();
  const { selected, adding, newLabel } = value;

  function toggle(key) {
    onChange({ ...value, selected: selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key] });
  }

  return (
    <fieldset className="field category-picker">
      <legend>Catégories</legend>
      <div className="chips">
        {categories.map((c) => (
          <button key={c.key} type="button" className="chip" aria-pressed={selected.includes(c.key)} onClick={() => toggle(c.key)}>
            {c.label}
          </button>
        ))}
        <button
          type="button"
          className="chip chip-new"
          aria-pressed={adding}
          aria-controls={adding ? `${ids}-new` : undefined}
          onClick={() => onChange({ ...value, adding: !adding })}
        >
          + Nouvelle
        </button>
      </div>
      {adding && (
        <input
          id={`${ids}-new`}
          type="text"
          value={newLabel}
          maxLength={CATEGORY_LABEL_MAX}
          placeholder="Nom de la nouvelle catégorie"
          aria-label="Nom de la nouvelle catégorie"
          autoComplete="off"
          autoFocus={autoFocusNew && categories.length > 0}
          enterKeyHint="done"
          onChange={(e) => onChange({ ...value, newLabel: e.target.value })}
        />
      )}
    </fieldset>
  );
}

/** Picker state for an item that has these categories. */
export function pickerState(selected) {
  return { selected, adding: false, newLabel: '' };
}

/** Error message for the picker, or null. */
export function validatePicker({ selected, adding, newLabel }) {
  if (adding) return validateCategoryLabel(newLabel);
  return selected.length === 0 ? 'Choisissez au moins une catégorie.' : null;
}

/**
 * Category keys to save. Creates the new category if needed, reusing one that already
 * has this name (any case). Returns { keys, state } where state is the picker state to
 * keep, so a retry after a later failure does not create the category again.
 */
export async function resolvePicker({ selected, adding, newLabel }, categories, onAddCategory) {
  if (!adding) return { keys: selected, state: { selected, adding, newLabel } };
  const target = findCategoryByLabel(categories, newLabel) ?? (await onAddCategory(newLabel));
  const keys = selected.includes(target.key) ? selected : [...selected, target.key];
  return { keys, state: pickerState(keys) };
}
