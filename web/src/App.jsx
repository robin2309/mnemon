import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { supabase } from './supabase.js';
import { sortItems } from './utils.js';
import AddForm from './components/AddForm.jsx';
import Filters from './components/Filters.jsx';
import Section from './components/Section.jsx';
import Toast from './components/Toast.jsx';

export default function App() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);
  const toastId = useRef(0);

  const notify = useCallback((message) => {
    toastId.current += 1;
    setToast({ id: toastId.current, message });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [cats, its] = await Promise.all([api.categories(), api.items()]);
      setCategories(cats);
      setItems(sortItems(its));
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      notify(err.message);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  /** Replace (or insert) an item, keeping the canonical sort order. */
  const upsert = useCallback(
    (item) =>
      setItems((prev) =>
        sortItems(prev.some((i) => i.id === item.id) ? prev.map((i) => (i.id === item.id ? item : i)) : [...prev, item]),
      ),
    [],
  );

  // --- Actions ----------------------------------------------------------------

  const addItem = useCallback(
    async (draft) => {
      const created = await api.create(draft); // errors bubble up to the form
      upsert(created);
    },
    [upsert],
  );

  /** Creates a category and returns it; errors bubble up to the form. */
  const addCategory = useCallback(async (label) => {
    const created = await api.createCategory(label);
    setCategories((prev) => [...prev, created]);
    return created;
  }, []);

  const editItem = useCallback(
    async (id, patch) => {
      const updated = await api.save(id, patch); // errors bubble up to the row
      upsert(updated);
    },
    [upsert],
  );

  const toggleDone = useCallback(
    async (item) => {
      const optimistic = { ...item, done: !item.done };
      upsert(optimistic);
      try {
        upsert(await api.setDone(item.id, optimistic.done));
      } catch (err) {
        upsert(item); // rollback
        notify(`Impossible de mettre à jour « ${item.title} » : ${err.message}`);
      }
    },
    [upsert, notify],
  );

  const deleteItem = useCallback(
    async (item) => {
      if (!window.confirm(`Supprimer « ${item.title} » ?`)) return;
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      try {
        await api.remove(item.id);
      } catch (err) {
        upsert(item); // rollback
        notify(`Impossible de supprimer « ${item.title} » : ${err.message}`);
      }
    },
    [upsert, notify],
  );

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) notify(`Déconnexion impossible : ${error.message}`);
  }, [notify]);

  // --- Derived view -----------------------------------------------------------

  const query = search.trim().toLocaleLowerCase('fr');
  const sections = useMemo(() => {
    const matches = (i) =>
      !query || i.title.toLocaleLowerCase('fr').includes(query) || (i.url ?? '').toLocaleLowerCase('fr').includes(query);
    return categories
      .filter((c) => filter === 'all' || c.key === filter)
      .map((c) => ({
        category: c,
        // An item with several categories is listed in each of their sections.
        items: items.filter((i) => i.categories.includes(c.key) && matches(i)),
      }));
  }, [categories, items, filter, query]);

  return (
    <>
      <header className="app-header">
        <h1>Mnémon</h1>
        <button type="button" className="btn btn-ghost" onClick={signOut}>
          Se déconnecter
        </button>
      </header>

      <main className="container">
        {status === 'error' && (
          <div className="load-error" role="alert">
            <p>Impossible de charger les idées.</p>
            <button type="button" className="btn" onClick={load}>
              Réessayer
            </button>
          </div>
        )}

        {status === 'ready' && (
          <>
            <AddForm categories={categories} onAdd={addItem} onAddCategory={addCategory} />
            <Filters
              categories={categories}
              filter={filter}
              onFilterChange={setFilter}
              search={search}
              onSearchChange={setSearch}
            />
            {sections.map(({ category, items: sectionItems }) => (
              <Section
                key={category.key}
                category={category}
                categories={categories}
                items={sectionItems}
                searching={query !== ''}
                onToggle={toggleDone}
                onEdit={editItem}
                onAddCategory={addCategory}
                onDelete={deleteItem}
              />
            ))}
          </>
        )}

        {status === 'loading' && <p className="muted center">Chargement…</p>}
      </main>

      <Toast toast={toast} onDismiss={dismissToast} />
    </>
  );
}
