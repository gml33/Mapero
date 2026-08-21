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

// Estado de las redes: name -> agregación (centroide ponderado por señal).
const networks = new Map();

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

function ingest(bssid, ssid, lat, lon, rssi) {
  const name = (ssid && ssid.trim()) ? ssid : bssid;
  let n = networks.get(name);
  if (!n) {
    n = { sumLat: 0, sumLon: 0, sumW: 0, sumRssi: 0, count: 0, marker: null };
    networks.set(name, n);
  }
  const w = Math.max(0, rssi + 90);
  n.sumLat += lat * w;
  n.sumLon += lon * w;
  n.sumW += w;
  n.sumRssi += rssi;
  n.count++;
}

function addNetwork(name) {
  const n = networks.get(name);
  if (!n) return;
  const lat = n.sumLat / n.sumW;
  const lon = n.sumLon / n.sumW;
  const rssi = n.sumRssi / n.count;

  if (n.marker) {
    n.marker.setLatLng([lat, lon]).setStyle({ color: colorFor(rssi) });
    n.marker.bindPopup(`<b>${esc(name)}</b><br>Señal: ${rssi.toFixed(0)} dBm · ${n.count} muestras`);
  } else {
    n.marker = L.circleMarker([lat, lon], {
      radius: 8, color: colorFor(rssi), weight: 2, fillOpacity: 0.8,
    }).addTo(map).bindPopup(`<b>${esc(name)}</b><br>Señal: ${rssi.toFixed(0)} dBm · ${n.count} muestras`);
  }
}

function refreshAll() {
  for (const name of networks.keys()) addNetwork(name);
  document.getElementById('count').textContent = networks.size + ' redes';
  document.getElementById('lastUpdate').textContent =
    'última actualización: ' + new Date().toLocaleTimeString();
}

// Carga inicial
async function loadInitial() {
  try {
    const res = await fetch('/api/networks');
    const rows = await res.json();
    for (const r of rows) {
      const rssi = Number(r.rssi);
      ingest(r.name, r.name, Number(r.latitude), Number(r.longitude), rssi);
    }
    refreshAll();
  } catch (e) {
    console.error('error carga inicial', e);
  }
}

// WebSocket en tiempo real
let ws;
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => setStatus('En línea', true);
  ws.onclose = () => {
    setStatus('Sin conexión', false);
    setTimeout(connect, 3000);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'measurements') {
      for (const m of msg.data) {
        ingest(m.bssid, m.ssid, Number(m.latitude), Number(m.longitude), Number(m.rssi));
      }
      refreshAll();
    }
  };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

centerOnLastPosition();
loadInitial();
loadTerritories();
loadLeaderboard();
setInterval(() => { loadTerritories(); loadLeaderboard(); }, 30000);
connect();
