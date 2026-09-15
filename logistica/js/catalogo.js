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

function renderTransportistas() {
  const tbody = el('cat-transportistas-tabla').querySelector('tbody');
  if (!transportistasCache.length) {
    tbody.innerHTML = '<tr><td colspan="7">Sin transportistas cargados.</td></tr>';
    return;
  }
  const esOwner = getEstado().perfil?.rol === 'owner';
  tbody.innerHTML = '';
  for (const t of transportistasCache) {
    const tr = document.createElement('tr');
    if (!t.activo) tr.classList.add('anulado');
    tr.innerHTML = `
      <td>${t.nombre_completo}</td>
      <td>${t.email}</td>
      <td>${t.categoria === 'propio' ? 'Chofer' : 'Transportista'}</td>
      <td>${t.empresa || ''}</td>
      <td>${t.cuit || ''}</td>
      <td>${t.activo ? 'Activo' : 'Inactivo'}</td>
      <td></td>
    `;
    if (esOwner) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'boton-secundario';
      btn.textContent = 'Editar';
      btn.addEventListener('click', () => mostrarFormTransportista('editar', t));
      tr.lastElementChild.appendChild(btn);
    }
    tbody.appendChild(tr);
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
  if (categoria === 'propio') {
    nombre_completo = el('cat-transportista-nombre').value.trim();
    if (!nombre_completo) { mensaje.textContent = 'Falta el nombre del chofer.'; mensaje.className = 'error'; return; }
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
    ? { user_id: userId, nombre_completo, email, empresa, cuit, categoria, activo }
    : { email, password, nombre_completo, empresa, cuit, categoria };

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
  await Promise.all([cargarTransportistas(), cargarCamiones()]);
}

export function initCatalogo() {
  const esOwner = getEstado().perfil?.rol === 'owner';
  el('cat-transportista-nuevo').classList.toggle('oculto', !esOwner);
  el('cat-transportista-nuevo').addEventListener('click', () => mostrarFormTransportista('nuevo', null));
  el('cat-transportista-form').addEventListener('submit', guardarTransportista);
  el('cat-transportista-cancelar').addEventListener('click', ocultarFormTransportista);
  document.querySelectorAll('input[name="cat-transportista-categoria"]').forEach((r) => {
    r.addEventListener('change', actualizarCamposSegunCategoria);
  });
  el('cat-camion-form').addEventListener('submit', agregarCamion);
}
