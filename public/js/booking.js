import * as maplibregl from 'https://unpkg.com/maplibre-gl@6.14.0/dist/maplibre-gl.mjs';

const state = {
  slug: null,
  driver: null,
  vehicle: null,
  rates: null,
  serviceType: 'corrida',
  stopCount: 0,
  // Coordenadas (lat/lon) de cada campo de endereço, guardadas só quando o
  // usuário escolhe uma sugestão da lista (ou usa localização/mapa) — é a
  // partir delas que a rota real (OSRM) calcula km/min de verdade, em vez
  // do passageiro chutar os números.
  coordsByInputId: {},
  geoRequested: false
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
window.showScreen = showScreen;
window.goToReview = goToReview;
window.requestCurrentLocationAsOrigin = requestCurrentLocationAsOrigin;

// ============================================================================
// Navegação entre as 3 etapas (+ tela de sucesso)
// ============================================================================
function showScreen(id) {
  ['step-1', 'step-2', 'step-3', 'step-success'].forEach(s => {
    document.getElementById(s)?.classList.toggle('hidden', s !== id);
  });

  if (id === 'step-2') {
    // Precisa esperar o container ficar visível (não display:none) pro
    // Leaflet calcular o tamanho certo — se inicializasse antes, nasceria
    // com altura/largura zero e ficaria quebrado.
    initMap();
    if (!state.geoRequested) {
      state.geoRequested = true;
      requestCurrentLocationAsOrigin();
    }
  }
}

// O campo de endereço, depois de uma sugestão escolhida, fica com o texto
// completo (rua, bairro, cidade, CEP, país) — editar esse texto pra tentar
// encaixar um número dispararia uma busca nova com a string inteira, que o
// Nominatim não reconhece mais. Por isso o número da casa vive num campo
// separado, que nunca busca nada — só é costurado no endereço final aqui.
function insertNumberIntoAddress(address, number) {
  if (!number || address.includes(number)) return address;
  const firstComma = address.indexOf(',');
  if (firstComma === -1) return `${address}, ${number}`;
  return `${address.slice(0, firstComma)}, ${number}${address.slice(firstComma)}`;
}

function getOriginAddress() {
  return insertNumberIntoAddress(
    document.getElementById('booking-origin').value,
    document.getElementById('booking-origin-number').value.trim()
  );
}

function getDestinationAddress() {
  return insertNumberIntoAddress(
    document.getElementById('booking-destination').value,
    document.getElementById('booking-destination-number').value.trim()
  );
}

function goToReview() {
  document.getElementById('review-origin-text').textContent = getOriginAddress();
  document.getElementById('review-destination-text').textContent = getDestinationAddress();
  document.getElementById('review-distance').textContent = `${document.getElementById('booking-distance').value} km`;
  document.getElementById('review-duration').textContent = `${document.getElementById('booking-duration').value} min`;
  showScreen('step-3');
}

function updateContinueButtonState() {
  const btn = document.getElementById('btn-continue-step2');
  if (!btn) return;
  const ready = Boolean(state.coordsByInputId['booking-origin'] && state.coordsByInputId['booking-destination']);
  btn.disabled = !ready;
}

function addStop() {
  state.stopCount += 1;
  const id = state.stopCount;

  const wrapper = document.createElement('div');
  wrapper.id = `stop-row-${id}`;
  wrapper.className = 'pointer-events-auto flex items-end gap-2 bg-white rounded-xl shadow-lg border border-surface-border p-2';
  wrapper.innerHTML = `
    <div class="flex-1 relative">
      <input id="stop-input-${id}" type="text" autocomplete="off" placeholder="Parada (opcional)" class="w-full bg-transparent text-sm text-slate-800 placeholder-slate-400 outline-none px-1">
      <div id="stop-suggestions-${id}" class="hidden absolute z-20 left-0 right-0 mt-1 bg-white border border-surface-border rounded-xl overflow-hidden shadow-lg"></div>
    </div>
    <button type="button" onclick="removeStop(${id})" class="w-7 h-7 shrink-0 rounded-lg bg-surface-subtle text-slate-400 hover:text-red-500 flex items-center justify-center">
      <span class="material-symbols-outlined text-base">close</span>
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

  // Sem isso, tocar numa sugestão tira o foco do campo (blur) antes do clique
  // terminar de processar, e o hideSuggestions (disparado pelo blur) some
  // com a lista bem na hora — o clique nunca chega a registrar. Bloqueando
  // o mousedown/touchstart na lista, o campo nunca perde o foco por causa
  // dela, e o clique na sugestão sempre é concluído normalmente.
  box.addEventListener('mousedown', (e) => e.preventDefault());

  function hideSuggestions() {
    box.classList.add('hidden');
    box.innerHTML = '';
  }

  function showMessage(text, isError) {
    box.innerHTML = `<p class="px-3 py-2 text-xs ${isError ? 'text-red-500' : 'text-slate-500'}">${text}</p>`;
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
        <button type="button" data-idx="${i}" class="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-surface-subtle border-b border-surface-border last:border-b-0 flex items-start gap-2">
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
    updateContinueButtonState();
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
  showScreen('step-1');
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

// ============================================================================
// Geolocalização + geocodificação reversa — gratuito, mesmo serviço
// (Nominatim) já usado na busca de endereço por texto, só que de trás pra
// frente: lat/lon -> endereço legível.
// ============================================================================
async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=0`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name || null;
  } catch (err) {
    console.error('Erro na geocodificação reversa:', err);
    return null;
  }
}

