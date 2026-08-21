let token = localStorage.getItem('mapero_token') || '';

const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Error');
  return res.status === 200 ? res.json() : null;
}

// ---- Login ----
async function checkSession() {
  if (!token) { showLogin(); return; }
  try {
    await api('/api/admin/stats');
    showPanel();
  } catch (e) {
    showLogin();
  }
}

function showLogin() { $('login').style.display = 'block'; $('panel').style.display = 'none'; }
function showPanel() { $('login').style.display = 'none'; $('panel').style.display = 'block'; renderAll(); }

$('loginBtn').onclick = async () => {
  const username = $('loginUser').value.trim();
  const password = $('loginPass').value;
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    token = r.token;
    localStorage.setItem('mapero_token', token);
    localStorage.setItem('mapero_user', username);
    showPanel();
  } catch (e) {
    $('loginMsg').textContent = 'Credenciales inválidas';
  }
};

$('logoutBtn').onclick = () => {
  token = '';
  localStorage.removeItem('mapero_token');
  showLogin();
};

// ---- Tabs ----
document.querySelectorAll('nav button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.view').forEach((v) => (v.style.display = 'none'));
    $('view-' + b.dataset.view).style.display = 'block';
    renderAll(b.dataset.view);
  };
});

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function isOpen(caps) {
  caps = String(caps || '');
  if (!caps) return true;
  return !/WPA|WEP|RSN|SAE|PSK/.test(caps);
}
function bandLabel(freq) {
  freq = Number(freq);
  if (!freq) return '—';
  return freq < 3000 ? '2,4 GHz' : '5 GHz';
}

// ---- Render ----
function renderAll(view) {
  if (!view) view = document.querySelector('nav button.active').dataset.view;
  $('who').textContent = localStorage.getItem('mapero_user') || '';
  if (view === 'stats') renderStats();
  if (view === 'users') renderUsers();
  if (view === 'measurements') loadMeasurements();
  if (view === 'config') renderConfig();
}

async function renderStats() {
  const s = await api('/api/admin/stats');
  $('view-stats').innerHTML = `
    <div class="card stats">
      <div><div class="n">${s.users}</div><div class="lbl">Usuarios</div></div>
      <div><div class="n">${s.measurements}</div><div class="lbl">Mediciones</div></div>
      <div><div class="n">${s.territories}</div><div class="lbl">Territorios</div></div>
    </div>`;
}

async function renderUsers() {
  const users = await api('/api/admin/users');
  $('view-users').innerHTML = `
    <div class="card"><h2>Crear usuario</h2>
      <form id="newUserForm">
        <field><label>Usuario</label><input id="nu_user" required></field>
        <field><label>Contraseña</label><input id="nu_pass" type="password" required></field>
        <field><label>Rol</label>
          <select id="nu_role">
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </field>
        <field class="full"><button type="submit">Crear</button></field>
      </form>
    </div>
    <div class="card"><h2>Usuarios (${users.length})</h2>
      <table>
        <tr><th>ID</th><th>Usuario</th><th>Rol</th><th>Nueva contraseña</th><th>Registrado</th><th></th></tr>
        ${users.map((u) => `<tr>
          <td>${u.id}</td><td>${esc(u.username)}</td>
          <td>
            <select onchange="setRole(${u.id}, this.value)">
              <option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
            </select>
          </td>
          <td><input id="pass_${u.id}" type="password" placeholder="nueva pass" style="padding:5px;border:1px solid #ccc;border-radius:6px">
            <button class="small" onclick="changePass(${u.id})">Cambiar</button></td>
          <td>${new Date(u.created_at).toLocaleDateString()}</td>
          <td><button class="small danger" onclick="delUser(${u.id})">Borrar</button></td>
        </tr>`).join('')}
      </table>
    </div>`;

  $('newUserForm').onsubmit = async (e) => {
    e.preventDefault();
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        username: $('nu_user').value.trim(),
        password: $('nu_pass').value,
        role: $('nu_role').value,
      }),
    });
    renderUsers();
  };
}

