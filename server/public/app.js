const MAP_TILE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAP_ATTR = '&copy; OpenStreetMap contributors';

// Vista por defecto mientras carga; se reemplaza con la última posición medida.
const map = L.map('map').setView([-34.6118, -58.4173], 14);
L.tileLayer(MAP_TILE, { attribution: MAP_ATTR, maxZoom: 19 }).addTo(map);

async function centerOnLastPosition() {
  try {
    const res = await fetch('/api/last-position');
    const pos = await res.json();
    if (pos && Number.isFinite(pos.latitude) && Number.isFinite(pos.longitude)) {
      map.setView([pos.latitude, pos.longitude], 15);
    }
  } catch (e) {
    console.error('error centrando en última posición', e);
  }
}

// Estado de las redes y filtros.
let networkList = [];
let netLayer = L.layerGroup().addTo(map);
let netMarkers = new Map(); // name -> marker
const filters = { type: '', band: '', sig: '', user: '', q: '', showNetworks: true };
let loadTimer = null;
const filterIds = ['fShowNetworks', 'fType', 'fBand', 'fSig', 'fUser', 'fQ'];

function setStatus(text, online) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.className = 'status ' + (online ? 'online' : 'offline');
}

function colorFor(rssi) {
  if (rssi >= -60) return '#2e7d32';
  if (rssi >= -75) return '#f9a825';
  return '#c62828';
}

function bandLabel(band) {
  if (band === '2.4') return '2,4 GHz';
  if (band === '5') return '5 GHz';
  if (band === '6') return '6 GHz';
  return '—';
}

// La seguridad es tri-estado: null significa que las mediciones no traen
// capabilities (datos anteriores a esa columna), no que la red sea abierta.
function securityLabel(open) {
  if (open === true) return 'Abierta';
  if (open === false) return 'Protegida';
  return 'Sin datos';
}

function matchesFilters(n) {
  if (!filters.showNetworks) return false;
  if (filters.type === 'open' && n.open !== true) return false;
  if (filters.type === 'protected' && n.open !== false) return false;
  if (filters.type === 'unknown' && n.open !== null) return false;
  if (filters.band && n.band !== filters.band) return false;
  if (filters.sig && Number(n.rssi) < Number(filters.sig)) return false;
  if (filters.user && !(n.users || []).includes(filters.user)) return false;
  if (filters.q && !String(n.name || '').toLowerCase().includes(filters.q.toLowerCase())) return false;
  return true;
}

function popupHtml(n) {
  return `<b>${esc(n.name)}</b><br>Señal: ${Number(n.rssi).toFixed(0)} dBm · ${n.samples} muestras`
    + `<br>Tipo: ${securityLabel(n.open)} · ${bandLabel(n.band)}`
    + (n.users && n.users.length ? `<br>Usuarios: ${n.users.map(esc).join(', ')}` : '');
}

function paramsFromFilters() {
  const params = new URLSearchParams();
  if (!filters.showNetworks) params.set('show', '0');
  if (filters.type) params.set('type', filters.type);
  if (filters.band) params.set('band', filters.band);
  if (filters.sig) params.set('sig', filters.sig);
  if (filters.user) params.set('user', filters.user);
  if (filters.q) params.set('q', filters.q);
  return params;
}

function syncUrl() {
  const params = paramsFromFilters();
  const next = params.toString();
  const target = next ? `${location.pathname}?${next}` : location.pathname;
  history.replaceState(null, '', target);
}

function applyFiltersFromUi() {
  filters.showNetworks = document.getElementById('fShowNetworks').checked;
  filters.type = document.getElementById('fType').value;
  filters.band = document.getElementById('fBand').value;
  filters.sig = document.getElementById('fSig').value;
  filters.user = document.getElementById('fUser').value;
  filters.q = document.getElementById('fQ').value.trim();
  syncUrl();
}

function hydrateFiltersFromUrl() {
  const params = new URLSearchParams(location.search);
  filters.showNetworks = params.get('show') !== '0';
  filters.type = params.get('type') || '';
  filters.band = params.get('band') || '';
  filters.sig = params.get('sig') || '';
  filters.user = params.get('user') || '';
  filters.q = params.get('q') || '';
  document.getElementById('fShowNetworks').checked = filters.showNetworks;
  document.getElementById('fType').value = filters.type;
  document.getElementById('fBand').value = filters.band;
  document.getElementById('fSig').value = filters.sig;
  document.getElementById('fUser').value = filters.user;
  document.getElementById('fQ').value = filters.q;
}

