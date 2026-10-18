import { superadminApi } from './superadmin-api.js';

// ============================================================================
// Estado — a lógica de dados/API é a mesma de antes; só a apresentação mudou.
// ============================================================================
const state = {
  admins: [],       // vem de GET /admins (tem created_at, usado pros gráficos honestos)
  billing: null,    // vem de GET /billing-summary (totais oficiais, calculados no servidor)
  independentDrivers: [], // vem de GET /drivers (motoristas sem admin_id)
  companies: [],
  selectedDriverId: null,
  revenuePeriod: '6m',
  currentPage: 'dashboard'
};

window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.handleCreateAdmin = handleCreateAdmin;
window.toggleAdminBlock = toggleAdminBlock;
window.togglePaymentStatus = togglePaymentStatus;
window.renderAdminsTable = renderAdminsTable;
window.exportAdminsCsv = exportAdminsCsv;
window.setRevenuePeriod = setRevenuePeriod;
window.navigateSA = navigateSA;
window.toggleSidebarCollapse = toggleSidebarCollapse;
window.openMobileSidebar = openMobileSidebar;
window.closeMobileSidebar = closeMobileSidebar;
window.toggleUserMenu = toggleUserMenu;
window.toggleRowMenu = toggleRowMenu;
window.togglePasswordVisibility = togglePasswordVisibility;
window.openDriverReviewModal = openDriverReviewModal;
window.closeDriverReviewModal = closeDriverReviewModal;
window.openDriverPasswordModal = openDriverPasswordModal;
window.closeDriverPasswordModal = closeDriverPasswordModal;
window.handleDriverPasswordSubmit = handleDriverPasswordSubmit;
window.handleApproveDriverClick = handleApproveDriverClick;
window.handleRejectDriverClick = handleRejectDriverClick;
window.toggleCompanyForm = toggleCompanyForm;
window.handleCreateCompany = handleCreateCompany;
window.renderCompaniesPage = renderCompaniesPage;
window.openCompanyDetail = openCompanyDetail;
window.closeCompanyDetail = closeCompanyDetail;
window.handleCompanyStatus = handleCompanyStatus;
window.handleUpdateCompany = handleUpdateCompany;

function togglePasswordVisibility(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  if (icon) icon.textContent = isHidden ? 'visibility_off' : 'visibility';
}

document.addEventListener('DOMContentLoaded', async () => {
  if (superadminApi.getToken()) {
    const res = await superadminApi.listAdmins();
    if (res.ok) {
      state.admins = res.admins;
      showDashboard();
      return;
    }
  }
  showLogin();

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#btn-user-menu') && !e.target.closest('#user-menu-dropdown')) {
      document.getElementById('user-menu-dropdown')?.classList.add('hidden');
    }
    if (!e.target.closest('.row-menu-btn') && !e.target.closest('.row-menu-dropdown')) {
      document.querySelectorAll('.row-menu-dropdown').forEach(el => el.classList.add('hidden'));
    }
  });
});

function showLogin() {
  document.getElementById('view-login').classList.remove('hidden');
  document.getElementById('view-dashboard').classList.add('hidden');
}

function showDashboard() {
  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('view-dashboard').classList.remove('hidden');
  renderAdminsTable();
  loadBillingSummary();
  loadIndependentDrivers();
  loadCompanies();
}

// ============================================================================
// Navegação (sidebar / topbar) — puramente visual, não afeta dados/lógica
// ============================================================================
function navigateSA(page) {
  state.currentPage = page;

  document.querySelectorAll('.sa-nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  const titles = {
    dashboard: ['Dashboard', 'Visão geral da plataforma'],
    administradores: ['Administradores', 'Gerencie os administradores cadastrados'],
    'motoristas-independentes': ['Motoristas Independentes', 'Cadastros aguardando aprovação do super admin'],
    empresas: ['Empresas', 'Empresas parceiras da plataforma'],
    assinaturas: ['Assinaturas', 'Planos e assinaturas ativas'],
    pagamentos: ['Pagamentos', 'Histórico e cobranças'],
    relatorios: ['Relatórios', 'Análises e exportações'],
    configuracoes: ['Configurações', 'Preferências da plataforma']
  };
  const [title, subtitle] = titles[page] || titles.dashboard;
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = subtitle;

  const isDashboard = page === 'dashboard' || page === 'administradores' || page === 'motoristas-independentes' || page === 'empresas';
  document.getElementById('page-dashboard').classList.toggle('hidden', page !== 'dashboard');
  document.getElementById('page-administradores').classList.toggle('hidden', page !== 'administradores');
  document.getElementById('page-motoristas-independentes').classList.toggle('hidden', page !== 'motoristas-independentes');
  document.getElementById('page-empresas').classList.toggle('hidden', page !== 'empresas');
  document.getElementById('page-placeholder').classList.toggle('hidden', isDashboard);

  if (page === 'empresas') loadCompanies();

  if (!isDashboard) {
    const icons = { empresas: 'business', assinaturas: 'workspace_premium', pagamentos: 'payments', relatorios: 'monitoring', configuracoes: 'settings' };
    document.getElementById('placeholder-icon').textContent = icons[page] || 'construction';
    document.getElementById('placeholder-title').textContent = title;
  }

  closeMobileSidebar();
}

