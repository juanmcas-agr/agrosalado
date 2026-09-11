// Lado staff: cerrar o reabrir el mes de un transportista propio. Solo
// tiene efecto real para quien tenga acceso_logistica_sueldos u owner —
// la RLS de cierres_periodo_propio (M1) ya lo exige, esta pantalla
// además se oculta del todo para el resto del staff (ver app.js/router.js)
// para no mostrar una pantalla que de todos modos va a fallar por RLS.
import { supabase } from './supabaseClient.js';
import { getEstado } from './auth.js';

function el(id) {
  return document.getElementById(id);
}

let propiosCache = [];
let cierresCache = [];

const NOMBRES_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

async function cargarPropios() {
  const { data, error } = await supabase.from('transportistas').select('*').eq('categoria', 'propio').order('nombre_completo');
  if (error) {
    console.error('No se pudieron cargar los transportistas propios:', error);
    return;
  }
  propiosCache = data;
  el('cm-transportista').innerHTML = propiosCache.map((t) => `<option value="${t.user_id}">${t.nombre_completo}</option>`).join('');
}

async function reabrirMes(c) {
  if (!confirm(`¿Reabrir ${NOMBRES_MES[c.mes - 1]} ${c.anio}? El chofer va a volver a ver esos viajes y va a poder editarlos.`)) return;
  const mensaje = el('cm-mensaje');
  mensaje.textContent = '';
  const { error } = await supabase.from('cierres_periodo_propio').delete().eq('id', c.id);
  if (error) {
    mensaje.textContent = `No se pudo reabrir: ${error.message}`;
    mensaje.className = 'error';
    return;
  }
  await cargarCierresDelPropio();
  mensaje.textContent = `${NOMBRES_MES[c.mes - 1]} ${c.anio} reabierto.`;
  mensaje.className = 'ok';
}

function renderCierres() {
  const tbody = el('cm-tabla').querySelector('tbody');
  if (!cierresCache.length) {
    tbody.innerHTML = '<tr><td colspan="4">Sin meses cerrados todavía.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const c of [...cierresCache].sort((a, b) => b.anio - a.anio || b.mes - a.mes)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.anio}</td>
      <td>${NOMBRES_MES[c.mes - 1]}</td>
      <td>${new Date(c.cerrado_at).toLocaleDateString('es-AR')}</td>
      <td></td>
    `;
    const btnReabrir = document.createElement('button');
    btnReabrir.type = 'button';
    btnReabrir.className = 'boton-anular';
    btnReabrir.textContent = 'Reabrir';
    btnReabrir.addEventListener('click', () => reabrirMes(c));
    tr.lastElementChild.appendChild(btnReabrir);
    tbody.appendChild(tr);
  }
}

export async function cargarCierresDelPropio() {
  const mensaje = el('cm-mensaje');
  mensaje.textContent = '';
  const transportistaId = el('cm-transportista').value;
  if (!transportistaId) {
    cierresCache = [];
    renderCierres();
    return;
  }
  const { data, error } = await supabase.from('cierres_periodo_propio').select('*').eq('transportista_id', transportistaId);
  if (error) {
    mensaje.textContent = `No se pudo cargar (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
    return;
  }
  cierresCache = data;
  renderCierres();
}

async function cerrarMes() {
  const mensaje = el('cm-mensaje');
  mensaje.textContent = '';
  const transportistaId = el('cm-transportista').value;
  const mesStr = el('cm-mes-nuevo').value; // "YYYY-MM"
  if (!transportistaId || !mesStr) {
    mensaje.textContent = 'Elegí el transportista y el mes a cerrar.';
    mensaje.className = 'error';
    return;
  }
  const [anio, mes] = mesStr.split('-').map(Number);
  const nombreTransportista = propiosCache.find((t) => t.user_id === transportistaId)?.nombre_completo || '';
  if (!confirm(`¿Cerrar ${NOMBRES_MES[mes - 1]} ${anio} de ${nombreTransportista}? El chofer va a dejar de ver esos viajes.`)) return;

  const { session } = getEstado();
  const { error } = await supabase.from('cierres_periodo_propio').insert({
    transportista_id: transportistaId,
    anio,
    mes,
    cerrado_por: session.user.id,
  });
  if (error) {
    mensaje.textContent = error.code === '23505' ? 'Ese mes ya estaba cerrado para este transportista.' : `No se pudo cerrar: ${error.message}`;
    mensaje.className = 'error';
    return;
  }

  el('cm-mes-nuevo').value = '';
  await cargarCierresDelPropio();
  mensaje.textContent = `${NOMBRES_MES[mes - 1]} ${anio} cerrado.`;
  mensaje.className = 'ok';
}

export async function cargarPantallaCierres() {
  await cargarPropios();
  await cargarCierresDelPropio();
}

export function initCierres() {
  el('cm-transportista').addEventListener('change', cargarCierresDelPropio);
  el('cm-cerrar-btn').addEventListener('click', cerrarMes);
}