function renderNetworks() {
  if (!filters.showNetworks) {
    for (const [, marker] of netMarkers) {
      if (netLayer.hasLayer(marker)) netLayer.removeLayer(marker);
    }
    document.getElementById('count').textContent = 'redes ocultas';
    document.getElementById('lastUpdate').textContent =
      'última actualización: ' + new Date().toLocaleTimeString();
    return;
  }
  for (const [name, m] of netMarkers) {
    if (!networkList.find((n) => n.name === name)) {
      netLayer.removeLayer(m);
      netMarkers.delete(name);
    }
  }
  for (const n of networkList) {
    const lat = Number(n.latitude), lon = Number(n.longitude);
    const rssi = Number(n.rssi);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let m = netMarkers.get(n.name);
    if (!m) {
      m = L.circleMarker([lat, lon], { radius: 8, weight: 2, fillOpacity: 0.8 });
      m.bindPopup(popupHtml(n));
      netMarkers.set(n.name, m);
    } else {
      m.setLatLng([lat, lon]);
      m.bindPopup(popupHtml(n));
    }
    m.setStyle({ color: colorFor(rssi) });
    const show = matchesFilters(n);
    if (show && !netLayer.hasLayer(m)) netLayer.addLayer(m);
    if (!show && netLayer.hasLayer(m)) netLayer.removeLayer(m);
  }
  const visible = networkList.filter(matchesFilters).length;
  document.getElementById('count').textContent = visible + ' redes';
  document.getElementById('lastUpdate').textContent =
    'última actualización: ' + new Date().toLocaleTimeString();
}

async function loadNetworks() {
  try {
    const query = paramsFromFilters().toString();
    const res = await fetch(query ? `/api/networks?${query}` : '/api/networks');
    networkList = await res.json();
    renderNetworks();
  } catch (e) {
    console.error('error carga de redes', e);
  }
}

// La lista de usuarios sale del servidor y no de la respuesta filtrada: si se
// derivara de `networkList`, al elegir un usuario el selector se quedaría solo
// con ese usuario y no se podría cambiar a otro sin volver a "Todos".
async function loadUserOptions() {
  const sel = document.getElementById('fUser');
  if (sel.dataset.ready === '1') return;
  try {
    const users = await (await fetch('/api/users')).json();
    sel.innerHTML = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'Todos';
    sel.appendChild(all);
    for (const user of users) {
      const opt = document.createElement('option');
      opt.value = user.username;
      opt.textContent = user.username;
      sel.appendChild(opt);
    }
    sel.dataset.ready = '1';
    if (filters.user) sel.value = filters.user;
  } catch (e) {
    console.error('error carga de usuarios', e);
  }
}

function scheduleNetworkReload(delay = 250) {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(loadNetworks, delay);
}

filterIds.forEach((id) => {
  document.getElementById(id).addEventListener(id === 'fQ' ? 'input' : 'change', () => {
    applyFiltersFromUi();
    if (id === 'fShowNetworks' && !filters.showNetworks) {
      renderNetworks();
      return;
    }
    scheduleNetworkReload(id === 'fQ' ? 250 : 0);
  });
});

document.getElementById('clearFiltersBtn').addEventListener('click', () => {
  for (const key of Object.keys(filters)) filters[key] = '';
  filters.showNetworks = true;
  document.getElementById('fShowNetworks').checked = true;
  document.getElementById('fType').value = '';
  document.getElementById('fBand').value = '';
  document.getElementById('fSig').value = '';
  document.getElementById('fUser').value = '';
  document.getElementById('fQ').value = '';
  syncUrl();
  scheduleNetworkReload(0);
});