async function setRole(id, role) {
  await api('/api/admin/users/' + id, { method: 'PUT', body: JSON.stringify({ role }) });
  renderUsers();
}
async function changePass(id) {
  const pass = $('pass_' + id).value;
  if (!pass) return Swal.fire({ icon: 'warning', title: 'Falta la contraseña', text: 'Escribí una contraseña nueva' });
  try {
    await api('/api/admin/users/' + id, { method: 'PUT', body: JSON.stringify({ password: pass }) });
    $('pass_' + id).value = '';
    Swal.fire({ icon: 'success', title: 'Listo', text: 'Contraseña actualizada', timer: 1500, showConfirmButton: false });
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  }
}
async function delUser(id) {
  const r = await Swal.fire({
    icon: 'warning', title: '¿Borrar este usuario?',
    text: 'Se eliminarán también sus datos.',
    showCancelButton: true, confirmButtonText: 'Borrar', cancelButtonText: 'Cancelar',
    confirmButtonColor: '#c62828',
  });
  if (!r.isConfirmed) return;
  try {
    await api('/api/admin/users/' + id, { method: 'DELETE' });
    renderUsers();
    Swal.fire({ icon: 'success', title: 'Borrado', timer: 1200, showConfirmButton: false });
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  }
}

let meas = { offset: 0, limit: 50, filters: {}, sort: 'ts', dir: 'desc' };

async function loadMeasurements() {
  const p = new URLSearchParams({ limit: meas.limit, offset: meas.offset,
    sort: meas.sort, dir: meas.dir });
  for (const k of ['user', 'from', 'to', 'q', 'mac', 'type', 'band', 'sig']) {
    if (meas.filters[k]) p.set(k, meas.filters[k]);
  }
  const d = await api('/api/admin/measurements?' + p.toString());
  renderMeasurements(d);
}

async function renderMeasurements(d) {
  const pages = Math.ceil(d.total / d.limit) || 1;
  const page = Math.floor(d.offset / d.limit) + 1;
  const users = await api('/api/admin/users');
  const userOptions = '<option value="">Todos</option>' + users
    .map((u) => `<option value="${esc(u.username)}" ${meas.filters.user === u.username ? 'selected' : ''}>${esc(u.username)}</option>`)
    .join('');
  $('view-measurements').innerHTML = `
    <div class="card"><h2>Filtros</h2>
      <form id="filtersForm">
        <field><label>Usuario</label>
          <select id="f_user">${userOptions}</select></field>
        <field><label>Desde</label><input id="f_from" type="date" value="${esc(meas.filters.from || '')}"></field>
        <field><label>Hasta</label><input id="f_to" type="date" value="${esc(meas.filters.to || '')}"></field>
        <field><label>Nombre de red</label><input id="f_q" value="${esc(meas.filters.q || '')}"></field>
        <field><label>MAC / BSSID</label><input id="f_mac" value="${esc(meas.filters.mac || '')}"></field>
        <field><label>Tipo</label>
          <select id="f_type">
            <option value="">Todos</option>
            <option value="open" ${meas.filters.type === 'open' ? 'selected' : ''}>Abiertas</option>
            <option value="protected" ${meas.filters.type === 'protected' ? 'selected' : ''}>Protegidas</option>
          </select></field>
        <field><label>Banda</label>
          <select id="f_band">
            <option value="">Todas</option>
            <option value="2.4" ${meas.filters.band === '2.4' ? 'selected' : ''}>2,4 GHz</option>
            <option value="5" ${meas.filters.band === '5' ? 'selected' : ''}>5 GHz</option>
          </select></field>
        <field><label>Señal mínima</label>
          <select id="f_sig">
            <option value="">Todas</option>
            <option value="-80" ${meas.filters.sig === '-80' ? 'selected' : ''}>≥ -80 dBm</option>
            <option value="-70" ${meas.filters.sig === '-70' ? 'selected' : ''}>≥ -70 dBm</option>
            <option value="-60" ${meas.filters.sig === '-60' ? 'selected' : ''}>≥ -60 dBm</option>
          </select></field>
        <field><button type="submit">Aplicar</button>
          <button type="button" class="ghost" style="color:#00695c;border:1px solid #00695c" onclick="resetFilters()">Limpiar</button></field>
      </form>
    </div>
    <div class="card"><h2>Mediciones (${d.total})</h2>
      <button class="danger" onclick="clearMeasurements()">Borrar todas</button>
      <div style="margin:8px 0">
        <button ${d.offset === 0 ? 'disabled' : ''} onclick="pageMeas(-1)">← Prev</button>
        <span style="margin:0 10px;font-size:13px">Página ${page} de ${pages}</span>
        <button ${d.offset + d.limit >= d.total ? 'disabled' : ''} onclick="pageMeas(1)">Next →</button>
      </div>
      <table>
        <tr>
          ${th('username', 'Usuario')}
          ${th('ssid', 'SSID')}
          ${th('bssid', 'BSSID')}
          ${th('rssi', 'RSSI')}
          <th>Tipo</th>
          <th>Banda</th>
          <th>Pos</th>
          ${th('ts', 'Fecha')}
        </tr>
        ${d.rows.map((m) => `<tr>
          <td>${esc(m.username)}</td><td>${esc(m.ssid)}</td><td>${esc(m.bssid)}</td>
          <td>${m.rssi}</td>
          <td>${isOpen(m.capabilities) ? 'Abierta' : 'Protegida'}</td>
          <td>${bandLabel(m.frequency)}</td>
          <td>${m.latitude.toFixed(4)}, ${m.longitude.toFixed(4)}</td>
          <td>${new Date(m.ts).toLocaleString()}</td>
        </tr>`).join('')}
      </table>
    </div>`;

  $('filtersForm').onsubmit = (e) => {
    e.preventDefault();
    meas.filters = {
      user: $('f_user').value,
      from: $('f_from').value || '',
      to: $('f_to').value || '',
      q: $('f_q').value.trim(),
      mac: $('f_mac').value.trim(),
      type: $('f_type').value,
      band: $('f_band').value,
      sig: $('f_sig').value,
    };
    meas.offset = 0;
    loadMeasurements();
  };
}