function setOriginFromCoords(lat, lon, label) {
  const input = document.getElementById('booking-origin');
  input.value = label;
  input.placeholder = 'Sua localização atual';
  state.coordsByInputId['booking-origin'] = { lat, lon };
  updateContinueButtonState();
  calculateRoute();

  // GPS e toque no mapa (geocodificação reversa) quase nunca trazem o número
  // da casa, só rua/bairro — diferente da busca por texto, que tem o campo
  // "Nº" ao lado mas sem nenhum aviso visual chamando atenção pra ele. Foca
  // o campo pra guiar o passageiro a completar na hora, em vez de só confiar
  // que ele vai notar a dica de texto.
  const numberInput = document.getElementById('booking-origin-number');
  if (numberInput && !numberInput.value.trim()) numberInput.focus();
}

// Pedida automaticamente ao entrar na Etapa 2, e também pelo botão de mira
// no campo Origem. Se a permissão for negada ou falhar, não trava nada — o
// campo só fica vazio, pronto pra busca manual ou toque no mapa.
function requestCurrentLocationAsOrigin() {
  const input = document.getElementById('booking-origin');
  if (!navigator.geolocation) return;

  input.placeholder = 'Localizando...';
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      if (map) map.flyTo({ center: [lon, lat], zoom: 15 });
      const label = await reverseGeocode(lat, lon);
      setOriginFromCoords(lat, lon, label || `${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    },
    () => {
      input.placeholder = 'Digite ou toque no mapa';
    },
    // enableHighAccuracy pede o sensor mais preciso disponível (GPS, se
    // existir) em vez do padrão rápido-mas-impreciso baseado em IP/Wi-Fi —
    // em celular com GPS ligado faz diferença real; em notebook sem GPS não
    // tem o que melhorar (a localização continua vindo por Wi-Fi/IP mesmo).
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ============================================================================
// Mapa com Origem/Paradas/Destino e o traçado da rota — MapLibre GL +
// OpenFreeMap (estilo "Positron"), gratuito pra sempre e sem chave de API.
// Nota: MapLibre usa [longitude, latitude] (Leaflet usava [lat, lon]).
// ============================================================================
let map = null;
let mapMarkers = [];
let mapLoaded = false;
let pendingRouteUpdate = null; // updateRouteMap chamado antes do estilo carregar

function initMap() {
  if (map) return;
  const container = document.getElementById('route-map');
  if (!container) return;

  map = new maplibregl.Map({
    container,
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [-38.52, -3.73], // Fortaleza/CE
    zoom: 12
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  map.on('load', () => {
    mapLoaded = true;
    map.addSource('route-line', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }
    });
    map.addLayer({
      id: 'route-line-layer',
      type: 'line',
      source: 'route-line',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#FB4F14', 'line-width': 4 }
    });
    if (pendingRouteUpdate) {
      const args = pendingRouteUpdate;
      pendingRouteUpdate = null;
      updateRouteMap(...args);
    }
  });

  // Tocar em qualquer ponto do mapa define a Origem ali (geocodificação
  // reversa) — é a alternativa a digitar/buscar, pedida explicitamente.
  map.on('click', async (e) => {
    const { lat, lng } = e.lngLat;
    const input = document.getElementById('booking-origin');
    input.value = 'Localizando endereço...';
    const label = await reverseGeocode(lat, lng);
    setOriginFromCoords(lat, lng, label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  });
}

function clearMapMarkers() {
  mapMarkers.forEach(m => m.remove());
  mapMarkers = [];
}

function addMapPoint(coords, color) {
  mapMarkers.push(new maplibregl.Marker({ color }).setLngLat([coords.lon, coords.lat]).addTo(map));
}

function updateRouteMap(originCoords, stopCoordsList, destCoords, geometryCoords) {
  if (!map) return;
  if (!mapLoaded) {
    pendingRouteUpdate = [originCoords, stopCoordsList, destCoords, geometryCoords];
    return;
  }

  clearMapMarkers();
  addMapPoint(originCoords, '#22C55E'); // verde = origem
  stopCoordsList.forEach(c => addMapPoint(c, '#FB4F14')); // laranja = parada
  addMapPoint(destCoords, '#EF4444'); // vermelho = destino

  // geometryCoords já vem como [lon, lat] (GeoJSON/OSRM) — formato nativo do
  // MapLibre, sem precisar inverter como no Leaflet.
  const lineCoords = (geometryCoords && geometryCoords.length)
    ? geometryCoords
    : [[originCoords.lon, originCoords.lat], [destCoords.lon, destCoords.lat]];

  map.getSource('route-line').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: lineCoords }
  });

  const lons = lineCoords.map(c => c[0]);
  const lats = lineCoords.map(c => c[1]);
  map.fitBounds(
    [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
    { padding: { top: 180, bottom: 140, left: 40, right: 40 } }
  );
}

// Calcula distância/tempo reais pela rota (OSRM, demo pública gratuita, sem
// chave de API) assim que origem e destino (e paradas, se houver) tiverem
// coordenada — ou seja, foram escolhidos da lista de sugestões, da
// localização atual ou de um toque no mapa, não só digitados. Preenche os
// campos de km/min automaticamente em vez do passageiro ter que chutar
// esses valores.
//
// O OSRM calcula em fluxo livre, sem trânsito em tempo real — comparado ao
// Waze/Google (que têm trânsito ao vivo), ele tende a subestimar bastante o
// tempo, principalmente em horário de pico. Essa margem compensa isso; não é
// trânsito de verdade, só uma correção pra não ficar tão otimista.
const TRAFFIC_BUFFER_MULTIPLIER = 1.3;
let routeRequestSeq = 0;

async function calculateRoute() {
  updateContinueButtonState();

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
    statusEl.classList.remove('hidden', 'text-red-500');
  }

  const points = [originCoords, ...stopCoordsList, destCoords].map(c => `${c.lon},${c.lat}`).join(';');

  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${points}?overview=full&geometries=geojson`);
    const data = await res.json();
    if (seq !== routeRequestSeq) return; // resposta de uma busca já superada

    if (data.code !== 'Ok' || !data.routes?.[0]) {
      if (statusEl) {
        statusEl.textContent = 'Não consegui calcular a rota automaticamente. Confira o endereço escolhido ou tente novamente.';
        statusEl.classList.add('text-red-500');
      }
      return;
    }

    const km = data.routes[0].distance / 1000;
    const min = (data.routes[0].duration / 60) * TRAFFIC_BUFFER_MULTIPLIER;

    document.getElementById('booking-distance').value = km.toFixed(1);
    document.getElementById('booking-duration').value = Math.round(min);
    updateEstimate();
    updateRouteMap(originCoords, stopCoordsList, destCoords, data.routes[0].geometry.coordinates);

    if (statusEl) {
      statusEl.textContent = `Rota calculada: ${km.toFixed(1)} km, ${Math.round(min)} min (já com margem de trânsito).`;
      statusEl.classList.remove('text-red-500');
    }
  } catch (err) {
    if (seq !== routeRequestSeq) return;
    console.error('Erro ao calcular rota:', err);
    if (statusEl) {
      statusEl.textContent = 'Não consegui calcular a rota automaticamente. Confira o endereço escolhido ou tente novamente.';
      statusEl.classList.add('text-red-500');
    }
  }
}

