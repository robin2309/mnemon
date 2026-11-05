/** Thin fetch wrapper: JSON in/out, 401 → login page, readable errors. */
async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Connexion au serveur impossible.');
  }

  if (res.status === 401) {
    window.location.assign('/login');
    // Never resolves: the page is navigating away.
    return new Promise(() => {});
  }
  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    throw new Error((data && typeof data.error === 'string' && data.error) || `Erreur ${res.status}`);
  }
  return data;
}

export const api = {
  categories: () => request('GET', '/api/categories'),
  items: () => request('GET', '/api/items'),
  create: (item) => request('POST', '/api/items', item),
  update: (id, patch) => request('PATCH', `/api/items/${encodeURIComponent(id)}`, patch),
  remove: (id) => request('DELETE', `/api/items/${encodeURIComponent(id)}`),
};
