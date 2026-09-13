// API client do painel Admin
const API_BASE = '/api/admin';
const TOKEN_KEY = 'koren_admin_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function authFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`,
      ...(options.headers || {})
    }
  });
  return res;
}

export const adminApi = {
  setToken,
  getToken,

  async login(email, password) {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok && data.success) setToken(data.token);
    return { ok: res.ok, ...data };
  },

  async me() {
    const res = await authFetch('/me');
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async getDrivers() {
    const res = await authFetch('/drivers');
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async updateDriverPermissions(driverId, permissions) {
    const res = await authFetch(`/drivers/${driverId}/permissions`, {
      method: 'PATCH',
      body: JSON.stringify(permissions)
    });
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async logout() {
    try { await authFetch('/logout', { method: 'POST' }); } catch (e) {}
    setToken(null);
  }
};
