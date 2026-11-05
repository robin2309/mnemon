export default function Filters({ categories, filter, onFilterChange, search, onSearchChange }) {
  const chips = [{ key: 'all', label: 'Tout' }, ...categories];
  return (
    <div className="filters">
      <div className="chips" role="group" aria-label="Filtrer par catégorie">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            className="chip"
            aria-pressed={filter === c.key}
            onClick={() => onFilterChange(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <input
        type="search"
        className="search"
        placeholder="Rechercher…"
        aria-label="Rechercher dans les titres et liens"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
    </div>
  );
}
