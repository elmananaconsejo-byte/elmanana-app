// ============================================================
// El Mañana PWA – lógica principal (Vanilla JS, sin frameworks)
// ============================================================

const state = {
  token: null,        // ID token de Google
  email: null,
  user: null,
  currentScreen: 'login',
};

/* ----------------------- API helpers (JSONP) ----------------------- */
/**
 * Apps Script solo expone CORS para requests que terminan OK.
 * JSONP esquiva CORS: inyecta un <script> con ?callback=fnName
 * y el backend envuelve la respuesta en esa función.
 */

let _jsonpCounter = 0;
function apiCall(action, params = {}) {
  return new Promise((resolve, reject) => {
    const cb = '_jsonp_cb_' + (++_jsonpCounter);
    const url = new URL(window.API_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('callback', cb);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const script = document.createElement('script');
    let done = false;
    const cleanup = () => {
      delete window[cb];
      if (script.parentNode) script.parentNode.removeChild(script);
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true; cleanup();
      reject(new Error('Timeout al llamar a la API'));
    }, 15000);

    window[cb] = (data) => {
      done = true; clearTimeout(timer); cleanup();
      resolve(data);
    };
    script.onerror = () => {
      if (done) return;
      done = true; clearTimeout(timer); cleanup();
      reject(new Error('No se pudo contactar el backend'));
    };
    script.src = url.toString();
    document.body.appendChild(script);
  });
}

// alias para mantener compatibilidad con el resto del código
const apiGet  = (action, params = {}) => apiCall(action, params);
const apiPost = (action, params = {}) => apiCall(action, params);

/* ----------------------- UI helpers ----------------------- */

function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), ms);
}

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  state.currentScreen = id;

  // Topbar visibility
  const topbar = document.getElementById('topbar');
  const nav = document.getElementById('nav');
  if (['login', 'register', 'pending'].includes(id)) {
    topbar.classList.add('hidden');
    nav.classList.add('hidden');
  } else {
    topbar.classList.remove('hidden');
    nav.classList.remove('hidden');
  }

  // Back button
  document.getElementById('backBtn').style.visibility =
    (['home'].includes(id)) ? 'hidden' : 'visible';

  // Title
  const titles = {
    home: window.APP_NAME, pqrs: 'Mis PQRS', 'pqrs-new': 'Nueva PQRS',
    admin: 'Administración', carnet: 'Mi carnet',
  };
  document.getElementById('topTitle').textContent = titles[id] || window.APP_NAME;

  // Sync bottom nav
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.go === id || (b.dataset.go === 'home' && id === 'admin'));
  });
}

function setLocalSession(email, name) {
  localStorage.setItem('em_email', email);
  if (name) localStorage.setItem('em_name', name);
}
function getLocalEmail() { return localStorage.getItem('em_email'); }
function clearLocalSession() { localStorage.removeItem('em_email'); localStorage.removeItem('em_name'); }

/* ----------------------- Google Sign-In ----------------------- */