function updateEstimate() {
  if (!state.rates) return;
  const km = parseFloat(document.getElementById('booking-distance').value) || 0;
  const min = parseFloat(document.getElementById('booking-duration').value) || 0;

  let total = state.rates.base_fare + (km * state.rates.km_rate) + (min * state.rates.minute_rate);
  if (total < state.rates.min_fare) total = state.rates.min_fare;

  state.estimateValue = total;
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

// Cria o pedido no sistema (aparece pro motorista aceitar no Cockpit) além
// da mensagem de WhatsApp que esta tela já monta. Devolve se deu certo pra
// quem chamou poder avisar o passageiro — mas nunca lança erro: o WhatsApp
// abre de qualquer jeito, mesmo que o registro no sistema falhe.
async function submitRideRequest({ name, phone, origin, destination, km, min, notes }) {
  const originCoords = state.coordsByInputId['booking-origin'];
  const destCoords = state.coordsByInputId['booking-destination'];

  try {
    const res = await fetch(`/api/public/driver/${encodeURIComponent(state.slug)}/request-ride`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        passenger_name: name,
        passenger_phone: phone,
        origin,
        destination,
        origin_lat: originCoords?.lat ?? null,
        origin_lng: originCoords?.lon ?? null,
        destination_lat: destCoords?.lat ?? null,
        destination_lng: destCoords?.lon ?? null,
        distance_km: km,
        duration_min: min,
        fare: state.estimateValue || 0,
        notes
      })
    });
    return res.ok ? await res.json() : null;
  } catch (err) {
    console.error('Erro ao registrar pedido de corrida:', err);
    return null;
  }
}

