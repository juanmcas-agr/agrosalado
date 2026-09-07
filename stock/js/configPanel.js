// Panel de Configuración (CREAR USUARIO / ADMINISTRAR USUARIOS / Cerrar
// sesión) — portado del mismo panel que ya existía en Granos (index.html),
// para que quede accesible desde acá también sin tener que ir a Granos.
// A diferencia de Granos (scripts clásicos, onclick inline funciona porque
// las funciones cuelgan de window), acá todo se cablea con addEventListener
// porque este archivo es un módulo ES.
import { supabase } from './supabaseClient.js';
import { getEstado, cerrarSesion } from './auth.js';
import { cargarRodeos, obtenerRodeosCache, renombrarRodeo } from './rodeos.js';

function el(id) {
  return document.getElementById(id);
}

const ICONO_ENGRANAJE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
const ICONO_FLECHA_IZQUIERDA = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
const ICONO_OJO = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICONO_OJO_TACHADO = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 11 7 11 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 1 12s4 7 11 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>';

function wireMostrarClave(idInput, idBoton) {
  const input = el(idInput);
  const boton = el(idBoton);
  boton.innerHTML = ICONO_OJO;
  boton.addEventListener('click', () => {
    const mostrar = input.type === 'password';
    input.type = mostrar ? 'text' : 'password';
    boton.innerHTML = mostrar ? ICONO_OJO_TACHADO : ICONO_OJO;
  });
}

function abrirPanelConfig() {
  el('panelConfigFondo').classList.add('abierto');
  el('panelConfig').classList.add('abierto');
  fetch('/version.json').then((r) => r.json()).then((d) => {
    el('version-footer-panel').textContent = `v.${d.version}`;
  }).catch(() => {});
  // Dar (o quitar) acceso a las áreas del sistema es una operación que
  // solo puede hacer un owner (ya validado server-side en admin-*.js) —
  // acá además se ocultan esas secciones para el resto.
  const esOwnerActual = getEstado().perfil?.rol === 'owner';
  document.querySelector('.panel-menu-item[data-seccion="crear"]').classList.toggle('oculto-panel', !esOwnerActual);
  document.querySelector('.panel-menu-item[data-seccion="administrar"]').classList.toggle('oculto-panel', !esOwnerActual);
  el('seccionCrear').classList.toggle('oculto-panel', !esOwnerActual);
  el('seccionAdministrar').classList.toggle('oculto-panel', !esOwnerActual);
}

function cerrarPanelConfig() {
  el('panelConfigFondo').classList.remove('abierto');
  el('panelConfig').classList.remove('abierto');
}

// Menú tipo acordeón: un click abre esa sección y cierra las demás; un
// segundo click sobre la misma la cierra.
function toggleSeccionConfig(nombre) {
  const secciones = { crear: 'seccionCrear', administrar: 'seccionAdministrar', rodeos: 'seccionRodeos' };
  const yaAbierta = el(secciones[nombre]).classList.contains('abierta');
  for (const [clave, id] of Object.entries(secciones)) {
    el(id).classList.remove('abierta');
    document.querySelector(`.panel-menu-item[data-seccion="${clave}"]`).classList.remove('activo');
  }
  if (!yaAbierta) {
    el(secciones[nombre]).classList.add('abierta');
    document.querySelector(`.panel-menu-item[data-seccion="${nombre}"]`).classList.add('activo');
    if (nombre === 'administrar') cargarUsuariosPanel();
    if (nombre === 'rodeos') cargarRodeosPanel();
  }
}

async function cerrarSesionDesdePanel() {
  if (!confirm('¿Cerrar sesión?')) return;
  cerrarPanelConfig();
  await cerrarSesion();
}

let usuariosCache = [];
let destinatariosNegocioCache = [];

async function cargarDestinatariosNegocio() {
  const { data, error } = await supabase.from('destinatarios_negocio').select('*').order('nombre');
  if (!error && data) destinatariosNegocioCache = data;
  return destinatariosNegocioCache;
}

function buscarDestinatarioPorEmail(email) {
  const buscado = (email || '').trim().toLowerCase();
  if (!buscado) return null;
  return destinatariosNegocioCache.find((d) => d.email.trim().toLowerCase() === buscado) || null;
}