function toggleSidebarCollapse() {
  const sidebar = document.getElementById('sidebar');
  const isCollapsed = sidebar.classList.toggle('collapsed');
  document.getElementById('sidebar-collapse-icon').textContent = isCollapsed ? 'left_panel_open' : 'left_panel_close';
}

function openMobileSidebar() {
  document.getElementById('sidebar').classList.add('mobile-open');
  document.getElementById('sidebar-backdrop').classList.add('show');
}

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-backdrop').classList.remove('show');
}

function toggleUserMenu() {
  document.getElementById('user-menu-dropdown').classList.toggle('hidden');
}

function toggleRowMenu(id) {
  document.querySelectorAll('.row-menu-dropdown').forEach(el => {
    if (el.id !== `row-menu-${id}`) el.classList.add('hidden');
  });
  document.getElementById(`row-menu-${id}`)?.classList.toggle('hidden');
}

// ============================================================================
// Login / Logout — mesma chamada de API de antes
// ============================================================================
async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.classList.add('hidden');

  setLoading('btn-login-submit', 'btn-login-icon', 'btn-login-label', true, 'Entrando...');

  const res = await superadminApi.login(email, password);
  if (res.ok && res.success) {
    await loadAdmins();
    showDashboard();
  } else {
    errorEl.textContent = res.error || 'Erro ao entrar. Tente novamente.';
    errorEl.classList.remove('hidden');
  }
  setLoading('btn-login-submit', 'btn-login-icon', 'btn-login-label', false, 'Entrar no Painel', 'login');
}

async function handleLogout() {
  await superadminApi.logout();
  showLogin();
}

function setLoading(btnId, iconId, labelId, isLoading, loadingLabel, restoreIcon) {
  const btn = document.getElementById(btnId);
  const icon = document.getElementById(iconId);
  const label = document.getElementById(labelId);
  if (!btn) return;
  btn.disabled = isLoading;
  if (isLoading) {
    icon.textContent = 'progress_activity';
    icon.classList.add('sa-spin');
    label.textContent = loadingLabel;
  } else {
    icon.classList.remove('sa-spin');
    icon.textContent = restoreIcon || icon.textContent;
    label.textContent = loadingLabel;
  }
}

async function loadAdmins() {
  const res = await superadminApi.listAdmins();
  if (res.ok) state.admins = res.admins;
}

// ============================================================================
// Criar Admin — mesma chamada de API de antes, com estados visuais de loading/erro
// ============================================================================
async function handleCreateAdmin(event) {
  event.preventDefault();
  const name = document.getElementById('new-admin-name').value;
  const company_name = document.getElementById('new-admin-company').value;
  const email = document.getElementById('new-admin-email').value;
  const password = document.getElementById('new-admin-password').value;
  const monthly_fee = document.getElementById('new-admin-fee').value;
  const errorEl = document.getElementById('create-admin-error');
  errorEl.classList.add('hidden');

  setLoading('btn-create-admin', 'btn-create-admin-icon', 'btn-create-admin-label', true, 'Criando...');

  const res = await superadminApi.createAdmin({ name, company_name, email, password, monthly_fee });

  setLoading('btn-create-admin', 'btn-create-admin-icon', 'btn-create-admin-label', false, 'Criar administrador', 'add');

  if (res.ok && res.success) {
    showToast('Admin criado com sucesso!');
    document.getElementById('form-new-admin').reset();
    document.getElementById('new-admin-fee').value = '99.90';
    await loadAdmins();
    renderAdminsTable();
    loadBillingSummary();
  } else {
    errorEl.textContent = res.error || 'Erro ao criar admin.';
    errorEl.classList.remove('hidden');
    showToast(res.error || 'Erro ao criar admin.');
  }
}

// ============================================================================
// Ações da tabela — mesmas chamadas de API de antes (bloquear/desbloquear/pagamento)
// ============================================================================
async function toggleAdminBlock(id, currentStatus) {
  const res = currentStatus === 'active' ? await superadminApi.blockAdmin(id) : await superadminApi.unblockAdmin(id);
  if (res.ok && res.success) {
    showToast(currentStatus === 'active' ? 'Admin bloqueado.' : 'Admin desbloqueado.');
    await loadAdmins();
    renderAdminsTable();
    loadBillingSummary();
  } else {
    showToast(res.error || 'Erro ao atualizar status.');
  }
}