async function handleBookingSubmit(event) {
  event.preventDefault();

  const name = document.getElementById('booking-name').value;
  const phone = document.getElementById('booking-phone').value;
  const origin = getOriginAddress();
  const destination = getDestinationAddress();
  const stops = getStops();
  const km = document.getElementById('booking-distance').value;
  const min = document.getElementById('booking-duration').value;
  const notes = document.getElementById('booking-notes').value;
  const estimate = document.getElementById('booking-estimate').textContent;

  const btn = document.getElementById('btn-submit-request');
  const icon = document.getElementById('btn-submit-icon');
  const label = document.getElementById('btn-submit-label');
  const errorEl = document.getElementById('submit-error');
  errorEl.classList.add('hidden');
  btn.disabled = true;
  icon.innerHTML = '';
  icon.classList.remove('material-symbols-outlined');
  icon.classList.add('inline-block', 'w-4', 'h-4', 'border-2', 'border-black', 'border-t-transparent', 'rounded-full', 'animate-spin');
  label.textContent = 'Enviando...';

  const requestResult = await submitRideRequest({ name, phone, origin, destination, km, min, notes });

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

  btn.disabled = false;
  icon.classList.remove('inline-block', 'w-4', 'h-4', 'border-2', 'border-black', 'border-t-transparent', 'rounded-full', 'animate-spin');
  icon.classList.add('material-symbols-outlined');
  icon.textContent = 'chat';
  label.textContent = 'Solicitar Corrida';

  if (!requestResult) {
    errorEl.textContent = 'Não consegui registrar o pedido no sistema, mas o WhatsApp foi aberto normalmente — combine direto com o motorista por lá.';
    errorEl.classList.remove('hidden');
  }

  showScreen('step-success');
  if (requestResult?.tracking_url) setTimeout(() => { location.href = requestResult.tracking_url; }, 1200);
}