async function cargarUsuariosPanel() {
  const { data, error } = await supabase.from('perfiles').select('*').order('nombre_completo');
  if (!error && data) usuariosCache = data;
  await cargarDestinatariosNegocio();
  renderListaUsuariosPanel();
}

function renderListaUsuariosPanel() {
  const select = el('cfgListaUsuarios');
  const seleccionPrevia = select.value;
  select.innerHTML = '<option value="">— Elegir usuario para editar —</option>';
  for (const u of usuariosCache) {
    const opt = document.createElement('option');
    opt.value = u.user_id;
    opt.textContent = `${u.nombre_completo} (${u.rol})`;
    select.appendChild(opt);
  }
  select.value = seleccionPrevia;
}

function onSeleccionUsuarioLista() {
  const userId = el('cfgListaUsuarios').value;
  const msj = el('cfgUsuarioEditMensaje');
  msj.textContent = '';
  if (!userId) {
    el('cfgUsuarioEditNombre').value = '';
    el('cfgUsuarioEditEmail').value = '';
    el('cfgUsuarioEditTelefono').value = '';
    el('cfgUsuarioAccesoHacienda').checked = false;
    el('cfgUsuarioAccesoGranos').checked = false;
    el('cfgUsuarioAccesoRel').checked = false;
    el('cfgUsuarioRecibeLiq').checked = false;
    el('cfgUsuarioRecibeHacienda').checked = false;
    el('cfgUsuarioRecibeWhatsapp').checked = false;
    el('cfgUsuarioRecibeAlertasPrecios').checked = false;
    return;
  }
  const usuario = usuariosCache.find((u) => u.user_id === userId);
  if (!usuario) return;
  const destinatario = buscarDestinatarioPorEmail(usuario.email);

  el('cfgUsuarioEditNombre').value = usuario.nombre_completo || '';
  el('cfgUsuarioEditEmail').value = usuario.email || '';
  el('cfgUsuarioEditRol').value = usuario.rol;
  // Un owner siempre tiene acceso total, más allá de lo que digan las
  // casillas — se muestran tildadas y bloqueadas para reflejar eso.
  const esOwner = usuario.rol === 'owner';
  el('cfgUsuarioAccesoHacienda').checked = esOwner || !!usuario.acceso_hacienda;
  el('cfgUsuarioAccesoHacienda').disabled = esOwner;
  el('cfgUsuarioAccesoGranos').checked = esOwner || !!usuario.acceso_granos;
  el('cfgUsuarioAccesoGranos').disabled = esOwner;
  el('cfgUsuarioAccesoRel').checked = esOwner || !!usuario.acceso_precios_relativos;
  el('cfgUsuarioAccesoRel').disabled = esOwner;
  el('cfgUsuarioRecibeLiq').checked = !!(destinatario && destinatario.recibe_liquidaciones);
  el('cfgUsuarioRecibeHacienda').checked = !!(destinatario && destinatario.recibe_hacienda);
  el('cfgUsuarioEditTelefono').value = (destinatario && destinatario.telefono) || '';
  el('cfgUsuarioRecibeWhatsapp').checked = !!(destinatario && destinatario.recibe_whatsapp);
  el('cfgUsuarioRecibeAlertasPrecios').checked = !!(destinatario && destinatario.recibe_alertas_precios);
}