async function togglePaymentStatus(id, currentStatus) {
  const next = currentStatus === 'em_dia' ? 'inadimplente' : 'em_dia';
  const res = await superadminApi.setPaymentStatus(id, next);
  if (res.ok && res.success) {
    showToast('Status de pagamento atualizado.');
    await loadAdmins();
    renderAdminsTable();
    loadBillingSummary();
  } else {
    showToast(res.error || 'Erro ao atualizar pagamento.');
  }
}

// ============================================================================
// Badges
// ============================================================================
function statusBadge(status) {
  return status === 'active'
    ? `<span class="sa-badge sa-badge-green"><span class="material-symbols-outlined text-[12px]">check_circle</span>Ativo</span>`
    : `<span class="sa-badge sa-badge-gray"><span class="material-symbols-outlined text-[12px]">block</span>Bloqueado</span>`;
}

function paymentBadge(paymentStatus) {
  return paymentStatus === 'em_dia'
    ? `<span class="sa-badge sa-badge-green"><span class="material-symbols-outlined text-[12px]">check_circle</span>Em dia</span>`
    : `<span class="sa-badge sa-badge-red"><span class="material-symbols-outlined text-[12px]">error</span>Inadimplente</span>`;
}

function initials(name) {
  const parts = (name || '').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
}

function formatBRL(value) {
  return `R$ ${Number(value).toFixed(2).replace('.', ',')}`;
}

// ============================================================================
// Tabela de Administradores — busca/filtros são só client-side (sem endpoint novo)
// ============================================================================
function getFilteredAdmins() {
  const q = (document.getElementById('table-search')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('filter-status')?.value || '';
  const paymentFilter = document.getElementById('filter-payment')?.value || '';

  return state.admins.filter(a => {
    const matchesQuery = !q || a.name.toLowerCase().includes(q) || (a.company_name || '').toLowerCase().includes(q) || a.email.toLowerCase().includes(q);
    const matchesStatus = !statusFilter || a.status === statusFilter;
    const matchesPayment = !paymentFilter || a.payment_status === paymentFilter;
    return matchesQuery && matchesStatus && matchesPayment;
  });
}

function renderAdminsTable() {
  const tbody = document.getElementById('admins-table-body');
  const emptyMsg = document.getElementById('admins-empty-msg');
  const countLabel = document.getElementById('admin-count-label');
  const filtered = getFilteredAdmins();

  countLabel.textContent = `${filtered.length} de ${state.admins.length} admin${state.admins.length === 1 ? '' : 's'}`;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    return;
  }
  emptyMsg.classList.add('hidden');

  tbody.innerHTML = filtered.map(a => `
    <tr>
      <td>
        <div class="flex items-center gap-2.5">
          <div class="sa-avatar">${initials(a.name)}</div>
          <div class="min-w-0">
            <p class="text-satext1 font-semibold truncate">${a.name}</p>
            <p class="text-[11px] text-satext2 truncate">${a.email}</p>
          </div>
        </div>
      </td>
      <td class="text-satext2">${a.company_name || '—'}</td>
      <td class="text-satext1 font-semibold">${a.driver_count}</td>
      <td class="text-satext1 font-semibold">${formatBRL(a.monthly_fee)}</td>
      <td>${statusBadge(a.status)}</td>
      <td>${paymentBadge(a.payment_status)}</td>
      <td>
        <div class="flex items-center gap-1.5 relative">
          <button onclick="toggleAdminBlock(${a.id}, '${a.status}')" class="${a.status === 'active' ? 'sa-btn-danger' : 'sa-btn-primary'} rounded-md px-2.5 py-1.5 text-[11px]">
            ${a.status === 'active' ? 'Bloquear' : 'Desbloquear'}
          </button>
          <button onclick="toggleRowMenu(${a.id})" class="row-menu-btn w-7 h-7 rounded-md sa-btn-secondary flex items-center justify-center">
            <span class="material-symbols-outlined text-[16px]">more_vert</span>
          </button>
          <div id="row-menu-${a.id}" class="row-menu-dropdown hidden absolute right-0 top-9 w-52 sa-dropdown p-1.5 z-20 text-left">
            <div class="sa-dropdown-item" onclick="togglePaymentStatus(${a.id}, '${a.payment_status}'); toggleRowMenu(${a.id})">
              <span class="material-symbols-outlined text-[16px] text-satext2">sync_alt</span>
              Marcar como ${a.payment_status === 'em_dia' ? 'inadimplente' : 'em dia'}
            </div>
          </div>
        </div>
      </td>
    </tr>
  `).join('');
}