// WebSocket en tiempo real
let ws;
// El flujo crudo de mediciones solo se recibe con sesión; sin ella el servidor
// manda un aviso y recargamos los agregados, que son públicos. El browser no
// permite cabeceras en un WebSocket, así que el token va por query.
function connect() {
  const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const query = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
  ws = new WebSocket(`${scheme}${location.host}/ws${query}`);
  ws.onopen = () => setStatus('En línea', true);
  ws.onclose = () => {
    setStatus('Sin conexión', false);
    setTimeout(connect, 3000);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'measurements' || msg.type === 'ingest') {
      // Reconciliación: el WS avisa que hubo ingesta, el estado real se pide
      // por HTTP (agregado por red, territories y leaderboard).
      scheduleNetworkReload(800);
      scheduleRefresh();
    }
  };
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- Juego de conquista (territorios) ----

let territoryLayer = L.layerGroup().addTo(map);

function colorForOwner(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 70%, 45%)`;
}

async function loadTerritories() {
  try {
    const res = await fetch('/api/territories');
    const data = await res.json();
    territoryLayer.clearLayers();

    for (const t of data) {
      const color = colorForOwner(t.owner);
      const boundary = h3.cellToBoundary(t.hex, true); // [lng,lat]
      const opts = {
        color: color, weight: 1, fillColor: color, fillOpacity: 0.45,
      };
      // Celdas en disputa: borde blanco punteado (presión del defensor).
      if (t.contested) {
        opts.color = '#ffffff';
        opts.weight = 2;
        opts.dashArray = '6 4';
        opts.fillOpacity = 0.5;
      }
      const html = t.contested
        ? `<b>${esc(t.owner)}</b><br>cobertura: ${t.score} · ⚔️ en disputa<br>` +
          `<i>segundo: ${t.secondScore}</i>`
        : `<b>${esc(t.owner)}</b><br>cobertura: ${t.score}<br>${t.count} muestras`;
      L.polygon(boundary.map(p => [p[1], p[0]]), opts)
        .addTo(territoryLayer).bindPopup(html);
    }
  } catch (e) {
    console.error('error territorios', e);
  }
}

// ---- Leaderboard (desde el servidor) ----
async function loadLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();
    const el = document.getElementById('rankingList');
    el.innerHTML = data.map(r =>
      `<li><span class="chip" style="background:${colorForOwner(r.username)}"></span>` +
      `<span class="name">${r.rank}. ${esc(r.username)}</span>` +
      `<span class="n">${r.cells} cel · ${Math.round(r.coverage)}</span></li>`
    ).join('') || '<li>Sin territorios aún</li>';
  } catch (e) {
    console.error('error leaderboard', e);
  }
}

// ---- Autenticación (web) ----
let authToken = localStorage.getItem('mapero_token') || '';
const loginBtn = document.getElementById('loginBtn');
function updateAuthUi() {
  if (authToken) {
    loginBtn.textContent = localStorage.getItem('mapero_user') || 'Sesión';
  } else {
    loginBtn.textContent = 'Entrar';
  }
}
loginBtn.onclick = async () => {
  const user = prompt('Usuario:');
  if (!user) return;
  const pass = prompt('Contraseña (si no existe el usuario, se crea):');
  if (!pass) return;
  try {
    let res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
    });
    if (!res.ok) {
      res = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      });
    }
    const data = await res.json();
    if (data.token) {
      authToken = data.token;
      localStorage.setItem('mapero_token', data.token);
      localStorage.setItem('mapero_user', user);
      updateAuthUi();
      // Reconecta para que el socket pase a recibir el flujo crudo: el que
      // estaba abierto se había negotiated sin token.
      if (ws) ws.close();
      else connect();
      loadLeaderboard();
    } else {
      alert('No se pudo conectar');
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
};
updateAuthUi();

let terrTimer = null;
function scheduleRefresh() {
  clearTimeout(terrTimer);
  terrTimer = setTimeout(() => {
    loadTerritories();
    loadLeaderboard();
  }, 800);
}

hydrateFiltersFromUrl();
loadUserOptions();
centerOnLastPosition();
refreshAll();
connect();

// El polling es una red de seguridad: el WebSocket ya avisa cada ingesta. Con la
// pestaña oculta no hay nadie mirando el mapa, así que se saltea.
function refreshAll() {
  loadNetworks();
  loadTerritories();
  loadLeaderboard();
}
setInterval(() => {
  if (!document.hidden) refreshAll();
}, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshAll();
});