async function guardarCambiosUsuario() {
  const user_id = el('cfgListaUsuarios').value;
  const msj = el('cfgUsuarioEditMensaje');
  msj.textContent = '';
  if (!user_id) { msj.textContent = 'Elegí un usuario de la lista primero.'; msj.className = 'mensaje-panel error'; return; }

  const nombre_completo = el('cfgUsuarioEditNombre').value.trim();
  const email = el('cfgUsuarioEditEmail').value.trim();
  const telefono = el('cfgUsuarioEditTelefono').value.trim();
  const rol = el('cfgUsuarioEditRol').value;
  const acceso_hacienda = el('cfgUsuarioAccesoHacienda').checked;
  const acceso_granos = el('cfgUsuarioAccesoGranos').checked;
  const acceso_precios_relativos = el('cfgUsuarioAccesoRel').checked;
  const recibe_liquidaciones = el('cfgUsuarioRecibeLiq').checked;
  const recibe_hacienda = el('cfgUsuarioRecibeHacienda').checked;
  const recibe_whatsapp = el('cfgUsuarioRecibeWhatsapp').checked;
  const recibe_alertas_precios = el('cfgUsuarioRecibeAlertasPrecios').checked;
  if (!nombre_completo || !email) { msj.textContent = 'Faltan nombre y email.'; msj.className = 'mensaje-panel error'; return; }
  if (recibe_whatsapp && !telefono) { msj.textContent = 'Para recibir WhatsApp hace falta cargar el teléfono.'; msj.className = 'mensaje-panel error'; return; }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { msj.textContent = 'No hay sesión activa.'; msj.className = 'mensaje-panel error'; return; }

  try {
    const res = await fetch('/.netlify/functions/admin-actualizar-usuario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ user_id, nombre_completo, email, telefono, rol, acceso_hacienda, acceso_granos, acceso_precios_relativos, recibe_liquidaciones, recibe_hacienda, recibe_whatsapp, recibe_alertas_precios }),
    });
    const datos = await res.json();
    if (!res.ok) {
      msj.textContent = datos.error || 'No se pudo guardar.';
      msj.className = 'mensaje-panel error';
      return;
    }
    msj.textContent = 'Usuario actualizado.';
    msj.className = 'mensaje-panel ok';
    await cargarUsuariosPanel();
    el('cfgListaUsuarios').value = user_id;
  } catch (error) {
    msj.textContent = 'Error de red: ' + error.message;
    msj.className = 'mensaje-panel error';
  }
}

async function crearUsuario() {
  const nombre_completo = el('cfgUsuarioNombre').value.trim();
  const email = el('cfgUsuarioEmail').value.trim();
  const telefono = el('cfgUsuarioTelefono').value.trim();
  const password = el('cfgUsuarioPassword').value;
  const rol = el('cfgUsuarioRol').value;
  const acceso_hacienda = el('cfgNuevoAccesoHacienda').checked;
  const acceso_granos = el('cfgNuevoAccesoGranos').checked;
  const acceso_precios_relativos = el('cfgNuevoAccesoRel').checked;
  const recibe_liquidaciones = el('cfgNuevoRecibeLiq').checked;
  const recibe_hacienda = el('cfgNuevoRecibeHacienda').checked;
  const recibe_whatsapp = el('cfgNuevoRecibeWhatsapp').checked;
  const recibe_alertas_precios = el('cfgNuevoRecibeAlertasPrecios').checked;
  const msj = el('cfgUsuarioMensaje');
  msj.textContent = '';

  if (!nombre_completo || !email || !password) {
    msj.textContent = 'Completá nombre, email y contraseña.';
    msj.className = 'mensaje-panel error';
    return;
  }
  if (recibe_whatsapp && !telefono) {
    msj.textContent = 'Para recibir WhatsApp hace falta cargar el teléfono.';
    msj.className = 'mensaje-panel error';
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { msj.textContent = 'No hay sesión activa.'; msj.className = 'mensaje-panel error'; return; }

  try {
    const res = await fetch('/.netlify/functions/admin-crear-usuario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ email, password, nombre_completo, telefono, rol, acceso_hacienda, acceso_granos, acceso_precios_relativos, recibe_liquidaciones, recibe_hacienda, recibe_whatsapp, recibe_alertas_precios }),
    });
    const datos = await res.json();
    if (!res.ok) {
      msj.textContent = datos.error || 'No se pudo crear el usuario.';
      msj.className = 'mensaje-panel error';
      return;
    }
    msj.textContent = `Usuario "${nombre_completo}" creado.`;
    msj.className = 'mensaje-panel ok';
    el('cfgUsuarioNombre').value = '';
    el('cfgUsuarioEmail').value = '';
    el('cfgUsuarioTelefono').value = '';
    el('cfgUsuarioPassword').value = '';
    el('cfgNuevoAccesoHacienda').checked = true;
    el('cfgNuevoAccesoGranos').checked = false;
    el('cfgNuevoAccesoRel').checked = false;
    el('cfgNuevoRecibeLiq').checked = true;
    el('cfgNuevoRecibeHacienda').checked = false;
    el('cfgNuevoRecibeWhatsapp').checked = false;
    el('cfgNuevoRecibeAlertasPrecios').checked = false;
    cargarUsuariosPanel();
  } catch (error) {
    msj.textContent = 'Error de red: ' + error.message;
    msj.className = 'mensaje-panel error';
  }
}

