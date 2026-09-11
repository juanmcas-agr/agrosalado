// Lado chofer propio: "cerrar mi mes". No hace falta replicar del lado
// cliente el efecto que tiene cerrar un mes (dejar de ver esos viajes) —
// eso ya lo decide la RLS de viajes_select_dueno (M1): apenas existe un
// cierres_periodo_propio para (transportista, año, mes), esos viajes
// desaparecen del select del propio solo. Este módulo solo crea esa fila
// y muestra el historial de meses ya cerrados.
import { supabase } from './supabaseClient.js';
import { getEstado } from './auth.js';

function el(id) {
  return document.getElementById(id);
}

const NOMBRES_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function renderMisCierres(cierres) {
  const tbody = el('cm-propio-tabla').querySelector('tbody');
  if (!cierres.length) {
    tbody.innerHTML = '<tr><td colspan="3">Todavía no cerraste ningún mes.</td></tr>';
    return;
  }
  tbody.innerHTML = [...cierres]
    .sort((a, b) => b.anio - a.anio || b.mes - a.mes)
    .map((c) => `<tr><td>${c.anio}</td><td>${NOMBRES_MES[c.mes - 1]}</td><td>${new Date(c.cerrado_at).toLocaleDateString('es-AR')}</td></tr>`)
    .join('');
}

export async function cargarMisCierres() {
  const mensaje = el('cm-propio-mensaje');
  mensaje.textContent = '';
  const { session } = getEstado();
  const { data, error } = await supabase.from('cierres_periodo_propio').select('*').eq('transportista_id', session.user.id);
  if (error) {
    mensaje.textContent = `No se pudo cargar (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
    return;
  }
  renderMisCierres(data);
}

async function cerrarMiMes() {
  const mensaje = el('cm-propio-mensaje');
  mensaje.textContent = '';
  const mesStr = el('cm-propio-mes').value; // "YYYY-MM"
  if (!mesStr) {
    mensaje.textContent = 'Elegí el mes que querés cerrar.';
    mensaje.className = 'error';
    return;
  }
  const [anio, mes] = mesStr.split('-').map(Number);
  if (!confirm(`¿Cerrar ${NOMBRES_MES[mes - 1]} ${anio}? Vas a dejar de ver esos viajes en "Mis viajes" — si necesitás corregir algo después, pedile a administración que reabra el mes.`)) return;

  const { session } = getEstado();
  const { error } = await supabase.from('cierres_periodo_propio').insert({
    transportista_id: session.user.id,
    anio,
    mes,
    cerrado_por: session.user.id,
  });
  if (error) {
    mensaje.textContent = error.code === '23505' ? 'Ese mes ya estaba cerrado.' : `No se pudo cerrar: ${error.message}`;
    mensaje.className = 'error';
    return;
  }

  el('cm-propio-mes').value = '';
  await cargarMisCierres();
  mensaje.textContent = `${NOMBRES_MES[mes - 1]} ${anio} cerrado.`;
  mensaje.className = 'ok';
}

export function initCierreMensual() {
  el('cm-propio-cerrar-btn').addEventListener('click', cerrarMiMes);
}