function exportAdminsCsv() {
  const rows = getFilteredAdmins();
  const header = ['Nome', 'Empresa', 'E-mail', 'Motoristas', 'Mensalidade', 'Status', 'Pagamento'];
  const lines = [header.join(';')];

  rows.forEach(a => {
    lines.push([
      a.name, a.company_name || '', a.email, a.driver_count,
      a.monthly_fee.toFixed(2).replace('.', ','), a.status === 'active' ? 'Ativo' : 'Bloqueado',
      a.payment_status === 'em_dia' ? 'Em dia' : 'Inadimplente'
    ].join(';'));
  });

  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'administradores.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('CSV exportado com sucesso!');
}

// ============================================================================
// KPIs — totais oficiais vêm do backend (billing-summary); as tendências são
// calculadas honestamente a partir de datas reais de cadastro (created_at),
// nunca inventadas. Quando não há mês anterior pra comparar, isso é dito.
// ============================================================================
async function loadBillingSummary() {
  const res = await superadminApi.getBillingSummary();
  if (!res.ok) return;
  state.billing = res;

  document.getElementById('kpi-received').textContent = formatBRL(res.totalReceived);
  document.getElementById('kpi-overdue').textContent = formatBRL(res.totalOverdue);
  document.getElementById('kpi-count-em-dia').textContent = res.countEmDia;
  document.getElementById('kpi-count-inadimplente').textContent = res.countInadimplente;

  renderKpiTrends();
  renderRevenueChart();
  renderSubscriptionDonut();
  renderAdminRanking();
}

function parseCreatedAt(str) {
  return new Date((str || '').replace(' ', 'T'));
}

function getMonthRange(offsetFromCurrent) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetFromCurrent, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offsetFromCurrent + 1, 1);
  return { start, end };
}

function sumInRange(admins, start, end, filterFn) {
  return admins
    .filter(a => {
      const created = parseCreatedAt(a.created_at);
      return created >= start && created < end && (!filterFn || filterFn(a));
    })
    .reduce((sum, a) => sum + a.monthly_fee, 0);
}

function countInRange(admins, start, end, filterFn) {
  return admins.filter(a => {
    const created = parseCreatedAt(a.created_at);
    return created >= start && created < end && (!filterFn || filterFn(a));
  }).length;
}

function trendLabel(current, previous, { isCurrency } = {}) {
  const fmt = v => isCurrency ? formatBRL(v) : v;
  if (previous === 0) {
    return current > 0
      ? `<span style="color:#4FB885">+${fmt(current)}</span> novos este mês`
      : `Sem novos cadastros este mês`;
  }
  const pct = ((current - previous) / previous) * 100;
  const positive = pct >= 0;
  const color = positive ? '#4FB885' : '#DF6A46';
  const arrow = positive ? '↑' : '↓';
  return `<span style="color:${color}">${arrow} ${Math.abs(pct).toFixed(1)}%</span> vs. mês anterior`;
}

function renderKpiTrends() {
  const admins = state.admins;
  const thisMonth = getMonthRange(0);
  const lastMonth = getMonthRange(-1);

  const receivedThis = sumInRange(admins, thisMonth.start, thisMonth.end, a => a.payment_status === 'em_dia');
  const receivedLast = sumInRange(admins, lastMonth.start, lastMonth.end, a => a.payment_status === 'em_dia');
  document.getElementById('kpi-received-trend').innerHTML = trendLabel(receivedThis, receivedLast, { isCurrency: true });

  const overdueThis = sumInRange(admins, thisMonth.start, thisMonth.end, a => a.payment_status === 'inadimplente');
  const overdueLast = sumInRange(admins, lastMonth.start, lastMonth.end, a => a.payment_status === 'inadimplente');
  document.getElementById('kpi-overdue-trend').innerHTML = overdueThis > 0 || overdueLast > 0
    ? trendLabel(overdueThis, overdueLast, { isCurrency: true })
    : `<span style="color:#8b949e">Nenhum atraso novo</span>`;

  const emDiaThis = countInRange(admins, thisMonth.start, thisMonth.end, a => a.payment_status === 'em_dia');
  const emDiaLast = countInRange(admins, lastMonth.start, lastMonth.end, a => a.payment_status === 'em_dia');
  document.getElementById('kpi-count-em-dia-trend').innerHTML = trendLabel(emDiaThis, emDiaLast);

  const inadThis = countInRange(admins, thisMonth.start, thisMonth.end, a => a.payment_status === 'inadimplente');
  const inadLast = countInRange(admins, lastMonth.start, lastMonth.end, a => a.payment_status === 'inadimplente');
  document.getElementById('kpi-count-inadimplente-trend').innerHTML = inadThis > 0 || inadLast > 0
    ? trendLabel(inadThis, inadLast)
    : `<span style="color:#8b949e">Nenhum novo inadimplente</span>`;
}

