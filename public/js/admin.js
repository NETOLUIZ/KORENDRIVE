import { adminApi } from './admin-api.js';

const state = {
  admin: null,
  drivers: [],
  selectedDriverId: null
};

window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.copyInviteLink = copyInviteLink;
window.shareInviteLinkWhatsApp = shareInviteLinkWhatsApp;
window.toggleDriverPermission = toggleDriverPermission;
window.togglePasswordVisibility = togglePasswordVisibility;
window.openDriverReviewModal = openDriverReviewModal;
window.closeDriverReviewModal = closeDriverReviewModal;
window.handleApproveDriverClick = handleApproveDriverClick;
window.handleRejectDriverClick = handleRejectDriverClick;

function togglePasswordVisibility(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  if (icon) icon.textContent = isHidden ? 'visibility_off' : 'visibility';
}

document.addEventListener('DOMContentLoaded', async () => {
  if (adminApi.getToken()) {
    const res = await adminApi.me();
    if (res.ok) {
      state.admin = res.admin;
      showDashboard();
      return;
    }
  }
  showLogin();
});

function showLogin() {
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('view-dashboard').classList.add('hidden');
}

async function showDashboard() {
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('view-dashboard').classList.remove('hidden');

  document.getElementById('admin-company-name').textContent = state.admin.company_name || state.admin.name;
  const inviteUrl = `${location.origin}/r/${state.admin.invite_token}`;
  document.getElementById('invite-link-url').textContent = inviteUrl;

  await loadDrivers();
}

async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.classList.add('hidden');

  const res = await adminApi.login(email, password);
  if (res.ok && res.success) {
    state.admin = res.admin;
    showDashboard();
  } else {
    errorEl.textContent = res.error || 'Erro ao entrar. Tente novamente.';
    errorEl.classList.remove('hidden');
  }
}

async function handleLogout() {
  await adminApi.logout();
  state.admin = null;
  showLogin();
}

function copyInviteLink() {
  const url = document.getElementById('invite-link-url').textContent;
  navigator.clipboard.writeText(url);
  const label = document.getElementById('btn-copy-label');
  label.textContent = 'Copiado!';
  showToast('Link de convite copiado!');
  setTimeout(() => { label.textContent = 'Copiar'; }, 2000);
}

function shareInviteLinkWhatsApp() {
  const url = document.getElementById('invite-link-url').textContent;
  const text = encodeURIComponent(`Olá! Venha ser um motorista parceiro. Cadastre-se por aqui: ${url}`);
  window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
}

async function loadDrivers() {
  const res = await adminApi.getDrivers();
  if (!res.ok) return;
  state.drivers = res.drivers;
  renderDriversTable();
}

function statusBadge(status) {
  const isOnline = status === 'online';
  const cls = isOnline
    ? 'bg-brand/10 text-brand border border-brand/30'
    : 'bg-slate-800 text-slate-400 border border-slate-700';
  return `<span class="text-[10px] px-2 py-0.5 rounded-full font-semibold ${cls}">${isOnline ? 'Online' : 'Offline'}</span>`;
}

function approvalBadge(approvalStatus) {
  const map = {
    pending: { label: 'Pendente', cls: 'bg-amber-100 text-amber-700 border border-amber-300' },
    approved: { label: 'Aprovado', cls: 'bg-brand/10 text-brand border border-brand/30' },
    rejected: { label: 'Rejeitado', cls: 'bg-red-100 text-red-600 border border-red-300' }
  };
  const cfg = map[approvalStatus] || map.pending;
  return `<span class="text-[10px] px-2 py-0.5 rounded-full font-semibold ${cfg.cls}">${cfg.label}</span>`;
}

function switchToggle(driverId, field, checked) {
  return `
    <label class="switch">
      <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleDriverPermission(${driverId}, '${field}', this.checked)">
      <span class="slider"></span>
    </label>
  `;
}

function renderDriversTable() {
  const tbody = document.getElementById('drivers-table-body');
  const emptyMsg = document.getElementById('drivers-empty-msg');
  const countLabel = document.getElementById('driver-count-label');

  countLabel.textContent = `${state.drivers.length} motorista${state.drivers.length === 1 ? '' : 's'}`;

  if (state.drivers.length === 0) {
    tbody.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    return;
  }
  emptyMsg.classList.add('hidden');

  tbody.innerHTML = state.drivers.map(d => `
    <tr class="border-b border-surface-border/60">
      <td class="py-2.5 pr-3">
        <p class="text-slate-900 font-semibold">${d.name}</p>
        <p class="text-[10px] text-slate-500">${d.phone || ''}</p>
      </td>
      <td class="py-2.5 pr-3">${statusBadge(d.status)}</td>
      <td class="py-2.5 pr-3">${approvalBadge(d.approval_status)}</td>
      <td class="py-2.5 pr-3">${switchToggle(d.id, 'can_edit_rates', d.can_edit_rates === true)}</td>
      <td class="py-2.5 pr-3">${switchToggle(d.id, 'can_share_direct_link', d.can_share_direct_link === true)}</td>
      <td class="py-2.5 pr-3">
        <button onclick="openDriverReviewModal(${d.id})" class="text-brand font-semibold hover:underline">
          ${d.approval_status === 'pending' ? 'Revisar' : 'Ver'}
        </button>
      </td>
    </tr>
  `).join('');
}

