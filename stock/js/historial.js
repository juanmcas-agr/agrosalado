import { supabase } from './supabaseClient.js';
import { ESTABLECIMIENTOS, TIPOS_MOVIMIENTO } from './config.js';
import { getEstado } from './auth.js';
import { exportarHistorial } from './export.js';

const VENTANA_ANULACION_HORAS = 48;

function el(id) {
  return document.getElementById(id);
}

function poblarFiltros() {
  const selEst = el('hist-filtro-establecimiento');
  if (!selEst.options.length) {
    selEst.innerHTML = '<option value="">Todos los establecimientos</option>';
    for (const e of ESTABLECIMIENTOS) {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.nombre;
      selEst.appendChild(opt);
    }
  }

  const selTipo = el('hist-filtro-tipo');
  if (!selTipo.options.length) {
    selTipo.innerHTML = '<option value="">Todos los tipos</option>';
    for (const [id, cfg] of Object.entries(TIPOS_MOVIMIENTO)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = cfg.nombre;
      selTipo.appendChild(opt);
    }
  }
}

function puedeAnular(fila) {
  const { perfil, session } = getEstado();
  if (!perfil || fila.anulado) return false;
  if (perfil.rol === 'administrativo' || perfil.rol === 'owner') return true;
  if (fila.usuario_id !== session.user.id) return false;
  const horas = (Date.now() - new Date(fila.created_at).getTime()) / 36e5;
  return horas <= VENTANA_ANULACION_HORAS;
}

function describirMovimiento(fila) {
  const origen = fila.establecimiento_origen_nombre
    ? `${fila.establecimiento_origen_nombre} (${fila.categoria_origen_nombre})`
    : '—';
  const destino = fila.establecimiento_destino_nombre
    ? `${fila.establecimiento_destino_nombre} (${fila.categoria_destino_nombre})`
    : '—';
  return { origen, destino };
}

function describirTitular(fila) {
  if (fila.titular_origen_nombre && fila.titular_destino_nombre && fila.titular_origen !== fila.titular_destino) {
    return `${fila.titular_origen_nombre} → ${fila.titular_destino_nombre}`;
  }
  return fila.titular_origen_nombre || fila.titular_destino_nombre || '—';
}

async function anularMovimiento(id) {
  if (!navigator.onLine) {
    alert('Necesitás conexión a internet para anular un movimiento.');
    return;
  }
  const motivo = prompt('Motivo de la anulación:');
  if (motivo === null) return;
  const { perfil } = getEstado();
  const { error } = await supabase
    .from('movimientos')
    .update({
      anulado: true,
      anulado_por: getEstado().session.user.id,
      anulado_at: new Date().toISOString(),
      anulado_motivo: motivo || null,
    })
    .eq('id', id);
  if (error) {
    alert(`No se pudo anular: ${error.message}`);
    return;
  }
  await cargarHistorial();
}

function renderFilas(filas) {
  const tbody = el('hist-tabla').querySelector('tbody');
  tbody.innerHTML = '';
  for (const fila of filas) {
    const { origen, destino } = describirMovimiento(fila);
    const tr = document.createElement('tr');
    if (fila.anulado) tr.classList.add('anulado');
    tr.innerHTML = `
      <td>${fila.fecha}</td>
      <td>${new Date(fila.created_at).toLocaleString('es-AR')}</td>
      <td>${fila.tipo_movimiento_nombre}</td>
      <td>${origen}</td>
      <td>${destino}</td>
      <td>${describirTitular(fila)}</td>
      <td>${fila.cantidad_cabezas}</td>
      <td>${fila.kilos_promedio}</td>
      <td>${fila.rodeo || ''}</td>
      <td>${fila.usuario_nombre || '—'}</td>
      <td>${fila.observaciones || ''}</td>
      <td>${fila.anulado ? `Anulado (${fila.anulado_motivo || 'sin motivo'})` : ''}</td>
      <td></td>
    `;
    if (puedeAnular(fila)) {
      const btn = document.createElement('button');
      btn.textContent = 'Anular';
      btn.className = 'boton-anular';
      btn.addEventListener('click', () => anularMovimiento(fila.id));
      tr.lastElementChild.appendChild(btn);
    }
    tbody.appendChild(tr);
  }
}

let ultimasFilas = [];

export async function cargarHistorial() {
  let query = supabase.from('historial_movimientos').select('*').limit(200);

  const establecimiento = el('hist-filtro-establecimiento').value;
  const tipo = el('hist-filtro-tipo').value;
  const desde = el('hist-filtro-desde').value;
  const hasta = el('hist-filtro-hasta').value;

  if (establecimiento) {
    query = query.or(`establecimiento_origen.eq.${establecimiento},establecimiento_destino.eq.${establecimiento}`);
  }
  if (tipo) query = query.eq('tipo_movimiento', tipo);
  if (desde) query = query.gte('fecha', desde);
  if (hasta) query = query.lte('fecha', hasta);

  const { data, error } = await query;
  if (error) {
    el('hist-mensaje').textContent = `No se pudo cargar el historial (¿sin conexión?): ${error.message}`;
    el('hist-mensaje').className = 'error';
    return;
  }
  el('hist-mensaje').textContent = '';
  ultimasFilas = data;
  renderFilas(data);
}

function exportar() {
  if (!ultimasFilas.length) return;
  exportarHistorial(ultimasFilas);
}

export function initHistorial() {
  poblarFiltros();
  el('hist-filtrar').addEventListener('click', cargarHistorial);
  el('hist-exportar').addEventListener('click', exportar);
  cargarHistorial();
}