// ============================================================================
// Gráfico de Faturamento — linha/área empilhada (Recebido x Em atraso),
// construída com SVG puro a partir de dados reais (created_at + monthly_fee
// + payment_status atual). É a receita recorrente acumulada por data de
// cadastro — não existe um histórico de cobranças mês a mês no sistema, então
// não fingimos que existe: o eixo mostra a base de receita construída ao
// longo do tempo, o que é honesto e real.
// ============================================================================
function setRevenuePeriod(period) {
  state.revenuePeriod = period;
  document.querySelectorAll('.sa-period-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === period);
  });
  renderRevenueChart();
}

function buildRevenueBuckets(period) {
  const now = new Date();
  const buckets = [];

  if (period === '7d' || period === '30d') {
    const days = period === '7d' ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      buckets.push({ label: day.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), end });
    }
  } else {
    const months = period === '6m' ? 6 : 12;
    for (let i = months - 1; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(m.getFullYear(), m.getMonth() + 1, 1);
      buckets.push({ label: m.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''), end });
    }
  }
  return buckets;
}

function renderRevenueChart() {
  const svg = document.getElementById('revenue-chart-svg');
  const admins = state.admins;
  const buckets = buildRevenueBuckets(state.revenuePeriod);

  // Cumulativo até o fim de cada bucket, dividido pelo status atual
  const series = buckets.map(b => {
    const received = admins.filter(a => parseCreatedAt(a.created_at) < b.end && a.payment_status === 'em_dia').reduce((s, a) => s + a.monthly_fee, 0);
    const overdue = admins.filter(a => parseCreatedAt(a.created_at) < b.end && a.payment_status === 'inadimplente').reduce((s, a) => s + a.monthly_fee, 0);
    return { label: b.label, received, overdue, total: received + overdue };
  });

  const totalNow = series.length ? series[series.length - 1].total : 0;
  const firstTotal = series.length ? series[0].total : 0;
  document.getElementById('chart-revenue-total').textContent = formatBRL(totalNow);
  document.getElementById('chart-revenue-trend').innerHTML = trendLabel(totalNow, firstTotal, { isCurrency: true });

  const W = 800, H = 260;
  const padL = 8, padR = 8, padT = 16, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxVal = Math.max(...series.map(s => s.total), 1) * 1.15;

  const x = i => padL + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
  const yFor = v => padT + plotH - (v / maxVal) * plotH;

  const receivedPoints = series.map((s, i) => [x(i), yFor(s.received)]);
  const totalPoints = series.map((s, i) => [x(i), yFor(s.total)]);

  const linePath = pts => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const areaPath = (top, baselineY) => {
    const d = linePath(top);
    const last = top[top.length - 1];
    const first = top[0];
    return `${d} L ${last[0].toFixed(1)} ${baselineY} L ${first[0].toFixed(1)} ${baselineY} Z`;
  };

  const baseline = padT + plotH;
  const gridLines = [0.25, 0.5, 0.75, 1].map(f => {
    const gy = padT + plotH * (1 - f);
    return `<line x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" stroke="#2e282c" stroke-width="1" />`;
  }).join('');

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <defs>
      <linearGradient id="gradReceived" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#4FB885" stop-opacity="0.28" />
        <stop offset="100%" stop-color="#4FB885" stop-opacity="0.02" />
      </linearGradient>
      <linearGradient id="gradOverdue" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#DF6A46" stop-opacity="0.28" />
        <stop offset="100%" stop-color="#DF6A46" stop-opacity="0.02" />
      </linearGradient>
    </defs>
    ${gridLines}
    <path d="${areaPath(totalPoints, baseline)}" fill="url(#gradOverdue)" />
    <path d="${areaPath(receivedPoints, baseline)}" fill="url(#gradReceived)" />
    <path d="${linePath(totalPoints)}" fill="none" stroke="#DF6A46" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    <path d="${linePath(receivedPoints)}" fill="none" stroke="#4FB885" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    ${series.map((s, i) => `<circle cx="${x(i)}" cy="${yFor(s.received)}" r="3" fill="#191517" stroke="#4FB885" stroke-width="2" />`).join('')}
    ${series.length <= 14 ? series.map((s, i) => `<text x="${x(i)}" y="${H - 6}" font-size="10" fill="#8b949e" text-anchor="middle">${s.label}</text>`).join('') : ''}
  `;

  attachChartHover(svg, series, x, padT, plotH);
}

function attachChartHover(svg, series, xFn, padT, plotH) {
  const wrap = document.getElementById('revenue-chart-wrap');
  const tooltip = document.getElementById('revenue-chart-tooltip');
  const W = 800;

  wrap.onmousemove = (e) => {
    const rect = wrap.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const svgX = relX * W;
    let closest = 0, minDist = Infinity;
    series.forEach((s, i) => {
      const d = Math.abs(xFn(i) - svgX);
      if (d < minDist) { minDist = d; closest = i; }
    });
    const s = series[closest];
    const px = (xFn(closest) / W) * rect.width;
    const py = (padT / 260) * rect.height + 6;

    tooltip.style.left = `${px}px`;
    tooltip.style.top = `${py}px`;
    tooltip.style.opacity = '1';
    tooltip.innerHTML = `
      <div class="font-semibold text-satext1 mb-1">${s.label}</div>
      <div style="color:#4FB885">● Recebido: ${formatBRL(s.received)}</div>
      <div style="color:#DF6A46">● Em atraso: ${formatBRL(s.overdue)}</div>
    `;
  };
  wrap.onmouseleave = () => { tooltip.style.opacity = '0'; };
}

// ============================================================================
// Donut de Assinaturas — só usa estados que existem de verdade no sistema
// (Ativas / Em atraso / Bloqueadas). Não existe conceito de "pendente" ou
// "cancelada" nos dados hoje, então não inventamos essas categorias.
// ============================================================================
function renderSubscriptionDonut() {
  const admins = state.admins;
  const active = admins.filter(a => a.status === 'active' && a.payment_status === 'em_dia').length;
  const overdue = admins.filter(a => a.status === 'active' && a.payment_status === 'inadimplente').length;
  const blocked = admins.filter(a => a.status === 'blocked').length;
  const total = active + overdue + blocked;

  document.getElementById('donut-total').textContent = total;

  const svg = document.getElementById('subscription-donut');
  const r = 50, cx = 60, cy = 60, sw = 16;
  const circumference = 2 * Math.PI * r;

  const segments = [
    { value: active, color: '#4FB885' },
    { value: overdue, color: '#DF6A46' },
    { value: blocked, color: '#5E5058' }
  ];

  let offset = 0;
  const circles = segments.map(seg => {
    if (total === 0 || seg.value === 0) return '';
    const frac = seg.value / total;
    const dash = frac * circumference;
    const gap = circumference - dash;
    const circle = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${sw}" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${-offset}" stroke-linecap="butt" />`;
    offset += dash;
    return circle;
  }).join('');

  svg.innerHTML = total === 0
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#2e282c" stroke-width="${sw}" />`
    : circles;

  const legendItems = [
    { label: 'Ativas', value: active, color: '#4FB885' },
    { label: 'Em atraso', value: overdue, color: '#DF6A46' },
    { label: 'Bloqueadas', value: blocked, color: '#5E5058' }
  ];

  document.getElementById('donut-legend').innerHTML = legendItems.map(item => `
    <div class="flex items-center justify-between text-[12.5px]">
      <span class="flex items-center gap-2 text-satext2">
        <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${item.color}"></span>
        ${item.label}
      </span>
      <span class="text-satext1 font-semibold">${item.value}</span>
    </div>
  `).join('');
}

