// API client do painel Super Admin
const API_BASE = '/api/superadmin';
const TOKEN_KEY = 'koren_superadmin_token';

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

export const superadminApi = {
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

  async listAdmins() {
    const res = await authFetch('/admins');
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async getBillingSummary() {
    const res = await authFetch('/billing-summary');
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async createAdmin(payload) {
    const res = await authFetch('/admins', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async blockAdmin(id) {
    const res = await authFetch(`/admins/${id}/block`, { method: 'PATCH' });
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async unblockAdmin(id) {
    const res = await authFetch(`/admins/${id}/unblock`, { method: 'PATCH' });
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async setPaymentStatus(id, payment_status) {
    const res = await authFetch(`/admins/${id}/payment-status`, {
      method: 'PATCH',
      body: JSON.stringify({ payment_status })
    });
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async listDrivers() {
    const res = await authFetch('/drivers');
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async listCompanies() {
    const res = await authFetch('/companies');
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async createCompany(payload) {
    const res = await authFetch('/companies', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async getCompany(id) {
    const res = await authFetch(`/companies/${id}`);
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async updateCompany(id, payload) {
    const res = await authFetch(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async setCompanyStatus(id, status) {
    const res = await authFetch(`/companies/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    const data = await res.json();
    return { ok: res.ok, ...data };
  },


  async getDriverDetail(driverId) {
    const res = await authFetch(`/drivers/${driverId}`);
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async setDriverApproval(driverId, action, reason) {
    const res = await authFetch(`/drivers/${driverId}/approval`, {
      method: 'PATCH',
      body: JSON.stringify({ action, reason })
    });
    const data = await res.json();
    return { ok: res.ok, ...data };
  },

  async logout() {
    try { await authFetch('/logout', { method: 'POST' }); } catch (e) {}
    setToken(null);
  }
};
