const state = {
  slug: null,
  driver: null,
  vehicle: null,
  rates: null,
  serviceType: 'corrida',
  stopCount: 0,
  // Coordenadas (lat/lon) de cada campo de endereço, guardadas só quando o
  // usuário escolhe uma sugestão da lista — é a partir delas que a rota real
  // (OSRM) calcula km/min de verdade, em vez do passageiro chutar os números.
  coordsByInputId: {}
};

// Muita rua pequena (loteamento, conjunto residencial) não tem o número da
// casa mapeado no OpenStreetMap — a busca só confirma a rua. Sem isso, ao
// clicar na sugestão o número que a pessoa digitou (ex: "495") seria
// substituído pelo endereço genérico da rua, sumindo da mensagem pro motorista.
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
    <div class="flex-1 relative">
      <label class="block text-xs font-medium text-slate-300 mb-1">Parada</label>
      <input id="stop-input-${id}" type="text" autocomplete="off" placeholder="Ex: Rua Major Facundo, 200 - Centro, Fortaleza - CE" class="w-full bg-surface-subtle border border-surface-border focus:border-brand rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none">
      <div id="stop-suggestions-${id}" class="hidden absolute z-20 left-0 right-0 mt-1 bg-surface-card border border-surface-border rounded-xl overflow-hidden shadow-lg"></div>
    </div>
    <button type="button" onclick="removeStop(${id})" class="w-10 h-10 shrink-0 rounded-xl bg-surface-subtle border border-surface-border text-slate-400 hover:text-red-400 hover:border-red-500/40 flex items-center justify-center">
      <span class="material-symbols-outlined text-lg">close</span>
    </button>
  `;
  document.getElementById('booking-stops-list').appendChild(wrapper);
  setupAddressAutocomplete(`stop-input-${id}`, `stop-suggestions-${id}`);
}

// Busca de endereço (OpenStreetMap/Nominatim, gratuito, sem chave de API —
// mesmo padrão usado na busca de CEP do app do motorista) nos campos de
// endereço desta tela pública de solicitação de corrida.
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
          const r = results[Number(btn.dataset.idx)];
          input.value = buildFinalAddress(query, r.display_name);
          state.coordsByInputId[inputId] = { lat: parseFloat(r.lat), lon: parseFloat(r.lon) };
          hideSuggestions();
          calculateRoute();
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
    // Texto mudou na mão — a coordenada guardada (se tinha) não vale mais
    // pra rota, senão calcularia com um endereço que não é mais esse.
    delete state.coordsByInputId[inputId];
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (query.length < 3) {
      hideSuggestions();
      return;
    }
    debounceTimer = setTimeout(() => search(query), 450);
  });

  input.addEventListener('blur', () => {
    setTimeout(hideSuggestions, 150);
  });
}

function removeStop(id) {
  delete state.coordsByInputId[`stop-input-${id}`];
  document.getElementById(`stop-row-${id}`)?.remove();
  calculateRoute();
}

function getStops() {
  return Array.from(document.querySelectorAll('#booking-stops-list input'))
    .map(input => input.value.trim())
    .filter(Boolean);
}

document.addEventListener('DOMContentLoaded', async () => {
  setupAddressAutocomplete('booking-origin', 'booking-origin-suggestions');
  setupAddressAutocomplete('booking-destination', 'booking-destination-suggestions');

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

// Calcula distância/tempo reais pela rota (OSRM, demo pública gratuita, sem
// chave de API) assim que origem e destino (e paradas, se houver) tiverem
// coordenada — ou seja, foram escolhidos da lista de sugestões, não só
// digitados. Preenche os campos de km/min automaticamente em vez do
// passageiro ter que chutar esses valores.
//
// O OSRM calcula em fluxo livre, sem trânsito em tempo real — comparado ao
// Waze/Google (que têm trânsito ao vivo), ele tende a subestimar bastante o
// tempo, principalmente em horário de pico. Essa margem compensa isso; não é
// trânsito de verdade, só uma correção pra não ficar tão otimista.
const TRAFFIC_BUFFER_MULTIPLIER = 1.3;
let routeRequestSeq = 0;

async function calculateRoute() {
  const statusEl = document.getElementById('route-status');
  const originCoords = state.coordsByInputId['booking-origin'];
  const destCoords = state.coordsByInputId['booking-destination'];

  if (!originCoords || !destCoords) return;

  const stopInputs = Array.from(document.querySelectorAll('#booking-stops-list input'));
  const filledStops = stopInputs.filter(inp => inp.value.trim());
  const stopCoordsList = filledStops.map(inp => state.coordsByInputId[inp.id]).filter(Boolean);

  // Alguma parada preenchida sem coordenada (digitada na mão, sem escolher
  // sugestão) deixaria a rota incompleta — melhor avisar do que calcular errado.
  if (stopCoordsList.length !== filledStops.length) {
    if (statusEl) {
      statusEl.textContent = 'Escolha a parada na lista de sugestões pra recalcular a rota.';
      statusEl.classList.remove('hidden');
    }
    return;
  }

  const seq = ++routeRequestSeq;
  if (statusEl) {
    statusEl.textContent = 'Calculando rota...';
    statusEl.classList.remove('hidden', 'text-red-400');
  }

  const points = [originCoords, ...stopCoordsList, destCoords].map(c => `${c.lon},${c.lat}`).join(';');

  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${points}?overview=false`);
    const data = await res.json();
    if (seq !== routeRequestSeq) return; // resposta de uma busca já superada

    if (data.code !== 'Ok' || !data.routes?.[0]) {
      if (statusEl) {
        statusEl.textContent = 'Não consegui calcular a rota — pode ajustar os valores manualmente.';
        statusEl.classList.add('text-red-400');
      }
      return;
    }

    const km = data.routes[0].distance / 1000;
    const min = (data.routes[0].duration / 60) * TRAFFIC_BUFFER_MULTIPLIER;

    document.getElementById('booking-distance').value = km.toFixed(1);
    document.getElementById('booking-duration').value = Math.round(min);
    updateEstimate();

    if (statusEl) {
      statusEl.textContent = `Calculado pela rota real: ${km.toFixed(1)} km, ${Math.round(min)} min (já com margem de trânsito — sem dados de trânsito ao vivo).`;
      statusEl.classList.remove('text-red-400');
    }
  } catch (err) {
    if (seq !== routeRequestSeq) return;
    console.error('Erro ao calcular rota:', err);
    if (statusEl) {
      statusEl.textContent = 'Não consegui calcular a rota — pode ajustar os valores manualmente.';
      statusEl.classList.add('text-red-400');
    }
  }
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
