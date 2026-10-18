import { api } from './api.js';

// Muita rua pequena (loteamento, conjunto residencial) não tem o número da
// casa mapeado no OpenStreetMap — a busca só confirma a rua. Sem isso, ao
// clicar na sugestão o número que a pessoa digitou (ex: "495") seria
// substituído pelo endereço genérico da rua.
function extractHouseNumber(query) {
  const match = query.match(/\b(\d{1,6})\b(?!.*\d)/);
  return match ? match[1] : null;
}

function buildFinalAddress(rawQuery, displayName) {
  const houseNumber = extractHouseNumber(rawQuery);
  if (!houseNumber || displayName.includes(houseNumber)) return displayName;

  const firstComma = displayName.indexOf(',');
  if (firstComma === -1) return `${displayName}, ${houseNumber}`;
  return `${displayName.slice(0, firstComma)}, ${houseNumber}${displayName.slice(firstComma)}`;
}

// Estado global da aplicação no frontend
const state = {
  currentScreen: 'cockpit',
  driver: null,
  vehicles: [],
  rates: null,
  expenses: [],
  metrics: null,
  rides: [],
  selectedFuel: 'Flex',
  pendingRides: [],
  // "Cheguei ao local" é só um toggle de tela — não existe rastreamento de
  // GPS real pra detectar chegada, então o próprio motorista confirma.
  arrivedRideIds: new Set()
};

// Expor funções globais para os handlers inline do HTML
window.navigateTo = navigateTo;
window.handleToggleStatus = handleToggleStatus;
window.switchLoginMethod = switchLoginMethod;
window.togglePasswordVisibility = togglePasswordVisibility;
window.handleLoginSubmit = handleLoginSubmit;
window.openForgotPassword = openForgotPassword;
window.handleForgotRequest = handleForgotRequest;
window.handleForgotResend = handleForgotResend;
window.handleForgotReset = handleForgotReset;
window.handleBiometricLogin = handleBiometricLogin;
window.handleRegisterStep1 = handleRegisterStep1;
window.handleRegisterStep2 = handleRegisterStep2;
window.openExpenseModal = openExpenseModal;
window.closeExpenseModal = closeExpenseModal;
window.handleNewExpenseSubmit = handleNewExpenseSubmit;
window.copyDirectLink = copyDirectLink;
window.shareDirectLinkWhatsApp = shareDirectLinkWhatsApp;
window.handleSaveRates = handleSaveRates;
window.calculateSimulation = calculateSimulation;
window.shareSimulatedQuote = shareSimulatedQuote;
window.activateVehicle = activateVehicle;
window.openRideModal = openRideModal;
window.closeRideModal = closeRideModal;
window.handleNewRideSubmit = handleNewRideSubmit;
window.handleLogout = handleLogout;
window.handleCnhCapture = handleCnhCapture;
window.handleVehiclePhotoCapture = handleVehiclePhotoCapture;
window.handleCrlvCapture = handleCrlvCapture;
window.handleExportData = handleExportData;
window.openDeleteAccountModal = openDeleteAccountModal;
window.closeDeleteAccountModal = closeDeleteAccountModal;
window.handleConfirmDeleteAccount = handleConfirmDeleteAccount;
window.handleAcceptRide = handleAcceptRide;
window.handleRejectRide = handleRejectRide;
window.handleMarkArrived = handleMarkArrived;
window.handleStartRide = handleStartRide;
window.handleCompleteRide = handleCompleteRide;
window.openWazeNavigation = openWazeNavigation;

// Inicialização
document.addEventListener('DOMContentLoaded', async () => {
  setupFuelSelector();
  setupCepLookup();
  initRideAddressAutocomplete();

  const ref = new URLSearchParams(location.search).get('ref');
  if (ref) {
    state.adminRefToken = ref;
    document.getElementById('ref-banner')?.classList.remove('hidden');
    navigateTo('register-step1');
    return;
  }

  // Só entra direto no cockpit se já existir uma sessão válida de verdade
  if (api.getToken()) {
    const ok = await loadInitialData();
    if (ok) {
      const screen = decidePostAuthScreen(state.driver);
      navigateTo(screen);
      if (screen === 'cockpit') startPendingRidesPolling();
      return;
    }
  }

  navigateTo('login');
});

// ============================================================================
// Pedidos de Corrida (Link Direto) — pedido do passageiro aparece aqui pro
// motorista aceitar, navegar até a origem e iniciar a corrida. Sem push
// (fora de escopo por enquanto): só atualiza enquanto o app está aberto,
// via polling a cada 15s.
// ============================================================================
let pendingRidesPollingStarted = false;
let locationWatchId = null;
let trackedRideId = null;

