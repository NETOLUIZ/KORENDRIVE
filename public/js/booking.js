const state = {
  slug: null,
  driver: null,
  vehicle: null,
  rates: null,
  serviceType: 'corrida',
  stopCount: 0
};

const serviceLabels = {
  corrida: 'Corrida',
  frete: 'Frete',
  entrega: 'Entrega'
};

const serviceNotesPlaceholder = {
  corrida: 'Ex: Levar bagagem, ponto de referência...',
  frete: 'Ex: Descreva o item, peso e tamanho aproximado',
  entrega: 'Ex: Descreva o pacote e instruções de entrega'
};

window.selectServiceType = selectServiceType;
window.updateEstimate = updateEstimate;
window.handleBookingSubmit = handleBookingSubmit;
window.addStop = addStop;
window.removeStop = removeStop;

function addStop() {
  state.stopCount += 1;
  const id = state.stopCount;

  const wrapper = document.createElement('div');
  wrapper.id = `stop-row-${id}`;
  wrapper.className = 'flex items-end gap-2';
  wrapper.innerHTML = `
    <div class="flex-1">
      <label class="block text-xs font-medium text-slate-300 mb-1">Parada</label>
      <input id="stop-input-${id}" type="text" placeholder="Ex: Rua Major Facundo, 200 - Centro, Fortaleza - CE" class="w-full bg-surface-subtle border border-surface-border focus:border-brand rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none">
    </div>
    <button type="button" onclick="removeStop(${id})" class="w-10 h-10 shrink-0 rounded-xl bg-surface-subtle border border-surface-border text-slate-400 hover:text-red-400 hover:border-red-500/40 flex items-center justify-center">
      <span class="material-symbols-outlined text-lg">close</span>
    </button>
  `;
  document.getElementById('booking-stops-list').appendChild(wrapper);
}

function removeStop(id) {
  document.getElementById(`stop-row-${id}`)?.remove();
}

function getStops() {
  return Array.from(document.querySelectorAll('#booking-stops-list input'))
    .map(input => input.value.trim())
    .filter(Boolean);
}

document.addEventListener('DOMContentLoaded', async () => {
  const parts = location.pathname.split('/p/');
  state.slug = parts[1] ? decodeURIComponent(parts[1]) : null;

  if (!state.slug) {
    showError();
    return;
  }

  try {
    const res = await fetch(`/api/public/driver/${encodeURIComponent(state.slug)}`);
    if (!res.ok) {
      showError();
      return;
    }
    const data = await res.json();
    state.driver = data.driver;
    state.vehicle = data.vehicle;
    state.rates = data.rates;
    renderDriver();
    selectServiceType('corrida');
    updateEstimate();
    showForm();
  } catch (err) {
    showError();
  }
});

function showError() {
  document.getElementById('view-loading').classList.add('hidden');
  document.getElementById('view-error').classList.remove('hidden');
  document.getElementById('view-error').classList.add('flex');
}

function showForm() {
  document.getElementById('view-loading').classList.add('hidden');
  document.getElementById('view-form').classList.remove('hidden');
}

function renderDriver() {
  document.getElementById('driver-name').textContent = state.driver.name;
  document.getElementById('driver-rating').textContent = state.driver.rating ? Number(state.driver.rating).toFixed(2) : 'Novo';
  document.getElementById('driver-category').textContent = state.driver.category || 'Novato';

  const vehicleEl = document.getElementById('driver-vehicle');
  vehicleEl.textContent = state.vehicle
    ? `${state.vehicle.model} • ${state.vehicle.color}`
    : 'Motorista Parceiro korenDriver';
}

function selectServiceType(type) {
  state.serviceType = type;
  document.querySelectorAll('.service-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.service === type);
  });
  document.getElementById('booking-notes-label').textContent =
    type === 'corrida' ? 'Observação (opcional)' : `Descrição do ${serviceLabels[type].toLowerCase()} (opcional)`;
  document.getElementById('booking-notes').placeholder = serviceNotesPlaceholder[type];
}

function updateEstimate() {
  if (!state.rates) return;
  const km = parseFloat(document.getElementById('booking-distance').value) || 0;
  const min = parseFloat(document.getElementById('booking-duration').value) || 0;

  let total = state.rates.base_fare + (km * state.rates.km_rate) + (min * state.rates.minute_rate);
  if (total < state.rates.min_fare) total = state.rates.min_fare;

  document.getElementById('booking-estimate').textContent = `R$ ${total.toFixed(2).replace('.', ',')}`;
}

function normalizePhone(phone) {
  let digits = (phone || '').replace(/\D/g, '');
  if (digits.length <= 11) digits = '55' + digits;
  return digits;
}

function buildMapsRouteUrl(origin, stops, destination) {
  const params = new URLSearchParams();
  params.set('api', '1');
  params.set('origin', origin);
  params.set('destination', destination);
  if (stops.length > 0) params.set('waypoints', stops.join('|'));
  params.set('travelmode', 'driving');
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function handleBookingSubmit(event) {
  event.preventDefault();

  const name = document.getElementById('booking-name').value;
  const phone = document.getElementById('booking-phone').value;
  const origin = document.getElementById('booking-origin').value;
  const destination = document.getElementById('booking-destination').value;
  const stops = getStops();
  const km = document.getElementById('booking-distance').value;
  const min = document.getElementById('booking-duration').value;
  const notes = document.getElementById('booking-notes').value;
  const estimate = document.getElementById('booking-estimate').textContent;

  const serviceLabel = serviceLabels[state.serviceType];

  const mapsUrl = buildMapsRouteUrl(origin, stops, destination);

  let message = `Olá ${state.driver.name}! Gostaria de solicitar uma *${serviceLabel}* pelo korenDriver:\n\n`;
  message += `📍 Origem: ${origin}\n`;
  stops.forEach((stop, i) => { message += `🛑 Parada ${i + 1}: ${stop}\n`; });
  message += `🎯 Destino: ${destination}\n`;
  message += `🗺️ Ver rota no Maps: ${mapsUrl}\n`;
  message += `📏 Distância aprox: ${km} km (${min} min)\n`;
  if (notes) message += `📝 Obs: ${notes}\n`;
  message += `💰 Valor estimado: ${estimate}\n\n`;
  message += `Meu nome: ${name}\nMeu WhatsApp: ${phone}`;

  const driverPhone = normalizePhone(state.driver.phone);
  const url = `https://api.whatsapp.com/send?phone=${driverPhone}&text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}
