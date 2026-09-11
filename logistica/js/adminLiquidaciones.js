// Lado staff: revisión de liquidaciones de transportistas externos.
// Aceptar pasa por netlify/functions/mail-liquidacion-aceptada.js
// (necesita generar el código server-side de forma atómica y mandar el
// mail). Rechazar es más simple — no genera nada ni manda mail, así que
// se hace directo desde acá: marca la liquidación y libera los viajes
// (liquidacion_id = null) para que el externo los pueda volver a tocar o
// agrupar en un nuevo envío.
import { supabase } from './supabaseClient.js';
import { getEstado } from './auth.js';

function el(id) {
  return document.getElementById(id);
}

let liquidacionesCache = [];

function textoEstadoCorto(estado) {
  if (estado === 'aceptada') return 'Aceptada';
  if (estado === 'pendiente') return 'Pendiente';
  return 'Rechazada';
}

async function aceptarLiquidacion(l) {
  if (!confirm(`¿Aceptar la liquidación de ${l.transportista_nombre} (${l.cantidad_viajes} viaje(s), ${l.total_tn} tn)? Se le va a generar un código y avisar por mail que ya puede facturar.`)) return;
  const mensaje = el('al-mensaje');
  mensaje.textContent = '';

  const { session } = getEstado();
  try {
    const res = await fetch('/.netlify/functions/mail-liquidacion-aceptada', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ liquidacion_id: l.id }),
    });
    const datos = await res.json();
    if (!res.ok) {
      mensaje.textContent = datos.error || 'No se pudo aceptar la liquidación.';
      mensaje.className = 'error';
      return;
    }
    await cargarLiquidacionesStaff();
    // Recién acá, después de recargar — cargarLiquidacionesStaff() empieza
    // limpiando este mismo mensaje, así que setearlo antes se perdía solo.
    mensaje.textContent = datos.mail_error
      ? `Liquidación aceptada (${datos.codigo}), pero no se pudo mandar el mail — avisale al transportista por otro medio.`
      : `Liquidación aceptada (${datos.codigo}). Se le avisó por mail.`;
    mensaje.className = datos.mail_error ? 'advertencia' : 'ok';
  } catch (error) {
    mensaje.textContent = 'Error de red: ' + error.message;
    mensaje.className = 'error';
  }
}

async function rechazarLiquidacion(l) {
  const motivo = prompt('Motivo del rechazo (se le va a mostrar al transportista):');
  if (motivo === null) return;
  const mensaje = el('al-mensaje');
  mensaje.textContent = '';

  const { session } = getEstado();
  const { error: errorLiq } = await supabase.from('liquidaciones_transporte').update({
    estado: 'rechazada',
    motivo_rechazo: motivo || null,
    resuelto_por: session.user.id,
    resuelto_at: new Date().toISOString(),
  }).eq('id', l.id);
  if (errorLiq) {
    mensaje.textContent = `No se pudo rechazar: ${errorLiq.message}`;
    mensaje.className = 'error';
    return;
  }

  const { error: errorViajes } = await supabase.from('viajes').update({ liquidacion_id: null }).eq('liquidacion_id', l.id);
  if (errorViajes) {
    mensaje.textContent = `La liquidación se rechazó pero no se pudieron liberar los viajes: ${errorViajes.message}`;
    mensaje.className = 'error';
    return;
  }

  await cargarLiquidacionesStaff();
  mensaje.textContent = 'Liquidación rechazada — los viajes quedaron liberados para el transportista.';
  mensaje.className = 'ok';
}

function renderLiquidaciones() {
  const tbody = el('al-tabla').querySelector('tbody');
  if (!liquidacionesCache.length) {
    tbody.innerHTML = '<tr><td colspan="8">Sin liquidaciones para este filtro.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const l of liquidacionesCache) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${l.codigo || '—'}</td>
      <td>${l.transportista_nombre}</td>
      <td>${textoEstadoCorto(l.estado)}</td>
      <td>${new Date(l.enviado_at).toLocaleDateString('es-AR')}</td>
      <td>${l.cantidad_viajes}</td>
      <td>${l.total_tn}</td>
      <td>${l.total_km}</td>
      <td>${l.motivo_rechazo || ''}</td>
    `;
    const tdAcciones = document.createElement('td');
    if (l.estado === 'pendiente') {
      const btnAceptar = document.createElement('button');
      btnAceptar.type = 'button';
      btnAceptar.className = 'boton-secundario';
      btnAceptar.textContent = 'Aceptar';
      btnAceptar.addEventListener('click', () => aceptarLiquidacion(l));
      tdAcciones.appendChild(btnAceptar);

      const btnRechazar = document.createElement('button');
      btnRechazar.type = 'button';
      btnRechazar.className = 'boton-anular';
      btnRechazar.textContent = 'Rechazar';
      btnRechazar.addEventListener('click', () => rechazarLiquidacion(l));
      tdAcciones.appendChild(btnRechazar);
    }
    tr.appendChild(tdAcciones);
    tbody.appendChild(tr);
  }
}

export async function cargarLiquidacionesStaff() {
  const mensaje = el('al-mensaje');
  mensaje.textContent = '';
  let query = supabase.from('liquidaciones_transporte_detalle').select('*');
  const estado = el('al-filtro-estado').value;
  if (estado) query = query.eq('estado', estado);
  const { data, error } = await query.order('enviado_at', { ascending: false });
  if (error) {
    mensaje.textContent = `No se pudo cargar (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
    return;
  }
  liquidacionesCache = data;
  renderLiquidaciones();
}

export function initLiquidacionesStaff() {
  el('al-filtrar').addEventListener('click', cargarLiquidacionesStaff);
}