async function toggleDriverPermission(driverId, field, value) {
  const res = await adminApi.updateDriverPermissions(driverId, { [field]: value });
  if (res.ok && res.success) {
    const driver = state.drivers.find(d => d.id === driverId);
    if (driver) driver[field] = Boolean(value);
    showToast('Permissão atualizada com sucesso!');
  } else {
    showToast(res.error || 'Erro ao atualizar permissão.');
    await loadDrivers();
  }
}

async function openDriverReviewModal(id) {
  const res = await adminApi.getDriverDetail(id);
  if (!res.ok || !res.driver) {
    showToast(res.error || 'Erro ao carregar motorista.');
    return;
  }

  state.selectedDriverId = id;
  const d = res.driver;
  const vehicle = (res.vehicles || []).find(v => v.is_active) || (res.vehicles || [])[0];

  document.getElementById('review-driver-info').innerHTML = `
    <p class="text-sm font-bold text-slate-900">${d.name}</p>
    <p>${d.email}</p>
    <p>${d.phone || ''}</p>
    <p>${d.cpf || ''}</p>
    <p>${d.address || ''}</p>
  `;

  document.getElementById('review-cnh-front').src = d.cnh_front || '';
  document.getElementById('review-cnh-back').src = d.cnh_back || '';

  const vehicleSection = document.getElementById('review-vehicle-section');
  if (vehicle) {
    vehicleSection.classList.remove('hidden');
    document.getElementById('review-vehicle-info').textContent = `${vehicle.model} • ${vehicle.plate} • ${vehicle.color}`;
    document.getElementById('review-vehicle-photo').src = vehicle.photo_url || '';
    document.getElementById('review-vehicle-crlv').src = vehicle.crlv_url || '';
  } else {
    vehicleSection.classList.add('hidden');
  }

  const reasonBox = document.getElementById('review-reject-reason-box');
  reasonBox.classList.add('hidden');
  document.getElementById('review-reject-reason').value = '';
  document.getElementById('btn-reject-driver').textContent = 'Rejeitar';

  const isPending = d.approval_status === 'pending';
  document.getElementById('review-actions').classList.toggle('hidden', !isPending);
  document.getElementById('review-decided-msg').classList.toggle('hidden', isPending);

  const modal = document.getElementById('modal-driver-review');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeDriverReviewModal() {
  const modal = document.getElementById('modal-driver-review');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  state.selectedDriverId = null;
}

async function handleApproveDriverClick() {
  if (!state.selectedDriverId) return;
  const res = await adminApi.setDriverApproval(state.selectedDriverId, 'approve');
  if (res.ok && res.success) {
    showToast('Motorista aprovado!');
    closeDriverReviewModal();
    await loadDrivers();
  } else {
    showToast(res.error || 'Erro ao aprovar motorista.');
  }
}

// Primeiro clique revela o campo de motivo; segundo clique confirma — evita
// um motorista ser rejeitado sem motivo por engano de clique duplo.
function handleRejectDriverClick() {
  const box = document.getElementById('review-reject-reason-box');
  if (box.classList.contains('hidden')) {
    box.classList.remove('hidden');
    document.getElementById('btn-reject-driver').textContent = 'Confirmar rejeição';
    return;
  }
  confirmRejectDriver();
}

async function confirmRejectDriver() {
  const reason = document.getElementById('review-reject-reason').value.trim();
  if (!reason) {
    showToast('Informe o motivo da rejeição.');
    return;
  }

  const res = await adminApi.setDriverApproval(state.selectedDriverId, 'reject', reason);
  if (res.ok && res.success) {
    showToast('Motorista rejeitado.');
    closeDriverReviewModal();
    await loadDrivers();
  } else {
    showToast(res.error || 'Erro ao rejeitar motorista.');
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toast-msg');
  if (toast && msgEl) {
    msgEl.textContent = msg;
    toast.classList.remove('opacity-0', '-translate-y-4');
    toast.classList.add('opacity-100', 'translate-y-0');
    setTimeout(() => {
      toast.classList.remove('opacity-100', 'translate-y-0');
      toast.classList.add('opacity-0', '-translate-y-4');
    }, 2800);
  }
}
