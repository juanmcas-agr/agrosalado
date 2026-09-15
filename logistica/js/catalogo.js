// Catálogo de transportistas y camiones (M2). Transportistas: el alta y
// la edición van siempre por las funciones admin-*-transportista.js
// (service role, owner-only) — transportistas no tiene policy de insert/
// update para clientes normales, mismo criterio que perfiles. Camiones sí
// se pueden crear/editar directo (RLS ya lo permite a cualquier staff),
// no hace falta función de servidor para un catálogo de bajo riesgo.
import { supabase } from './supabaseClient.js';
import { getEstado } from './auth.js';

function el(id) {
  return document.getElementById(id);
}

// ─── Transportistas ───────────────────────────────────────────────────

let transportistasCache = [];

// El alta/edición de transportistas la puede hacer owner o administrativo
// (antes era owner-only) — mismo criterio para mostrar el botón "Editar"
// y "+ Nuevo Usuario" que el que valida el servidor (admin-*-
// transportista.js).
function puedeGestionarTransportistas() {
  const rol = getEstado().perfil?.rol;
  return rol === 'owner' || rol === 'administrativo';
}

function nombreCamion(camionId) {
  const c = camionesCache.find((x) => x.id === camionId);
  return c ? `${c.patente}${c.descripcion ? ' — ' + c.descripcion : ''}` : '';
}

function filaTransportista(t, permitido) {
  const tr = document.createElement('tr');
  if (!t.activo) tr.classList.add('anulado');
  if (t.categoria === 'propio') {
    tr.innerHTML = `
      <td>${t.nombre_completo}</td>
      <td>${t.email}</td>
      <td>${t.cuit || ''}</td>
      <td>${nombreCamion(t.camion_default_id)}</td>
      <td>${t.activo ? 'Activo' : 'Inactivo'}</td>
      <td></td>
    `;
  } else {
    tr.innerHTML = `
      <td>${t.nombre_completo}</td>
      <td>${t.email}</td>
      <td>${t.cuit || ''}</td>
      <td>${t.activo ? 'Activo' : 'Inactivo'}</td>
      <td></td>
    `;
  }
  if (permitido) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'boton-secundario';
    btn.textContent = 'Editar';
    btn.addEventListener('click', () => mostrarFormTransportista('editar', t));
    tr.lastElementChild.appendChild(btn);
  }
  return tr;
}

// Choferes y Transportistas van en dos cuadros separados — mismo listado
// (transportistasCache), solo se divide por categoria al renderizar.
function renderTransportistas() {
  const permitido = puedeGestionarTransportistas();
  const choferes = transportistasCache.filter((t) => t.categoria === 'propio');
  const externos = transportistasCache.filter((t) => t.categoria === 'externo');

  const tbodyChoferes = el('cat-choferes-tabla').querySelector('tbody');
  if (!choferes.length) {
    tbodyChoferes.innerHTML = '<tr><td colspan="6">Sin choferes cargados.</td></tr>';
  } else {
    tbodyChoferes.innerHTML = '';
    for (const t of choferes) tbodyChoferes.appendChild(filaTransportista(t, permitido));
  }

  const tbodyExternos = el('cat-externos-tabla').querySelector('tbody');
  if (!externos.length) {
    tbodyExternos.innerHTML = '<tr><td colspan="5">Sin transportistas cargados.</td></tr>';
  } else {
    tbodyExternos.innerHTML = '';
    for (const t of externos) tbodyExternos.appendChild(filaTransportista(t, permitido));
  }
}