// ============================================================================
// Ranking de Receita por Admin
// ============================================================================
function renderAdminRanking() {
  const container = document.getElementById('admin-ranking-list');
  const emptyMsg = document.getElementById('admin-ranking-empty');
  const ranked = [...state.admins].sort((a, b) => b.monthly_fee - a.monthly_fee);

  if (ranked.length === 0) {
    container.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    return;
  }
  emptyMsg.classList.add('hidden');

  container.innerHTML = ranked.slice(0, 8).map((a, i) => `
    <div class="flex items-center gap-3 py-2.5 ${i !== 0 ? 'border-t border-saborder' : ''}">
      <span class="text-[11px] font-bold text-satext2 w-4 shrink-0">${i + 1}</span>
      <div class="sa-avatar">${initials(a.name)}</div>
      <div class="min-w-0 flex-1">
        <p class="text-[13px] font-semibold text-satext1 truncate">${a.company_name || a.name}</p>
        <p class="text-[11px] text-satext2 truncate">${a.name}</p>
      </div>
      <span class="text-[13px] font-bold text-satext1 shrink-0">${formatBRL(a.monthly_fee)}</span>
      ${a.payment_status === 'em_dia' ? statusBadgeSmallGreen() : statusBadgeSmallRed()}
    </div>
  `).join('');
}

function statusBadgeSmallGreen() {
  return `<span class="sa-badge sa-badge-green shrink-0">Ativo</span>`;
}
function statusBadgeSmallRed() {
  return `<span class="sa-badge sa-badge-red shrink-0">Em atraso</span>`;
}

// ============================================================================
// Motoristas Independentes — cadastros sem empresa vinculada, aprovados/
// rejeitados direto pelo Super Admin.
// ============================================================================
async function loadIndependentDrivers() {
  const res = await superadminApi.listDrivers();
  if (!res.ok) return;
  state.independentDrivers = res.drivers;
  renderIndependentDriversTable();
}

