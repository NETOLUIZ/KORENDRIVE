// API client para comunicação com o backend korenDriver
const API_BASE = '/api';
const TOKEN_KEY = 'koren_driver_token';

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
  return res.json();
}

export const api = {
  setToken,
  getToken,

  async getProfile() {
    return authFetch('/driver/profile');
  },

  async toggleStatus() {
    return authFetch('/driver/toggle-status', { method: 'POST' });
  },

  async login(identifier, password) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    });
    const data = await res.json();
    if (res.ok && data.success) setToken(data.token);
    return data;
  },

  async registerDriver(data) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (res.ok && result.success) setToken(result.token);
    return result;
  },

  async logout() {
    try { await authFetch('/auth/logout', { method: 'POST' }); } catch (e) {}
    setToken(null);
  },

  async getVehicles() {
    return authFetch('/vehicles');
  },

  async registerVehicle(data) {
    return authFetch('/vehicles', { method: 'POST', body: JSON.stringify(data) });
  },

  async activateVehicle(vehicleId) {
    return authFetch(`/vehicles/${vehicleId}/activate`, { method: 'PATCH' });
  },

  async getExpenses() {
    return authFetch('/expenses');
  },

  async addExpense(data) {
    return authFetch('/expenses', { method: 'POST', body: JSON.stringify(data) });
  },

  async getRidesAndRates() {
    return authFetch('/rides');
  },

  async getWeekSummary() {
    return authFetch('/rides/week-summary');
  },

  async addRide(data) {
    return authFetch('/rides', { method: 'POST', body: JSON.stringify(data) });
  },

  async updateRates(rates) {
    return authFetch('/rides/rates', { method: 'PUT', body: JSON.stringify(rates) });
  },

  async simulateRide(km, min) {
    return authFetch('/rides/simulate', { method: 'POST', body: JSON.stringify({ distance_km: km, duration_min: min }) });
  },

  // Direito de acesso (LGPD): baixa um arquivo de verdade, não só o JSON em memória
  async exportData() {
    const res = await fetch(`${API_BASE}/driver/export-data`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    });
    if (!res.ok) return { success: false, error: 'Erro ao exportar seus dados.' };

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'meus-dados-koren.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { success: true };
  },

  // Direito de exclusão / esquecimento (LGPD)
  async deleteAccount() {
    return authFetch('/driver/account', { method: 'DELETE' });
  }
};