export async function cargarTransportistas() {
  const mensaje = el('cat-transportistas-mensaje');
  mensaje.textContent = '';
  const { data, error } = await supabase.from('transportistas').select('*').order('nombre_completo');
  if (error) {
    mensaje.textContent = `No se pudo cargar (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
    return;
  }
  transportistasCache = data;
  renderTransportistas();
}

function limpiarFormTransportista() {
  el('cat-transportista-user-id').value = '';
  el('cat-transportista-nombre').value = '';
  el('cat-transportista-empresa').value = '';
  el('cat-transportista-email').value = '';
  el('cat-transportista-cuit').value = '';
  el('cat-transportista-camion').value = '';
  el('cat-transportista-password').value = '';
  el('cat-transportista-activo').checked = true;
  document.querySelectorAll('input[name="cat-transportista-categoria"]').forEach((r) => { r.checked = false; });
  actualizarCamposSegunCategoria();
}

// Chofer (propio) pide Nombre; Transportista (externo) pide Empresa en vez
// de Nombre (nombre_completo se arma de "empresa" al guardar, ver
// guardarTransportista) — nunca ambos a la vez, y nunca queda "required"
// mientras está oculto (si no, el navegador bloquea el submit en
// silencio, sin mensaje visible). Email y CUIT son siempre visibles,
// para las dos categorías.
function actualizarCamposSegunCategoria() {
  const categoria = categoriaSeleccionada();
  const esChofer = categoria === 'propio';
  const esTransportista = categoria === 'externo';
  el('cat-transportista-nombre-wrap').classList.toggle('oculto', !esChofer);
  el('cat-transportista-nombre').required = esChofer;
  // Camión por defecto: solo tiene sentido para un chofer (usa la flota de
  // Agro Salado); un transportista externo trae la suya propia.
  el('cat-transportista-camion-wrap').classList.toggle('oculto', !esChofer);
  el('cat-transportista-empresa-wrap').classList.toggle('oculto', !esTransportista);
  el('cat-transportista-empresa').required = esTransportista;
}

function mostrarFormTransportista(modo, transportista) {
  el('cat-transportista-form-bloque').classList.remove('oculto');
  el('cat-transportista-form-titulo').textContent = modo === 'editar' ? 'Editar Usuario' : 'Nuevo Usuario';
  el('cat-transportista-password-wrap').classList.toggle('oculto', modo === 'editar');
  el('cat-transportista-password').required = modo !== 'editar';
  if (modo === 'editar' && transportista) {
    el('cat-transportista-user-id').value = transportista.user_id;
    el('cat-transportista-nombre').value = transportista.nombre_completo;
    el('cat-transportista-empresa').value = transportista.empresa || '';
    el('cat-transportista-email').value = transportista.email;
    el('cat-transportista-cuit').value = transportista.cuit || '';
    el('cat-transportista-camion').value = transportista.camion_default_id || '';
    el('cat-transportista-activo').checked = transportista.activo;
    document.querySelectorAll('input[name="cat-transportista-categoria"]').forEach((r) => { r.checked = r.value === transportista.categoria; });
    actualizarCamposSegunCategoria();
  } else {
    limpiarFormTransportista();
  }
}

function ocultarFormTransportista() {
  el('cat-transportista-form-bloque').classList.add('oculto');
  limpiarFormTransportista();
}

function categoriaSeleccionada() {
  return document.querySelector('input[name="cat-transportista-categoria"]:checked')?.value || '';
}

async function guardarTransportista(evento) {
  evento.preventDefault();
  const mensaje = el('cat-transportistas-mensaje');
  mensaje.textContent = '';

  const userId = el('cat-transportista-user-id').value;
  const categoria = categoriaSeleccionada();
  const email = el('cat-transportista-email').value.trim();
  const cuit = el('cat-transportista-cuit').value.trim();
  const activo = el('cat-transportista-activo').checked;
  const password = el('cat-transportista-password').value;

  if (!categoria) {
    mensaje.textContent = 'Elegí si es Chofer o Transportista.';
    mensaje.className = 'error';
    return;
  }
  if (!email) {
    mensaje.textContent = 'Falta el email.';
    mensaje.className = 'error';
    return;
  }
  if (!cuit) {
    mensaje.textContent = 'Falta el CUIT.';
    mensaje.className = 'error';
    return;
  }

  // Un chofer se identifica por su nombre; un transportista (empresa) no
  // tiene un campo de nombre aparte — la razón social ES su nombre.
  let nombre_completo;
  let empresa = null;
  let camion_default_id = null;
  if (categoria === 'propio') {
    nombre_completo = el('cat-transportista-nombre').value.trim();
    if (!nombre_completo) { mensaje.textContent = 'Falta el nombre del chofer.'; mensaje.className = 'error'; return; }
    camion_default_id = el('cat-transportista-camion').value || null;
  } else {
    empresa = el('cat-transportista-empresa').value.trim();
    if (!empresa) { mensaje.textContent = 'Falta la empresa.'; mensaje.className = 'error'; return; }
    nombre_completo = empresa;
  }

  if (!userId && !password) {
    mensaje.textContent = 'Para un usuario nuevo hace falta una contraseña.';
    mensaje.className = 'error';
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { mensaje.textContent = 'No hay sesión activa.'; mensaje.className = 'error'; return; }

  const endpoint = userId ? 'admin-actualizar-transportista' : 'admin-crear-transportista';
  const body = userId
    ? { user_id: userId, nombre_completo, email, empresa, cuit, camion_default_id, categoria, activo }
    : { email, password, nombre_completo, empresa, cuit, camion_default_id, categoria };

  try {
    const res = await fetch(`/.netlify/functions/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    const datos = await res.json();
    if (!res.ok) {
      mensaje.textContent = datos.error || 'No se pudo guardar.';
      mensaje.className = 'error';
      return;
    }
    ocultarFormTransportista();
    await cargarTransportistas();
    // Recién acá, después de recargar — cargarTransportistas() empieza
    // limpiando este mismo mensaje, así que setearlo antes se perdía solo.
    mensaje.textContent = userId ? 'Usuario actualizado.' : 'Usuario creado.';
    mensaje.className = 'ok';
  } catch (error) {
    mensaje.textContent = 'Error de red: ' + error.message;
    mensaje.className = 'error';
  }
}