async function cambiarClaveUsuario() {
  const user_id = el('cfgListaUsuarios').value;
  const password = el('cfgClaveNueva').value;
  const msj = el('cfgUsuarioEditMensaje');
  msj.textContent = '';

  if (!user_id || !password) {
    msj.textContent = 'Elegí un usuario de la lista y escribí la contraseña nueva.';
    msj.className = 'mensaje-panel error';
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { msj.textContent = 'No hay sesión activa.'; msj.className = 'mensaje-panel error'; return; }

  try {
    const res = await fetch('/.netlify/functions/admin-cambiar-clave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ user_id, password }),
    });
    const datos = await res.json();
    if (!res.ok) {
      msj.textContent = datos.error || 'No se pudo cambiar la contraseña.';
      msj.className = 'mensaje-panel error';
      return;
    }
    msj.textContent = 'Contraseña actualizada.';
    msj.className = 'mensaje-panel ok';
    el('cfgClaveNueva').value = '';
  } catch (error) {
    msj.textContent = 'Error de red: ' + error.message;
    msj.className = 'mensaje-panel error';
  }
}

// ─── Renombrar rodeo ───

async function cargarRodeosPanel() {
  await cargarRodeos();
  renderListaRodeosPanel();
}

function renderListaRodeosPanel() {
  const select = el('cfgListaRodeos');
  const seleccionPrevia = select.value;
  select.innerHTML = '<option value="">— Elegir rodeo —</option>';
  for (const r of obtenerRodeosCache()) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.codigo;
    select.appendChild(opt);
  }
  select.value = seleccionPrevia;
}

function onSeleccionRodeoLista() {
  const rodeoId = el('cfgListaRodeos').value;
  el('cfgRodeoMensaje').textContent = '';
  const rodeo = obtenerRodeosCache().find((r) => r.id === rodeoId);
  el('cfgRodeoNombreNuevo').value = rodeo ? rodeo.nombre : '';
}

async function guardarNombreRodeo() {
  const rodeoId = el('cfgListaRodeos').value;
  const nombreNuevo = el('cfgRodeoNombreNuevo').value.trim();
  const msj = el('cfgRodeoMensaje');
  msj.textContent = '';
  if (!rodeoId) { msj.textContent = 'Elegí un rodeo de la lista primero.'; msj.className = 'mensaje-panel error'; return; }
  if (!nombreNuevo) { msj.textContent = 'Escribí el nombre nuevo.'; msj.className = 'mensaje-panel error'; return; }
  try {
    const actualizado = await renombrarRodeo(rodeoId, nombreNuevo);
    msj.textContent = `Renombrado a "${actualizado.codigo}".`;
    msj.className = 'mensaje-panel ok';
    renderListaRodeosPanel();
    el('cfgListaRodeos').value = rodeoId;
  } catch (error) {
    msj.textContent = 'No se pudo renombrar: ' + error.message;
    msj.className = 'mensaje-panel error';
  }
}

export function initConfigPanel() {
  el('botonConfig').innerHTML = ICONO_ENGRANAJE;
  el('botonConfig').addEventListener('click', abrirPanelConfig);
  el('botonCerrarPanel').innerHTML = ICONO_FLECHA_IZQUIERDA;
  el('botonCerrarPanel').addEventListener('click', cerrarPanelConfig);
  el('panelConfigFondo').addEventListener('click', cerrarPanelConfig);
  document.querySelectorAll('.panel-menu-item[data-seccion]').forEach((btn) => {
    btn.addEventListener('click', () => toggleSeccionConfig(btn.dataset.seccion));
  });
  el('botonCrearUsuario').addEventListener('click', crearUsuario);
  el('cfgListaUsuarios').addEventListener('change', onSeleccionUsuarioLista);
  el('botonGuardarUsuario').addEventListener('click', guardarCambiosUsuario);
  el('botonCambiarClave').addEventListener('click', cambiarClaveUsuario);
  el('botonCerrarSesionPanel').addEventListener('click', cerrarSesionDesdePanel);
  wireMostrarClave('cfgUsuarioPassword', 'cfgUsuarioMostrarClave');
  wireMostrarClave('cfgClaveNueva', 'cfgClaveMostrarClave');
  el('cfgListaRodeos').addEventListener('change', onSeleccionRodeoLista);
  el('botonRenombrarRodeo').addEventListener('click', guardarNombreRodeo);
}