function parseJwt(token) {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(atob(base64).split('').map(c =>
    '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
  return JSON.parse(json);
}

function onGoogleCredential(response) {
  const payload = parseJwt(response.credential);
  state.token = response.credential;
  state.email = payload.email;
  setLocalSession(payload.email, payload.name);
  doLogin(payload);
}

function initGoogleSignIn() {
  if (!window.google || !window.google.accounts) {
    setTimeout(initGoogleSignIn, 300);
    return;
  }
  window.google.accounts.id.initialize({
    client_id: window.GOOGLE_CLIENT_ID,
    callback: onGoogleCredential,
  });
  window.google.accounts.id.renderButton(
    document.getElementById('googleBtn'),
    { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', width: 280 }
  );
}

/* ----------------------- Flows ----------------------- */

function doLogin(payload) {
  apiGet('login', { email: payload.email }).then(res => {
    if (res.error) return toast('Error: ' + res.error);
    if (res.status === 'ok') {
      state.user = res.user;
      afterLoginOK();
    } else if (res.status === 'pending') {
      state.user = res.user;
      show('pending');
    } else if (res.status === 'rejected') {
      toast('Tu registro fue rechazado. Contacta a la administración.');
    } else if (res.status === 'inactive') {
      toast('Tu cuenta está inactiva. Contacta a la administración.');
    } else if (res.status === 'not_registered') {
      // Pre-poblar registro con nombre del token si viene
      const form = document.getElementById('registerForm');
      form.nombre.value = payload.name || '';
      show('register');
    }
  });
}

function afterLoginOK() {
  const u = state.user;
  document.getElementById('greet').textContent =
    `Hola, ${String(u.nombre).split(' ')[0] || u.email}`;
  document.getElementById('admin-shortcut').classList.toggle('hidden', u.rol !== 'Administrador');
  show('home');
  loadMuro();
}

/* ----------------------- Muro ----------------------- */

function loadMuro() {
  const cont = document.getElementById('muro');
  cont.innerHTML = '<div class="empty">Cargando…</div>';
  apiGet('listActivities').then(res => {
    if (!res.items || !res.items.length) {
      cont.innerHTML = '<div class="empty">Aún no hay publicaciones.</div>';
      return;
    }
    const sorted = [...res.items].sort((a, b) => (b.destacada?1:0) - (a.destacada?1:0));
    cont.innerHTML = sorted.map(a => renderActivity(a)).join('');
  });
}

function renderActivity(a) {
  const img = a.imagen ? `<img src="${escapeHtml(a.imagen)}" alt="" />` : '';
  const cat = (a.categoria || 'Noticia').toLowerCase();
  const fecha = formatDate(a.fechaPublicacion);
  const evento = a.fechaEvento ? ` · 📅 ${formatDate(a.fechaEvento)}` : '';
  const lugar  = a.lugar ? ` · 📍 ${escapeHtml(a.lugar)}` : '';
  return `
  <div class="card ${a.destacada ? 'destacada' : ''}">
    <div class="meta"><span class="pill ${cat}">${escapeHtml(a.categoria || 'Noticia')}</span>${fecha}${evento}${lugar}</div>
    <h4>${escapeHtml(a.titulo)}</h4>
    ${img}
    <p>${escapeHtml(a.descripcion || '')}</p>
  </div>`;
}

/* ----------------------- PQRS (residente) ----------------------- */

function loadPqrs() {
  const cont = document.getElementById('pqrs-list');
  cont.innerHTML = '<div class="empty">Cargando…</div>';
  apiGet('listPqrs', { email: state.email }).then(res => {
    if (!res.items || !res.items.length) {
      cont.innerHTML = '<div class="empty">Aún no has enviado PQRS.</div>';
      return;
    }
    cont.innerHTML = res.items.map(p => renderPqrs(p, false)).join('');
  });
}

function renderPqrs(p, adminMode) {
  const estado = (p.estado || 'Nuevo').replace(' ', '_');
  const respuesta = p.respuesta ? `<p><b>Respuesta:</b> ${escapeHtml(p.respuesta)}</p>` : '';
  const adminExtra = adminMode ? `
    <div class="muted" style="font-size:12px">${escapeHtml(p.nombre || '')} · ${escapeHtml(p.torreApto || '')}</div>
    <div class="actions">
      <button class="respond" onclick="openResponse('${p.id}')">Responder</button>
    </div>` : '';
  return `
  <div class="card">
    <div class="header">
      <strong>${escapeHtml(p.asunto)}</strong>
      <span class="estado estado-${estado}">${escapeHtml(p.estado || 'Nuevo')}</span>
    </div>
    <div class="muted" style="font-size:12px; margin: 4px 0">${escapeHtml(p.tipo || '')} · ${formatDate(p.fecha)}</div>
    <p>${escapeHtml(p.descripcion || '')}</p>
    ${respuesta}
    ${adminExtra}
  </div>`;
}

/* ----------------------- Admin ----------------------- */

function loadAdminTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach(d => d.classList.toggle('active', d.id === 'tab-' + tab));
  if (tab === 'solicitudes') loadSolicitudes();
  if (tab === 'pqrs') loadAllPqrs();
}

function loadSolicitudes() {
  const cont = document.getElementById('solicitudes-list');
  cont.innerHTML = '<div class="empty">Cargando…</div>';
  apiGet('listPendingUsers', { email: state.email }).then(res => {
    if (!res.items || !res.items.length) {
      cont.innerHTML = '<div class="empty">No hay solicitudes pendientes 🙌</div>';
      return;
    }
    cont.innerHTML = res.items.map(u => `
      <div class="card">
        <strong>${escapeHtml(u.nombre || u.email)}</strong>
        <div class="muted" style="font-size:12px">${escapeHtml(u.email)} · ${escapeHtml(u.torre || '')}-${escapeHtml(u.apartamento || '')}</div>
        <div class="muted" style="font-size:12px">C.C. ${escapeHtml(u.cedula || '')} · Tel. ${escapeHtml(u.telefono || '')}</div>
        <div class="actions">
          <button class="approve" onclick="approveUser('${u.email}')">Aprobar</button>
          <button class="reject" onclick="rejectUser('${u.email}')">Rechazar</button>
        </div>
      </div>`).join('');
  });
}

function approveUser(email) {
  if (!confirm('¿Aprobar este residente?')) return;
  apiPost('approveUser', { email: state.email, targetEmail: email }).then(r => {
    if (r.status === 'ok') { toast('Aprobado ✅'); loadSolicitudes(); }
    else toast('No se pudo: ' + (r.error || r.status));
  });
}
function rejectUser(email) {
  if (!confirm('¿Rechazar este residente?')) return;
  apiPost('rejectUser', { email: state.email, targetEmail: email }).then(r => {
    if (r.status === 'ok') { toast('Rechazado'); loadSolicitudes(); }
    else toast('No se pudo: ' + (r.error || r.status));
  });
}

function loadAllPqrs() {
  const cont = document.getElementById('all-pqrs-list');
  cont.innerHTML = '<div class="empty">Cargando…</div>';
  apiGet('listPqrs', { email: state.email }).then(res => {
    if (!res.items || !res.items.length) {
      cont.innerHTML = '<div class="empty">Sin PQRS registradas.</div>';
      return;
    }
    cont.innerHTML = res.items.map(p => renderPqrs(p, true)).join('');
  });
}

function openResponse(id) {
  const respuesta = prompt('Respuesta para el residente:');
  if (respuesta === null) return;
  const estado = prompt('Nuevo estado (En_Gestion / Resuelto / Cerrado):', 'Resuelto');
  if (!estado) return;
  apiPost('respondPqrs', { email: state.email, id, respuesta, estado }).then(r => {
    if (r.status === 'ok') { toast('Respuesta guardada ✅'); loadAllPqrs(); }
    else toast('No se pudo: ' + (r.error || r.status));
  });
}

/* ----------------------- Carnet ----------------------- */

function renderCarnet() {
  const u = state.user || {};
  document.getElementById('carnet-id').textContent = u.id || '';
  document.getElementById('carnet-nombre').textContent = u.nombre || u.email || '';
  document.getElementById('carnet-ubicacion').textContent = (u.torre || '') + ' · Apto ' + (u.apartamento || '');
  document.getElementById('carnet-cedula').textContent = u.cedula || '';
  document.getElementById('carnet-telefono').textContent = u.telefono || '';
  document.getElementById('carnet-estado').textContent = u.estado || '';
}

/* ----------------------- Formularios ----------------------- */

document.getElementById('registerForm').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    email: state.email,
    nombre: fd.get('nombre'),
    cedula: fd.get('cedula'),
    telefono: fd.get('telefono'),
    torre: fd.get('torre'),
    apartamento: fd.get('apartamento'),
  };
  apiPost('register', payload).then(r => {
    if (r.status === 'ok') { state.user = r.user; afterLoginOK(); }
    else if (r.status === 'pending' || r.status === 'already') {
      state.user = r.user; show('pending');
    } else {
      toast('Error: ' + (r.error || 'no se pudo registrar'));
    }
  });
});

