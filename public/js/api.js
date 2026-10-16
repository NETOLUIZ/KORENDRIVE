// API client para comunicação com o backend korenDriver
const API_BASE = (typeof window !== 'undefined' && window.location.port && window.location.port !== '3000' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
  ? `http://${window.location.hostname}:3000/api`
  : '/api';
const TOKEN_KEY = 'koren_driver_token';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function authFetch(path, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`,
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { success: false, error: 'Resposta inválida do servidor.' };
    }
    if (!res.ok && !data.error) {
      data.error = `Erro do servidor (${res.status})`;
    }
    return data;
  } catch (err) {
    console.error(`Erro ao comunicar com ${path}:`, err);
    return { success: false, error: 'Não foi possível conectar ao servidor. Verifique se o backend está em execução.' };
  }
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
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password })
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return { success: false, error: 'Resposta inválida do servidor.' };
      }
      if (res.ok && data.success) setToken(data.token);
      return data;
    } catch (err) {
      console.error('Erro ao conectar ao login:', err);
      return { success: false, error: 'Não foi possível conectar ao servidor. Verifique se o backend está rodando.' };
    }
  },

  async registerDriver(data) {
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const text = await res.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        return { success: false, error: 'Resposta inesperada do servidor.' };
      }
      if (res.ok && result.success) setToken(result.token);
      return result;
    } catch (err) {
      console.error('Erro ao conectar ao registro:', err);
      return { success: false, error: 'Não foi possível conectar ao servidor. Verifique se o backend está rodando.' };
    }
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

  async getPendingRides() {
    return authFetch('/rides/pending');
  },

  async acceptRide(id) {
    return authFetch(`/rides/${id}/accept`, { method: 'PATCH' });
  },

  async startRide(id) {
    return authFetch(`/rides/${id}/start`, { method: 'PATCH' });
  },

  async updateRideLocation(id, latitude, longitude) {
    return authFetch(`/rides/${id}/location`, { method: 'PATCH', body: JSON.stringify({ latitude, longitude }) });
  },

  async completeRide(id) {
    return authFetch(`/rides/${id}/complete`, { method: 'PATCH' });
  },

  async cancelRide(id) {
    return authFetch(`/rides/${id}/cancel`, { method: 'PATCH' });
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