// ─── Camiones ──────────────────────────────────────────────────────────

let camionesCache = [];

function renderCamiones() {
  const tbody = el('cat-camiones-tabla').querySelector('tbody');
  if (!camionesCache.length) {
    tbody.innerHTML = '<tr><td colspan="3">Sin camiones cargados.</td></tr>';
    return;
  }
  tbody.innerHTML = camionesCache.map((c) => `
    <tr${c.activo ? '' : ' class="anulado"'}>
      <td>${c.patente}</td>
      <td>${c.descripcion || ''}</td>
      <td>${c.activo ? 'Activo' : 'Inactivo'}</td>
    </tr>
  `).join('');
}

export async function cargarCamiones() {
  const mensaje = el('cat-camiones-mensaje');
  mensaje.textContent = '';
  const { data, error } = await supabase.from('camiones').select('*').order('patente');
  if (error) {
    mensaje.textContent = `No se pudo cargar (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
    return;
  }
  camionesCache = data;
  renderCamiones();
  poblarSelectCamionDefault();
}

// Solo camiones activos, para no dejar asignar como "por defecto" uno ya
// dado de baja.
function poblarSelectCamionDefault() {
  const select = el('cat-transportista-camion');
  select.innerHTML = '<option value="">Sin definir</option>'
    + camionesCache.filter((c) => c.activo).map((c) => `<option value="${c.id}">${c.patente}${c.descripcion ? ' — ' + c.descripcion : ''}</option>`).join('');
}

async function agregarCamion(evento) {
  evento.preventDefault();
  const mensaje = el('cat-camiones-mensaje');
  mensaje.textContent = '';
  const patente = el('cat-camion-patente').value.trim().toUpperCase();
  const descripcion = el('cat-camion-descripcion').value.trim() || null;
  if (!patente) { mensaje.textContent = 'Falta la patente.'; mensaje.className = 'error'; return; }

  const { error } = await supabase.from('camiones').insert({ patente, descripcion });
  if (error) {
    mensaje.textContent = `No se pudo guardar: ${error.message}`;
    mensaje.className = 'error';
    return;
  }
  el('cat-camion-patente').value = '';
  el('cat-camion-descripcion').value = '';
  await cargarCamiones();
}

export async function cargarCatalogo() {
  // Secuencial (no Promise.all): renderTransportistas() necesita
  // camionesCache ya cargado para mostrar el "Camión por defecto" de cada
  // chofer.
  await cargarCamiones();
  await cargarTransportistas();
}

export function initCatalogo() {
  const permitido = puedeGestionarTransportistas();
  el('cat-transportista-nuevo').classList.toggle('oculto', !permitido);
  el('cat-transportista-nuevo').addEventListener('click', () => mostrarFormTransportista('nuevo', null));
  el('cat-transportista-form').addEventListener('submit', guardarTransportista);
  el('cat-transportista-cancelar').addEventListener('click', ocultarFormTransportista);
  document.querySelectorAll('input[name="cat-transportista-categoria"]').forEach((r) => {
    r.addEventListener('change', actualizarCamposSegunCategoria);
  });
  el('cat-camion-form').addEventListener('submit', agregarCamion);
}