document.getElementById('pqrsForm').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    email: state.email,
    tipo: fd.get('tipo'),
    asunto: fd.get('asunto'),
    descripcion: fd.get('descripcion'),
  };
  apiPost('createPqrs', payload).then(r => {
    if (r.status === 'ok') {
      toast('¡Recibimos tu solicitud! Respuesta en máx. 5 días hábiles.');
      e.target.reset();
      show('pqrs'); loadPqrs();
    } else {
      toast('Error: ' + (r.error || 'no se pudo enviar'));
    }
  });
});

document.getElementById('activityForm').addEventListener('submit', e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    email: state.email,
    titulo: fd.get('titulo'),
    descripcion: fd.get('descripcion'),
    imagen: fd.get('imagen'),
    fechaEvento: fd.get('fechaEvento'),
    lugar: fd.get('lugar'),
    categoria: fd.get('categoria'),
    destacada: fd.get('destacada') ? 'true' : 'false',
  };
  apiPost('publishActivity', payload).then(r => {
    if (r.status === 'ok') { toast('Publicado en el muro ✅'); e.target.reset(); show('home'); loadMuro(); }
    else toast('Error: ' + (r.error || 'no se pudo publicar'));
  });
});

/* ----------------------- Navegación ----------------------- */

document.querySelectorAll('.nav-btn').forEach(b => {
  b.addEventListener('click', () => {
    const go = b.dataset.go;
    if (go === 'home') { show('home'); loadMuro(); }
    if (go === 'pqrs') { show('pqrs'); loadPqrs(); }
    if (go === 'carnet') { renderCarnet(); show('carnet'); }
  });
});

document.getElementById('backBtn').addEventListener('click', () => {
  if (['pqrs-new'].includes(state.currentScreen)) { show('pqrs'); loadPqrs(); return; }
  if (['admin'].includes(state.currentScreen))    { show('home'); loadMuro(); return; }
  show('home'); loadMuro();
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  clearLocalSession(); state.email = null; state.user = null;
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  show('login');
});

document.getElementById('btnNuevaPqrs').addEventListener('click', () => show('pqrs-new'));
document.getElementById('btnAdminPanel').addEventListener('click', () => { show('admin'); loadAdminTab('solicitudes'); });
document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => loadAdminTab(b.dataset.tab)));

/* ----------------------- Utils ----------------------- */

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ----------------------- Arranque ----------------------- */

window.addEventListener('load', () => {
  initGoogleSignIn();
  const savedEmail = getLocalEmail();
  if (savedEmail) {
    state.email = savedEmail;
    // Reintentar login silencioso: consulta al backend si sigue activo
    apiGet('me', { email: savedEmail }).then(res => {
      if (res.status === 'ok') {
        state.user = res.user;
        if (res.user.estado === 'Aprobado') afterLoginOK();
        else show('pending');
      } else {
        show('login');
      }
    }).catch(() => show('login'));
  } else {
    show('login');
  }
});