function th(col, label) {
  const arrow = meas.sort === col ? (meas.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return `<th style="cursor:pointer" onclick="sortMeas('${col}')">${label}${arrow}</th>`;
}

function sortMeas(col) {
  if (meas.sort === col) {
    meas.dir = meas.dir === 'asc' ? 'desc' : 'asc';
  } else {
    meas.sort = col;
    meas.dir = 'desc';
  }
  meas.offset = 0;
  loadMeasurements();
}

function pageMeas(delta) {
  meas.offset = Math.max(0, meas.offset + delta * meas.limit);
  loadMeasurements();
}
function resetFilters() {
  meas = { offset: 0, limit: 50, filters: {} };
  loadMeasurements();
}

async function clearMeasurements() {
  const r = await Swal.fire({
    icon: 'warning', title: '¿Borrar TODAS las mediciones?',
    text: 'Esta acción no se puede deshacer.',
    showCancelButton: true, confirmButtonText: 'Borrar todo', cancelButtonText: 'Cancelar',
    confirmButtonColor: '#c62828',
  });
  if (!r.isConfirmed) return;
  try {
    await api('/api/admin/measurements', { method: 'DELETE' });
    loadMeasurements();
    Swal.fire({ icon: 'success', title: 'Borradas', timer: 1200, showConfirmButton: false });
  } catch (e) {
    Swal.fire({ icon: 'error', title: 'Error', text: e.message });
  }
}

async function renderConfig() {
  const s = await api('/api/admin/settings');
  $('view-config').innerHTML = `<div class="card"><h2>Configuración</h2>
    <form id="cfgForm">
      <field><label>Intervalo de escaneo (ms)</label><input id="scan_interval_ms" type="number"></field>
      <field><label>Calibración · señal a 1 m (dBm)</label><input id="calibration_tx" type="number" step="1"></field>
      <field><label>Calibración · exponente n</label><input id="calibration_n" type="number" step="0.1"></field>
      <field><label>Resolución hexágonos (H3)</label><input id="hex_res" type="number"></field>
      <field><label>Decaimiento (días)</label><input id="decay_days" type="number" step="0.5"></field>
      <field><label>Umbral de disputa</label><input id="contest_threshold" type="number" step="0.05"></field>
      <field class="full"><button type="submit">Guardar</button></field>
    </form>
    <p class="tip">La app Android descarga estos valores al abrirse y los aplica.</p>
  </div>`;
  for (const k of Object.keys(s)) $(k).value = s[k];
  $('cfgForm').onsubmit = async (e) => {
    e.preventDefault();
    const patch = {};
    for (const k of Object.keys(s)) patch[k] = $(k).value;
    try {
      await api('/api/config', { method: 'PUT', body: JSON.stringify(patch) });
      Swal.fire({ icon: 'success', title: 'Guardado', text: 'Configuración aplicada', timer: 1500, showConfirmButton: false });
    } catch (e) {
      Swal.fire({ icon: 'error', title: 'Error', text: e.message });
    }
  };
}

checkSession();