function startRideLocationSharing(rideId) {
  if (!navigator.geolocation || trackedRideId === rideId) return;
  stopRideLocationSharing();
  trackedRideId = rideId;
  locationWatchId = navigator.geolocation.watchPosition(pos => {
    api.updateRideLocation(rideId, pos.coords.latitude, pos.coords.longitude).catch(() => {});
  }, () => showToast('Localização indisponível; a corrida continua normalmente.'), { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
}
function stopRideLocationSharing() { if (locationWatchId !== null) navigator.geolocation.clearWatch(locationWatchId); locationWatchId = null; trackedRideId = null; }

function startPendingRidesPolling() {
  if (pendingRidesPollingStarted) return;
  pendingRidesPollingStarted = true;
  pollPendingRides();
  setInterval(pollPendingRides, 15000);
}

async function pollPendingRides() {
  try {
    const res = await api.getPendingRides();
    if (res.rides) {
      state.pendingRides = res.rides;
      renderPendingRides();
    }
  } catch (err) {
    console.error('Erro ao buscar pedidos de corrida:', err);
  }
}

function renderPendingRides() {
  const card = document.getElementById('pending-rides-card');
  const listEl = document.getElementById('pending-rides-list');
  if (!card || !listEl) return;

  if (state.pendingRides.length === 0) {
    card.classList.add('hidden');
    listEl.innerHTML = '';
    return;
  }
  card.classList.remove('hidden');

  listEl.innerHTML = state.pendingRides.map(r => {
    const hasOriginCoords = r.origin_lat != null && r.origin_lng != null;
    const arrived = state.arrivedRideIds.has(r.id);

    let actions = '';
    if (r.status === 'requested') {
      actions = `
        <button onclick="handleRejectRide(${r.id})" class="flex-1 py-2 rounded-lg border border-surface-border text-slate-400 text-xs font-semibold">Recusar</button>
        <button onclick="handleAcceptRide(${r.id})" class="flex-1 py-2 rounded-lg bg-brand text-black text-xs font-bold">Aceitar</button>
      `;
    } else if (r.status === 'accepted' && !arrived) {
      actions = `
        ${hasOriginCoords ? `<button onclick="openWazeNavigation(${r.origin_lat}, ${r.origin_lng})" class="flex-1 py-2 rounded-lg border border-brand text-brand text-xs font-bold flex items-center justify-center gap-1"><span class="material-symbols-outlined text-sm">near_me</span>Navegar</button>` : ''}
        <button onclick="handleMarkArrived(${r.id})" class="flex-1 py-2 rounded-lg bg-brand text-black text-xs font-bold">Cheguei ao local</button>
      `;
    } else if (r.status === 'accepted' && arrived) {
      actions = `
        <button onclick="handleRejectRide(${r.id})" class="flex-1 py-2 rounded-lg border border-surface-border text-slate-400 text-xs font-semibold">Cancelar</button>
        <button onclick="handleStartRide(${r.id}, ${r.destination_lat ?? 'null'}, ${r.destination_lng ?? 'null'})" class="flex-1 py-2 rounded-lg bg-brand text-black text-xs font-bold">Iniciar Corrida</button>
      `;
    } else if (r.status === 'in_progress') {
      actions = `<button onclick="handleCompleteRide(${r.id})" class="w-full py-2 rounded-lg bg-brand text-black text-xs font-bold">Finalizar Corrida</button>`;
    }

    return `
      <div class="p-3 rounded-xl bg-surface-subtle border border-surface-border space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-white">${r.passenger_name}</span>
          <span class="text-xs font-extrabold text-brand">R$ ${Number(r.fare).toFixed(2).replace('.', ',')}</span>
        </div>
        <div class="text-[10px] text-slate-400 flex flex-col gap-0.5">
          <div class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span><span>${r.origin}</span></div>
          <div class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-brand"></span><span>${r.destination}</span></div>
        </div>
        <div class="flex gap-2 pt-1">${actions}</div>
      </div>
    `;
  }).join('');
}

function openWazeNavigation(lat, lng) {
  window.open(`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, '_blank');
}

async function handleAcceptRide(id) {
  const res = await api.acceptRide(id);
  if (res.success) { startRideLocationSharing(id); showToast('Corrida aceita! Compartilhando localização.'); pollPendingRides(); }
  else showToast(res.error || 'Erro ao aceitar corrida.');
}

async function handleRejectRide(id) {
  const res = await api.cancelRide(id);
  if (res.success) { if (trackedRideId === id) stopRideLocationSharing(); showToast('Pedido recusado.'); state.arrivedRideIds.delete(id); pollPendingRides(); }
  else showToast(res.error || 'Erro ao recusar pedido.');
}

function handleMarkArrived(id) {
  state.arrivedRideIds.add(id);
  renderPendingRides();
}

async function handleStartRide(id, destinationLat, destinationLng) {
  const res = await api.startRide(id);
  if (res.success) {
    showToast('Corrida iniciada!');
    if (destinationLat != null && destinationLng != null) openWazeNavigation(destinationLat, destinationLng);
    pollPendingRides();
  } else {
    showToast(res.error || 'Erro ao iniciar corrida.');
  }
}

async function handleCompleteRide(id) {
  const res = await api.completeRide(id);
  if (res.success) {
    if (trackedRideId === id) stopRideLocationSharing();
    showToast('Corrida finalizada!');
    state.arrivedRideIds.delete(id);
    pollPendingRides();
    loadWeekSummary();
  } else {
    showToast(res.error || 'Erro ao finalizar corrida.');
  }
}

// Navegação entre telas
function navigateTo(screenId) {
  state.currentScreen = screenId;

  // Esconder todas as telas
  document.querySelectorAll('.screen-view').forEach(view => {
    view.classList.add('hidden');
  });

  // Mostrar a tela selecionada
  const targetView = document.getElementById(`view-${screenId}`);
  if (targetView) {
    targetView.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Atualizar botões do seletor superior
  document.querySelectorAll('.screen-tab').forEach(btn => {
    if (btn.dataset.screen === screenId) {
      btn.className = 'screen-tab px-2.5 py-1 rounded-full bg-brand text-black font-semibold shadow transition whitespace-nowrap';
    } else {
      btn.className = 'screen-tab px-2.5 py-1 rounded-full text-slate-400 hover:text-white transition whitespace-nowrap';
    }
  });

  // Atualizar bottom dock navigation
  const bottomNav = document.getElementById('app-bottom-nav');
  const mainScreens = ['cockpit', 'expenses', 'rides', 'profile'];
  
  if (mainScreens.includes(screenId)) {
    bottomNav.classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(btn => {
      if (btn.dataset.nav === screenId) {
        btn.classList.add('text-brand');
        btn.classList.remove('text-slate-400');
      } else {
        btn.classList.remove('text-brand');
        btn.classList.add('text-slate-400');
      }
    });
  } else {
    // Esconder o bottom dock nas telas de auth/registro
    bottomNav.classList.add('hidden');
  }

  // Recarregar dados se entrar nas telas relevantes
  if (screenId === 'expenses') loadExpenses();
  if (screenId === 'rides') loadRidesAndRates();
  if (screenId === 'profile') loadProfile();
  if (screenId === 'pending-approval') updatePendingApprovalUI();
}

// Pra onde ir depois de login/registro/boot: Cockpit só se o cadastro já foi
// aprovado — senão (pending/rejected) cai na tela de status, nunca no resto do app.
function decidePostAuthScreen(driver) {
  if (!driver) return 'login';
  return driver.approval_status === 'approved' ? 'cockpit' : 'pending-approval';
}

function updatePendingApprovalUI() {
  const d = state.driver;
  if (!d) return;
  const isRejected = d.approval_status === 'rejected';

  const titleEl = document.getElementById('pending-title');
  if (titleEl) titleEl.textContent = isRejected ? 'Cadastro não aprovado' : 'Cadastro em análise';

  const messageEl = document.getElementById('pending-message');
  if (messageEl) {
    messageEl.textContent = isRejected
      ? 'Seu cadastro não foi aprovado desta vez.'
      : 'Seu cadastro está em análise. Você será avisado por WhatsApp assim que for aprovado.';
  }

  const reasonBox = document.getElementById('pending-reason-box');
  const reasonText = document.getElementById('pending-reason-text');
  const showReason = isRejected && Boolean(d.rejection_reason);
  if (reasonBox) reasonBox.classList.toggle('hidden', !showReason);
  if (reasonText && showReason) reasonText.textContent = d.rejection_reason;
}

// Carregamento inicial de dados. Retorna false se a sessão não for mais válida.
async function loadInitialData() {
  try {
    const profileData = await api.getProfile();
    if (!profileData.driver) {
      api.setToken(null);
      return false;
    }
    state.driver = profileData.driver;
    state.vehicles = profileData.vehicles;
    state.rates = profileData.rates;
    updateCockpitUI();
    updateProfileUI();
    renderProfileVehicles();
    applyDriverPermissionsUI();
    loadWeekSummary();
    return true;
  } catch (err) {
    console.error('Erro ao carregar dados iniciais:', err);
    return false;
  }
}

// Aplicar as permissões definidas pelo admin na interface do motorista
function applyDriverPermissionsUI() {
  const d = state.driver;
  if (!d) return;

  const canEditRates = d.can_edit_rates !== false;
  document.querySelectorAll('#form-rates input').forEach(i => { i.disabled = !canEditRates; });
  const ratesSubmitBtn = document.querySelector('#form-rates button[type="submit"]');
  if (ratesSubmitBtn) ratesSubmitBtn.disabled = !canEditRates;
  document.getElementById('rates-locked-msg')?.classList.toggle('hidden', canEditRates);

  const canShareLink = d.can_share_direct_link !== false;
  document.getElementById('direct-link-card')?.classList.toggle('hidden', !canShareLink);
  document.getElementById('direct-link-locked-msg')?.classList.toggle('hidden', canShareLink);

  const linkEl = document.getElementById('direct-link-url');
  if (linkEl && d.public_slug) {
    linkEl.textContent = `${location.origin}/p/${d.public_slug}`;
  }
}

// Iniciais do nome pro avatar — não existe upload de foto de perfil, então
// usar um stranger de banco de imagem (como era antes) mostrava a mesma foto
// fake pra todo motorista novo.
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '?';
}

// Atualizar interface do Cockpit Pro
function updateCockpitUI() {
  if (!state.driver) return;
  const d = state.driver;

  const driverNameEl = document.getElementById('cockpit-driver-name');
  if (driverNameEl) driverNameEl.textContent = d.name;

  const avatarEl = document.getElementById('cockpit-avatar-initials');
  if (avatarEl) avatarEl.textContent = getInitials(d.name);

  const categoryEl = document.getElementById('cockpit-category-badge');
  if (categoryEl) categoryEl.textContent = d.category || 'Novato';

  const earningsEl = document.getElementById('cockpit-earnings');
  if (earningsEl) earningsEl.textContent = `R$ ${Number(d.today_earnings || 0).toFixed(2).replace('.', ',')}`;

  const ridesEl = document.getElementById('cockpit-rides');
  if (ridesEl) ridesEl.textContent = d.today_rides || 0;

  const hoursEl = document.getElementById('cockpit-hours');
  if (hoursEl) hoursEl.textContent = d.today_hours || '0h 00m';

  const kmEl = document.getElementById('cockpit-km');
  if (kmEl) kmEl.textContent = `${d.km_driven || 0} km`;

  const fuelEl = document.getElementById('cockpit-fuel-efficiency');
  if (fuelEl) fuelEl.textContent = d.fuel_efficiency ? `${d.fuel_efficiency} km/L` : '—';

  // Veículo ativo
  const activeVeh = state.vehicles.find(v => v.is_active) || state.vehicles[0];
  const vehInfoEl = document.getElementById('cockpit-vehicle-info');
  if (vehInfoEl && activeVeh) {
    vehInfoEl.textContent = `${activeVeh.model} • ${activeVeh.plate}`;
  }

  // Status Online / Offline
  applyStatusVisuals(d.status === 'online');
}

// Atualizar a tela de Perfil com os dados reais do motorista (antes ficava
// com nota/categoria/data de cadastro fixas no HTML, iguais pra qualquer
// motorista novo).
function updateProfileUI() {
  if (!state.driver) return;
  const d = state.driver;

  const nameEl = document.getElementById('profile-driver-name');
  if (nameEl) nameEl.textContent = d.name;

  const avatarEl = document.getElementById('profile-avatar-initials');
  if (avatarEl) avatarEl.textContent = getInitials(d.name);

  const categoryEl = document.getElementById('profile-category-badge');
  if (categoryEl) categoryEl.textContent = d.category || 'Novato';

  const memberSinceEl = document.getElementById('profile-member-since');
  if (memberSinceEl && d.created_at) {
    const date = new Date(d.created_at);
    const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    memberSinceEl.textContent = `Membro desde ${label.charAt(0).toUpperCase()}${label.slice(1)}`;
  }

  const ratingEl = document.getElementById('profile-rating');
  if (ratingEl) ratingEl.textContent = d.rating ? `${Number(d.rating).toFixed(2)} ★` : 'Novo';

  const acceptanceEl = document.getElementById('profile-acceptance');
  if (acceptanceEl) acceptanceEl.textContent = `${d.acceptance_rate || 0}%`;

  const cancellationEl = document.getElementById('profile-cancellation');
  if (cancellationEl) cancellationEl.textContent = `${d.cancellation_rate || 0}%`;

  const pixKeyEl = document.getElementById('profile-pix-key');
  if (pixKeyEl) pixKeyEl.textContent = state.rates?.pix_key || 'Nenhuma chave cadastrada';
}

// Visual do status Online / Offline
function applyStatusVisuals(isOnline) {
  const btn = document.getElementById('btn-toggle-online');
  const lbl = document.getElementById('lbl-toggle-status');
  const dot = document.getElementById('cockpit-avatar-dot');
  const profileSwitch = document.getElementById('profile-availability');

  if (isOnline) {
    if (btn) btn.className = 'px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 bg-brand text-black shadow-lg shadow-brand/25 transition active:scale-95';
    if (lbl) lbl.textContent = 'ONLINE';
    if (dot) {
      dot.className = 'absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-brand rounded-full border-2 border-surface-card pulse-online';
    }
    if (profileSwitch) profileSwitch.checked = true;
  } else {
    if (btn) btn.className = 'px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 bg-slate-800 text-slate-400 border border-slate-700 transition active:scale-95';
    if (lbl) lbl.textContent = 'OFFLINE';
    if (dot) {
      dot.className = 'absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-slate-500 rounded-full border-2 border-surface-card';
    }
    if (profileSwitch) profileSwitch.checked = false;
  }
}

// Alternar status
async function handleToggleStatus() {
  try {
    const res = await api.toggleStatus();
    if (res.success) {
      state.driver.status = res.status;
      applyStatusVisuals(res.status === 'online');
      showToast(res.status === 'online' ? 'Você está ONLINE para corridas!' : 'Você agora está OFFLINE.');
    }
  } catch (err) {
    showToast('Erro ao alternar status.');
  }
}

// Métodos de Login
function switchLoginMethod(method) {
  const btnEmail = document.getElementById('login-tab-email');
  const btnSms = document.getElementById('login-tab-sms');
  const fieldPwd = document.getElementById('login-field-password');
  const inputId = document.getElementById('login-input-id');

  if (method === 'email') {
    btnEmail.className = 'flex-1 py-2 text-xs font-semibold rounded-lg bg-brand text-black shadow transition';
    btnSms.className = 'flex-1 py-2 text-xs font-medium text-slate-400 hover:text-white transition';
    fieldPwd.classList.remove('hidden');
    inputId.placeholder = 'seu.email@exemplo.com ou CPF';
  } else {
    btnSms.className = 'flex-1 py-2 text-xs font-semibold rounded-lg bg-brand text-black shadow transition';
    btnEmail.className = 'flex-1 py-2 text-xs font-medium text-slate-400 hover:text-white transition';
    fieldPwd.classList.add('hidden');
    inputId.placeholder = 'Digite seu número com DDD (ex: 11 98765-4321)';
  }
}

function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const identifier = document.getElementById('login-input-id').value;
  const password = document.getElementById('login-input-pwd')?.value || '';

  showToast('Autenticando...');
  try {
    const res = await api.login(identifier, password);
    if (res.success) {
      showToast(`Bem-vindo, ${res.driver.name}!`);
      await loadInitialData();
      const screen = decidePostAuthScreen(state.driver);
      navigateTo(screen);
      if (screen === 'cockpit') startPendingRidesPolling();
    } else {
      showToast(res.error || 'Credenciais inválidas.');
    }
  } catch (err) {
    showToast('Erro ao autenticar. Tente novamente.');
  }
}

// ---------------------------------------------------------------------------
// Recuperação de senha (código por WhatsApp)
// ---------------------------------------------------------------------------
// Guarda o identificador entre as duas etapas; o código nunca é guardado aqui.
let forgotIdentifier = '';

function showForgotStep(step) {
  document.getElementById('form-forgot-request').classList.toggle('hidden', step !== 1);
  document.getElementById('form-forgot-reset').classList.toggle('hidden', step !== 2);
  document.getElementById('forgot-subtitle').textContent = step === 1
    ? 'Informe seu e-mail, CPF ou telefone. Vamos enviar um código de 6 dígitos para o seu WhatsApp.'
    : 'Digite o código que chegou no seu WhatsApp e escolha a nova senha.';
}

function openForgotPassword() {
  // Reaproveita o que a pessoa já digitou no login.
  document.getElementById('forgot-input-id').value = document.getElementById('login-input-id').value.trim();
  document.getElementById('form-forgot-reset').reset();
  showForgotStep(1);
  navigateTo('forgot-password');
}

async function requestResetCode(identifier) {
  const res = await api.forgotPassword(identifier);
  if (res.success) {
    forgotIdentifier = identifier;
    showToast('Se a conta existir, o código foi enviado por WhatsApp.');
    showForgotStep(2);
    document.getElementById('forgot-input-code').focus();
  } else {
    showToast(res.error || 'Não foi possível enviar o código.');
  }
  return res;
}

async function handleForgotRequest(event) {
  event.preventDefault();
  const btn = document.getElementById('forgot-request-btn');
  btn.disabled = true;
  try {
    await requestResetCode(document.getElementById('forgot-input-id').value.trim());
  } finally {
    btn.disabled = false;
  }
}

async function handleForgotResend() {
  const btn = document.getElementById('forgot-resend-btn');
  btn.disabled = true;
  await requestResetCode(forgotIdentifier);
  // O servidor segura reenvios por 60s; o botão fica travado o mesmo tempo
  // pra a pessoa não achar que clicou e nada aconteceu.
  setTimeout(() => { btn.disabled = false; }, 60000);
}

async function handleForgotReset(event) {
  event.preventDefault();
  const code = document.getElementById('forgot-input-code').value.trim();
  const pwd = document.getElementById('forgot-input-pwd').value;
  const pwd2 = document.getElementById('forgot-input-pwd2').value;

  if (pwd !== pwd2) return showToast('As senhas não conferem.');

  const res = await api.resetPassword(forgotIdentifier, code, pwd);
  if (res.success) {
    showToast(res.message || 'Senha redefinida!');
    document.getElementById('login-input-id').value = forgotIdentifier;
    document.getElementById('login-input-pwd').value = '';
    navigateTo('login');
  } else {
    showToast(res.error || 'Não foi possível redefinir a senha.');
  }
}

function handleBiometricLogin() {
  showToast('Biometria reconhecida com sucesso!');
  setTimeout(() => navigateTo('cockpit'), 500);
}

// Busca automática de endereço via CEP (ViaCEP)
function setupCepLookup() {
  const cepInput = document.getElementById('reg-cep');
  if (!cepInput) return;

  cepInput.addEventListener('input', () => {
    let digits = cepInput.value.replace(/\D/g, '').slice(0, 8);
    cepInput.value = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
  });

  cepInput.addEventListener('blur', async () => {
    const digits = cepInput.value.replace(/\D/g, '');
    const statusEl = document.getElementById('cep-status');
    const errorEl = document.getElementById('cep-error');
    errorEl.classList.add('hidden');

    if (digits.length !== 8) return;

    statusEl.textContent = 'Buscando...';
    statusEl.classList.remove('hidden');

    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();

      if (data.erro) {
        errorEl.classList.remove('hidden');
      } else {
        document.getElementById('reg-street').value = data.logradouro || '';
        document.getElementById('reg-neighborhood').value = data.bairro || '';
        document.getElementById('reg-city').value = data.localidade || '';
        document.getElementById('reg-state').value = data.uf || '';
        document.getElementById('reg-number').focus();
      }
    } catch (err) {
      errorEl.classList.remove('hidden');
    } finally {
      statusEl.classList.add('hidden');
    }
  });
}

// Redimensiona/comprime uma foto antes de guardar — uma foto de celular direto
// da câmera pode ter vários MB, e isso viajaria inteiro em toda consulta de
// perfil depois. 900px de largura é de sobra pra leitura de documentos.
function resizeImageFile(file, maxWidth = 900, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Captura de foto da CNH (câmera no celular, ou seletor de arquivo no desktop)
async function handleCnhCapture(event, side) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const dataUrl = await resizeImageFile(file);
  state[side === 'front' ? 'cnhFrontData' : 'cnhBackData'] = dataUrl;

  const preview = document.getElementById(`cnh-${side}-preview`);
  preview.src = dataUrl;
  preview.classList.remove('hidden');
  document.getElementById(`cnh-${side}-placeholder`).classList.add('hidden');
  const badge = document.getElementById(`cnh-${side}-badge`);
  badge.classList.remove('hidden');
  badge.classList.add('flex');

  showToast('Foto capturada com sucesso!');
}

// Captura de foto do veículo
async function handleVehiclePhotoCapture(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const dataUrl = await resizeImageFile(file);
  state.vehiclePhotoData = dataUrl;

  const preview = document.getElementById('vehicle-photo-preview');
  preview.src = dataUrl;
  preview.classList.remove('hidden');
  document.getElementById('vehicle-photo-placeholder').classList.add('hidden');
  const badge = document.getElementById('vehicle-photo-badge');
  badge.classList.remove('hidden');
  badge.classList.add('flex');

  showToast('Foto do veículo anexada!');
}

// Anexar o CRLV (foto ou PDF)
async function handleCrlvCapture(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (file.type.startsWith('image/')) {
    state.crlvData = await resizeImageFile(file);
  } else {
    state.crlvData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  document.getElementById('crlv-status-text').textContent = file.name;
  const badge = document.getElementById('crlv-badge');
  badge.classList.remove('hidden');
  badge.classList.add('flex');

  showToast('CRLV anexado com sucesso!');
}

// Exibir erro fixo destacado no formulário de cadastro
function showRegisterError(element, message) {
  if (element) {
    element.innerHTML = `
      <span class="material-symbols-outlined text-base text-red-400 shrink-0">error</span>
      <span class="leading-tight">${message}</span>
    `;
    element.classList.remove('hidden');
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// Cadastro Passo 1
async function handleRegisterStep1(event) {
  event.preventDefault();
  const errorEl = document.getElementById('register-step1-error');
  if (errorEl) errorEl.classList.add('hidden');

  const termsAccepted = document.getElementById('reg-terms-accept').checked;
  if (!termsAccepted) {
    const msg = 'É necessário aceitar os Termos de Uso e a Política de Privacidade para prosseguir.';
    showRegisterError(errorEl, msg);
    showToast(msg);
    return;
  }

  const name = document.getElementById('reg-name').value.trim();
  const cpf = document.getElementById('reg-cpf').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-pwd').value;

  if (!name || !cpf || !phone || !email || !password) {
    const msg = 'Por favor, preencha todos os campos obrigatórios.';
    showRegisterError(errorEl, msg);
    showToast(msg);
    return;
  }

  const street = document.getElementById('reg-street').value.trim();
  const number = document.getElementById('reg-number').value.trim();
  const neighborhood = document.getElementById('reg-neighborhood').value.trim();
  const city = document.getElementById('reg-city').value.trim();
  const stateUf = document.getElementById('reg-state').value.trim();
  const cep = document.getElementById('reg-cep').value.trim();

  const address = street ? `${street}, ${number} - ${neighborhood}, ${city} - ${stateUf}, ${cep}` : '';

  showToast('Dados salvos! Avançando para o veículo...');
  state.pendingRegistration = {
    name, cpf, phone, email, password, address,
    cnh_front: state.cnhFrontData || '',
    cnh_back: state.cnhBackData || '',
    admin_ref: state.adminRefToken || null,
    terms_accepted: true
  };
  navigateTo('register-step2');
}

// Seletor de combustível
function setupFuelSelector() {
  document.querySelectorAll('.fuel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.fuel-btn').forEach(b => {
        b.className = 'fuel-btn py-2 text-xs font-medium rounded-lg bg-surface-card text-slate-300 border border-surface-border';
      });
      btn.className = 'fuel-btn py-2 text-xs font-semibold rounded-lg bg-brand text-black border border-brand';
      state.selectedFuel = btn.dataset.fuel;
    });
  });
}

// Cadastro Passo 2
async function handleRegisterStep2(event) {
  event.preventDefault();
  const errorEl = document.getElementById('register-step2-error');
  const submitBtn = document.getElementById('btn-submit-step2');
  if (errorEl) errorEl.classList.add('hidden');

  const plate = document.getElementById('reg-veh-plate').value.trim().toUpperCase();
  const model = document.getElementById('reg-veh-model').value.trim();
  const year = document.getElementById('reg-veh-year').value.trim();
  const color = document.getElementById('reg-veh-color').value.trim();

  if (!plate || !model) {
    const msg = 'Por favor, informe a placa e o modelo do veículo.';
    showRegisterError(errorEl, msg);
    showToast(msg);
    return;
  }

  // Estado de carregamento no botão
  const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <span class="inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></span>
      <span>Concluindo cadastro...</span>
    `;
  }

  try {
    // Se havia registro de motorista pendente
    if (state.pendingRegistration) {
      const regRes = await api.registerDriver(state.pendingRegistration);
      if (!regRes.success) {
        const errorMsg = regRes.error || 'Erro ao cadastrar motorista.';
        showRegisterError(errorEl, errorMsg);
        showToast(errorMsg);
        return;
      }
      state.driver = regRes.driver;
      state.pendingRegistration = null;
    }

    // Cadastrar veículo (usa a sessão autenticada do motorista recém-criado)
    const vehRes = await api.registerVehicle({
      plate,
      model,
      year: year ? parseInt(year, 10) : 2024,
      color: color || 'Prata',
      fuel_type: state.selectedFuel || 'Flex',
      photo_url: state.vehiclePhotoData || '',
      crlv_url: state.crlvData || ''
    });

    if (vehRes && (vehRes.success || vehRes.vehicle)) {
      showToast('Cadastro concluído com sucesso!');
      await loadInitialData();
      const screen = decidePostAuthScreen(state.driver);
      navigateTo(screen);
      if (screen === 'cockpit') startPendingRidesPolling();
    } else {
      const errorMsg = (vehRes && vehRes.error) ? vehRes.error : 'Erro ao cadastrar veículo.';
      showRegisterError(errorEl, errorMsg);
      showToast(errorMsg);
    }
  } catch (err) {
    console.error('Erro detalhado no cadastro:', err);
    const errorMsg = err.message || 'Erro inesperado ao concluir o cadastro. Verifique a conexão com o servidor.';
    showRegisterError(errorEl, errorMsg);
    showToast(errorMsg);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }
  }
}

// Carregar e Exibir Custos
async function loadExpenses() {
  try {
    const data = await api.getExpenses();
    state.expenses = data.expenses;
    state.metrics = data.metrics;

    document.getElementById('costs-total').textContent = `R$ ${data.metrics.totalCosts.toFixed(2).replace('.', ',')}`;
    document.getElementById('costs-gross').textContent = `R$ ${data.metrics.grossRevenue.toFixed(2).replace('.', ',')}`;
    document.getElementById('costs-net').textContent = `R$ ${data.metrics.netProfit.toFixed(2).replace('.', ',')}`;
    document.getElementById('costs-fuel-pct').textContent = `${data.metrics.fuelPercentage}%`;

    const listEl = document.getElementById('expenses-list');
    listEl.innerHTML = '';

    const categoryIcons = {
      combustivel: 'local_gas_station',
      pedagio: 'toll',
      lavagem: 'local_car_wash',
      manutencao: 'build',
      alimentacao: 'restaurant'
    };

    data.expenses.forEach(exp => {
      const item = document.createElement('div');
      item.className = 'flex items-center justify-between p-3 rounded-xl bg-surface-subtle border border-surface-border';
      const icon = categoryIcons[exp.category] || 'receipt_long';
      
      item.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center text-brand">
            <span class="material-symbols-outlined text-lg">${icon}</span>
          </div>
          <div>
            <p class="text-xs font-bold text-white">${exp.title}</p>
            <p class="text-[10px] text-slate-400">${exp.date_time} ${exp.notes ? '• ' + exp.notes : ''}</p>
          </div>
        </div>
        <span class="text-xs font-bold text-red-400">- R$ ${exp.amount.toFixed(2).replace('.', ',')}</span>
      `;
      listEl.appendChild(item);
    });
  } catch (err) {
    console.error('Erro ao buscar despesas:', err);
  }
}

function openExpenseModal() {
  const modal = document.getElementById('modal-expense');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeExpenseModal() {
  const modal = document.getElementById('modal-expense');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function handleNewExpenseSubmit(event) {
  event.preventDefault();
  const category = document.getElementById('expense-cat').value;
  const title = document.getElementById('expense-title').value;
  const amount = document.getElementById('expense-amount').value;
  const notes = document.getElementById('expense-notes').value;

  try {
    const res = await api.addExpense({ category, title, amount, notes });
    if (res.success) {
      showToast('Despesa lançada com sucesso!');
      closeExpenseModal();
      document.getElementById('form-new-expense').reset();
      loadExpenses();
    }
  } catch (err) {
    showToast('Erro ao salvar despesa.');
  }
}

// Carregar Corridas e Tarifas
async function loadRidesAndRates() {
  try {
    // Recarrega o perfil pra pegar permissões atualizadas pelo admin
    const profileData = await api.getProfile();
    state.driver = profileData.driver;

    const data = await api.getRidesAndRates();
    state.rates = data.rates;
    state.rides = data.rides;

    if (data.rates) {
      document.getElementById('rate-km').value = data.rates.km_rate;
      document.getElementById('rate-minute').value = data.rates.minute_rate;
      document.getElementById('rate-base').value = data.rates.base_fare;
      document.getElementById('rate-min').value = data.rates.min_fare;
    }

    applyDriverPermissionsUI();
    calculateSimulation();

    // Renderizar corridas
    const listEl = document.getElementById('rides-list');
    listEl.innerHTML = '';

    data.rides.forEach(r => {
      const item = document.createElement('div');
      item.className = 'p-3 rounded-xl bg-surface-subtle border border-surface-border space-y-1.5';
      const isWhatsApp = r.passenger_phone || r.notes;

      item.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <span class="text-[9px] font-bold px-2 py-0.5 rounded-full ${isWhatsApp ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-brand/10 text-brand border border-brand/30'}">
              ${isWhatsApp ? 'Particular WhatsApp' : 'App korenDriver'}
            </span>
            <span class="text-xs font-bold text-white">${r.passenger_name}</span>
          </div>
          <span class="text-xs font-extrabold text-brand">R$ ${r.fare.toFixed(2).replace('.', ',')}</span>
        </div>
        <div class="text-[10px] text-slate-400 flex flex-col gap-0.5">
          <div class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
            <span>${r.origin}</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-brand"></span>
            <span>${r.destination}</span>
          </div>
        </div>
      `;
      listEl.appendChild(item);
    });
  } catch (err) {
    console.error('Erro ao buscar corridas:', err);
  }
}

// Salvar Tarifas
async function handleSaveRates(event) {
  event.preventDefault();
  const km_rate = document.getElementById('rate-km').value;
  const minute_rate = document.getElementById('rate-minute').value;
  const base_fare = document.getElementById('rate-base').value;
  const min_fare = document.getElementById('rate-min').value;

  try {
    const res = await api.updateRates({ km_rate, minute_rate, base_fare, min_fare });
    if (res.success) {
      state.rates = res.rates;
      showToast('Tarifas atualizadas com sucesso!');
      calculateSimulation();
    } else if (res.error) {
      showToast(res.error);
    }
  } catch (err) {
    showToast('Erro ao salvar tarifas.');
  }
}

// Calcular estimativa no simulador
function calculateSimulation() {
  const km = parseFloat(document.getElementById('sim-km')?.value) || 0;
  const min = parseInt(document.getElementById('sim-min')?.value) || 0;

  const base = parseFloat(document.getElementById('rate-base')?.value) || 6.50;
  const perKm = parseFloat(document.getElementById('rate-km')?.value) || 2.75;
  const perMin = parseFloat(document.getElementById('rate-minute')?.value) || 0.45;
  const minFare = parseFloat(document.getElementById('rate-min')?.value) || 15.00;

  let total = base + (km * perKm) + (min * perMin);
  if (total < minFare) total = minFare;

  const resultEl = document.getElementById('sim-result');
  if (resultEl) {
    resultEl.textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
  }
}

// Copiar Link Direto
function copyDirectLink() {
  const url = document.getElementById('direct-link-url').textContent;
  navigator.clipboard.writeText(url);
  const label = document.getElementById('btn-copy-label');
  label.textContent = 'Copiado!';
  showToast('Link particular copiado para a área de transferência!');
  setTimeout(() => { label.textContent = 'Copiar'; }, 2000);
}

// Compartilhar WhatsApp
function shareDirectLinkWhatsApp() {
  const url = document.getElementById('direct-link-url').textContent;
  const text = encodeURIComponent(`Olá! Agende sua viagem particular diretamente comigo com segurança e conforto: ${url}`);
  window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
}

// Enviar proposta de corrida simulada
function shareSimulatedQuote() {
  const km = document.getElementById('sim-km').value;
  const min = document.getElementById('sim-min').value;
  const val = document.getElementById('sim-result').textContent;
  const text = encodeURIComponent(`Olá! Seu orçamento para a corrida (${km} km / aprox. ${min} min) ficou em ${val}. Podemos agendar?`);
  window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
}

// Carregar e Exibir Perfil
async function loadProfile() {
  try {
    const data = await api.getProfile();
    state.vehicles = data.vehicles;
    renderProfileVehicles();
  } catch (err) {
    console.error('Erro ao carregar perfil:', err);
  }
}

function renderProfileVehicles() {
  const listEl = document.getElementById('profile-vehicles-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  state.vehicles.forEach(v => {
    const card = document.createElement('div');
    card.className = `p-3 rounded-xl border transition ${v.is_active ? 'bg-surface-subtle border-brand/40 shadow-sm shadow-brand/10' : 'bg-surface-card border-surface-border'}`;
    
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg ${v.is_active ? 'bg-brand/20 text-brand' : 'bg-slate-800 text-slate-400'} flex items-center justify-center">
            <span class="material-symbols-outlined text-base">directions_car</span>
          </div>
          <div>
            <p class="text-xs font-bold text-white">${v.model}</p>
            <p class="text-[10px] text-slate-400">${v.plate} • ${v.year} • ${v.fuel_type}</p>
          </div>
        </div>
        ${v.is_active 
          ? '<span class="text-[9px] text-brand bg-brand/10 border border-brand/30 px-2 py-0.5 rounded-full font-bold">ATIVO</span>' 
          : `<button onclick="activateVehicle(${v.id})" class="text-[10px] text-slate-300 hover:text-white bg-slate-800 border border-slate-700 px-2 py-1 rounded-lg">Ativar</button>`}
      </div>
    `;
    listEl.appendChild(card);
  });
}

async function activateVehicle(id) {
  try {
    const res = await api.activateVehicle(id);
    if (res.success) {
      showToast('Veículo principal ativado!');
      await loadProfile();
      updateCockpitUI();
    }
  } catch (err) {
    showToast('Erro ao ativar veículo.');
  }
}

// Carregar resumo real de corridas da semana (Cockpit)
async function loadWeekSummary() {
  try {
    const summary = await api.getWeekSummary();
    const countEl = document.getElementById('week-rides-count');
    const totalEl = document.getElementById('week-rides-total');
    if (countEl) countEl.textContent = summary.count;
    if (totalEl) totalEl.textContent = `R$ ${Number(summary.total).toFixed(2).replace('.', ',')}`;
  } catch (err) {
    console.error('Erro ao carregar resumo da semana:', err);
  }
}

// Modal de Registrar Corrida
function openRideModal() {
  const modal = document.getElementById('modal-ride');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

// Busca de endereço (OpenStreetMap/Nominatim, gratuito, sem chave de API —
// mesmo padrão já usado na busca de CEP) nos campos Origem/Destino do
// Registrar Corrida.
function setupAddressAutocomplete(inputId, suggestionsId) {
  const input = document.getElementById(inputId);
  const box = document.getElementById(suggestionsId);
  if (!input || !box) return;

  let debounceTimer = null;
  let currentController = null;

  function hideSuggestions() {
    box.classList.add('hidden');
    box.innerHTML = '';
  }

  function showMessage(text, isError) {
    box.innerHTML = `<p class="px-3 py-2 text-xs ${isError ? 'text-red-400' : 'text-slate-400'}">${text}</p>`;
    box.classList.remove('hidden');
  }

  async function search(query) {
    if (currentController) currentController.abort();
    currentController = new AbortController();

    // Feedback imediato — sem isso, entre digitar e a lista aparecer (ou dar
    // erro) a tela ficava muda, parecendo travada mesmo quando só é a espera
    // do debounce/rede.
    showMessage('Buscando endereço...', false);

    try {
      // viewbox+bounded restringe a busca ao Ceará (koren opera nessa região) —
      // sem isso o Nominatim trazia sugestão de qualquer lugar do Brasil.
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=0&limit=5&countrycodes=br&viewbox=-41.42,-2.78,-37.25,-7.86&bounded=1&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { signal: currentController.signal });

      if (!res.ok) {
        showMessage('Erro ao buscar endereço — tenta de novo em alguns segundos.', true);
        return;
      }

      const results = await res.json();

      if (!results.length) {
        showMessage('Nenhum endereço encontrado. Tenta simplificar (ex: só o nome da rua e bairro).', false);
        return;
      }

      box.innerHTML = results.map((r, i) => `
        <button type="button" data-idx="${i}" class="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-surface-subtle border-b border-surface-border last:border-b-0 flex items-start gap-2">
          <span class="material-symbols-outlined text-brand text-sm mt-0.5 shrink-0">location_on</span>
          <span class="truncate">${r.display_name}</span>
        </button>
      `).join('');

      box.querySelectorAll('button[data-idx]').forEach(btn => {
        btn.onclick = () => {
          input.value = buildFinalAddress(query, results[Number(btn.dataset.idx)].display_name);
          hideSuggestions();
        };
      });

      box.classList.remove('hidden');
    } catch (err) {
      if (err.name === 'AbortError') return; // superada por uma busca mais nova, nada a mostrar
      console.error('Erro na busca de endereço:', err);
      showMessage('Erro ao buscar endereço — tenta de novo em alguns segundos.', true);
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (query.length < 3) {
      hideSuggestions();
      return;
    }
    debounceTimer = setTimeout(() => search(query), 450);
  });

  input.addEventListener('blur', () => {
    // Delay pra permitir que o clique na sugestão registre antes do blur esconder a lista
    setTimeout(hideSuggestions, 150);
  });
}

function initRideAddressAutocomplete() {
  setupAddressAutocomplete('ride-origin', 'ride-origin-suggestions');
  setupAddressAutocomplete('ride-destination', 'ride-destination-suggestions');
}

function closeRideModal() {
  const modal = document.getElementById('modal-ride');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function handleNewRideSubmit(event) {
  event.preventDefault();
  const passenger_name = document.getElementById('ride-passenger-name').value;
  const passenger_phone = document.getElementById('ride-passenger-phone').value;
  const origin = document.getElementById('ride-origin').value;
  const destination = document.getElementById('ride-destination').value;
  const distance_km = document.getElementById('ride-distance').value;
  const duration_min = document.getElementById('ride-duration').value;
  const fare = document.getElementById('ride-fare').value;
  const notes = document.getElementById('ride-notes').value;

  try {
    const res = await api.addRide({
      passenger_name, passenger_phone, origin, destination, distance_km, duration_min, fare, notes
    });

    if (res.success) {
      showToast('Corrida registrada com sucesso!');
      closeRideModal();
      document.getElementById('form-new-ride').reset();
      loadWeekSummary();
      if (state.currentScreen === 'rides') loadRidesAndRates();
    } else if (res.error) {
      showToast(res.error);
    }
  } catch (err) {
    showToast('Erro ao registrar corrida.');
  }
}

// Logout
async function handleLogout() {
  await api.logout();
  state.driver = null;
  showToast('Você saiu da conta.');
  setTimeout(() => navigateTo('login'), 400);
}

// Direito de acesso (LGPD): baixar uma cópia de todos os próprios dados
async function handleExportData() {
  showToast('Preparando seus dados...');
  const res = await api.exportData();
  if (res.success) {
    showToast('Seus dados foram baixados!');
  } else {
    showToast(res.error || 'Erro ao baixar seus dados.');
  }
}

// Direito de exclusão (LGPD)
function openDeleteAccountModal() {
  document.getElementById('delete-account-confirm-input').value = '';
  const modal = document.getElementById('modal-delete-account');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeDeleteAccountModal() {
  const modal = document.getElementById('modal-delete-account');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function handleConfirmDeleteAccount() {
  const confirmText = document.getElementById('delete-account-confirm-input').value.trim().toUpperCase();
  if (confirmText !== 'EXCLUIR') {
    showToast('Digite EXCLUIR pra confirmar.');
    return;
  }

  try {
    const res = await api.deleteAccount();
    if (res.success) {
      closeDeleteAccountModal();
      api.setToken(null);
      state.driver = null;
      showToast('Sua conta foi excluída.');
      setTimeout(() => navigateTo('login'), 600);
    } else {
      showToast(res.error || 'Erro ao excluir sua conta.');
    }
  } catch (err) {
    showToast('Erro ao excluir sua conta.');
  }
}

// Toast de feedback
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