function approvalBadge(approvalStatus) {
  const map = {
    pending: 'sa-badge sa-badge-yellow',
    approved: 'sa-badge sa-badge-green',
    rejected: 'sa-badge sa-badge-red'
  };
  const label = { pending: 'Pendente', approved: 'Aprovado', rejected: 'Rejeitado' }[approvalStatus] || 'Pendente';
  return `<span class="${map[approvalStatus] || map.pending}">${label}</span>`;
}

function renderIndependentDriversTable() {
  const tbody = document.getElementById('independent-drivers-table-body');
  const emptyMsg = document.getElementById('independent-drivers-empty-msg');
  const countLabel = document.getElementById('independent-driver-count-label');
  if (!tbody) return;

  countLabel.textContent = `${state.independentDrivers.length} motorista${state.independentDrivers.length === 1 ? '' : 's'}`;

  if (state.independentDrivers.length === 0) {
    tbody.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    return;
  }
  emptyMsg.classList.add('hidden');

  tbody.innerHTML = state.independentDrivers.map(d => `
    <tr>
      <td class="font-semibold text-satext1">${d.name}</td>
      <td>${d.email}<br><span class="text-[11px] text-satext2">${d.phone || ''}</span></td>
      <td>${approvalBadge(d.approval_status)}</td>
      <td>${new Date(d.created_at).toLocaleDateString('pt-BR')}</td>
      <td>
        <button onclick="openDriverReviewModal(${d.id})" class="text-sagreen font-semibold hover:underline">
          ${d.approval_status === 'pending' ? 'Revisar' : 'Ver'}
        </button>
        <button onclick="openDriverPasswordModal(${d.id})" class="ml-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-saborder bg-sabg2 text-satext1 font-semibold hover:border-sagreen hover:text-sagreen transition">
          <span class="material-symbols-outlined text-sm">lock_reset</span>
          Editar senha
        </button>
      </td>
    </tr>
  `).join('');
}

// Alterar a senha de um motorista independente — o super admin digita a nova
// senha e passa pro motorista por fora (ex: WhatsApp).
function openDriverPasswordModal(id) {
  const d = state.independentDrivers.find(x => x.id === id);
  if (!d) return;
  state.passwordDriverId = id;
  document.getElementById('driver-password-who').textContent = `${d.name} — ${d.email}`;
  document.getElementById('driver-password-input').value = '';
  const modal = document.getElementById('modal-driver-password');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.getElementById('driver-password-input').focus();
}

function closeDriverPasswordModal() {
  const modal = document.getElementById('modal-driver-password');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  document.getElementById('driver-password-input').value = '';
  state.passwordDriverId = null;
}

async function handleDriverPasswordSubmit(event) {
  event.preventDefault();
  if (!state.passwordDriverId) return;
  const res = await superadminApi.setDriverPassword(state.passwordDriverId, document.getElementById('driver-password-input').value);
  if (res.ok && res.success) {
    showToast('Senha alterada!');
    closeDriverPasswordModal();
  } else {
    showToast(res.error || 'Erro ao alterar senha.');
  }
}

async function openDriverReviewModal(id) {
  const res = await superadminApi.getDriverDetail(id);
  if (!res.ok || !res.driver) {
    showToast(res.error || 'Erro ao carregar motorista.');
    return;
  }

  state.selectedDriverId = id;
  const d = res.driver;
  const vehicle = (res.vehicles || []).find(v => v.is_active) || (res.vehicles || [])[0];

  document.getElementById('review-driver-info').innerHTML = `
    <p class="text-[13px] font-bold text-satext1">${d.name}</p>
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
  const res = await superadminApi.setDriverApproval(state.selectedDriverId, 'approve');
  if (res.ok && res.success) {
    showToast('Motorista aprovado!');
    closeDriverReviewModal();
    await loadIndependentDrivers();
  } else {
    showToast(res.error || 'Erro ao aprovar motorista.');
  }
}

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

  const res = await superadminApi.setDriverApproval(state.selectedDriverId, 'reject', reason);
  if (res.ok && res.success) {
    showToast('Motorista rejeitado.');
    closeDriverReviewModal();
    await loadIndependentDrivers();
  } else {
    showToast(res.error || 'Erro ao rejeitar motorista.');
  }
}

// ============================================================================
// Toast
// ============================================================================
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

async function loadCompanies() {
  const res = await superadminApi.listCompanies();
  if (res.ok) { state.companies = res.companies; renderCompaniesPage(); }
}

function formatMoney(value) { return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

function renderCompaniesPage() {
  const query = (document.getElementById('companies-search')?.value || '').toLowerCase();
  const companies = state.companies.filter(c => [c.name, c.admin_name, c.admin_email].some(v => String(v || '').toLowerCase().includes(query)));
  const body = document.getElementById('companies-table-body');
  if (!body) return;
  body.innerHTML = companies.map(c => `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.admin_name || '')}<br><span class="text-xs text-satext2">${escapeHtml(c.admin_email || '')}</span></td><td>${escapeHtml(c.plan)}</td><td>${c.driver_count}</td><td>${formatMoney(c.monthly_fee)}</td><td>${statusBadge(c.status)}</td><td><button onclick="openCompanyDetail(${c.id})" class="text-sagreen">Ver</button></td></tr>`).join('') || '<tr><td colspan="7" class="text-center py-6 text-satext2">Nenhuma empresa encontrada.</td></tr>';
  const active = state.companies.filter(c => c.status === 'active');
  document.getElementById('companies-active').textContent = active.length;
  document.getElementById('companies-blocked').textContent = state.companies.length - active.length;
  document.getElementById('companies-drivers').textContent = state.companies.reduce((n, c) => n + Number(c.driver_count || 0), 0);
  document.getElementById('companies-revenue').textContent = formatMoney(active.reduce((n, c) => n + Number(c.monthly_fee || 0), 0));
}

function toggleCompanyForm() { document.getElementById('form-company').classList.toggle('hidden'); }

async function handleCreateCompany(event) {
  event.preventDefault();
  const value = id => document.getElementById(id).value.trim();
  const payload = { company: { name: value('company-name'), cnpj: value('company-cnpj'), phone: value('company-phone'), email: value('company-email'), address: value('company-address'), plan: value('company-plan'), monthly_fee: value('company-fee') }, admin: { name: value('company-admin-name'), email: value('company-admin-email'), password: value('company-admin-password') } };
  const res = await superadminApi.createCompany(payload);
  if (!res.ok) return showToast(res.error || 'Não foi possível cadastrar a empresa.');
  event.target.reset(); event.target.classList.add('hidden'); showToast('Empresa cadastrada com sucesso.');
  await Promise.all([loadCompanies(), loadAdmins(), loadBillingSummary()]); renderAdminsTable();
}

async function openCompanyDetail(id) {
  const res = await superadminApi.getCompany(id);
  if (!res.ok) return showToast(res.error || 'Não foi possível carregar a empresa.');
  const { company, drivers } = res;
  document.getElementById('company-detail-content').innerHTML = `<h2 class="font-bold text-lg">${escapeHtml(company.name)}</h2><p class="text-sm text-satext2">${escapeHtml(company.admin_name)} · ${escapeHtml(company.plan)}</p><p class="mt-4 text-sm">${drivers.length} motorista(s) vinculado(s)</p><ul class="mt-2 text-sm space-y-1">${drivers.map(d => `<li>${escapeHtml(d.name)} — ${escapeHtml(d.email)}</li>`).join('') || '<li class="text-satext2">Nenhum motorista vinculado.</li>'}</ul><div class="flex gap-2 mt-5"><button onclick="handleUpdateCompany(${company.id})" class="sa-btn-secondary rounded-lg px-3 py-2">Editar</button><button onclick="handleCompanyStatus(${company.id}, '${company.status === 'active' ? 'blocked' : 'active'}')" class="sa-btn-secondary rounded-lg px-3 py-2">${company.status === 'active' ? 'Bloquear empresa' : 'Desbloquear empresa'}</button></div>`;
  document.getElementById('modal-company-detail').classList.remove('hidden'); document.getElementById('modal-company-detail').classList.add('flex');
}
function closeCompanyDetail() { const el = document.getElementById('modal-company-detail'); el.classList.add('hidden'); el.classList.remove('flex'); }
async function handleCompanyStatus(id, status) { const res = await superadminApi.setCompanyStatus(id, status); if (!res.ok) return showToast(res.error || 'Não foi possível atualizar a empresa.'); closeCompanyDetail(); showToast('Status da empresa atualizado.'); await Promise.all([loadCompanies(), loadAdmins(), loadBillingSummary()]); renderAdminsTable(); }

async function handleUpdateCompany(id) {
  const company = state.companies.find(item => item.id === id);
  if (!company) return;
  const name = window.prompt('Nome da empresa', company.name);
  if (name === null || !name.trim()) return;
  const plan = window.prompt('Plano', company.plan);
  const monthly_fee = window.prompt('Mensalidade', company.monthly_fee);
  if (plan === null || monthly_fee === null) return;
  const res = await superadminApi.updateCompany(id, { ...company, name: name.trim(), plan: plan.trim(), monthly_fee });
  if (!res.ok) return showToast(res.error || 'Não foi possível atualizar a empresa.');
  showToast('Empresa atualizada.'); await loadCompanies(); openCompanyDetail(id);
}
