import { supabase } from './supabaseClient.js';
import { ESTABLECIMIENTOS, CATEGORIAS } from './config.js';
import { stockCacheGet, stockCacheSet } from './db-local.js';
import { exportarMatrizStock } from './export.js';

function el(id) {
  return document.getElementById(id);
}

function construirMatriz(rows) {
  const matriz = {};
  for (const e of ESTABLECIMIENTOS) {
    matriz[e.id] = {};
    for (const c of CATEGORIAS) matriz[e.id][c.id] = 0;
  }
  for (const r of rows) {
    if (matriz[r.establecimiento]) matriz[r.establecimiento][r.categoria] = (matriz[r.establecimiento][r.categoria] || 0) + r.cabezas;
  }
  return matriz;
}

async function obtenerStock() {
  const { data, error } = await supabase.from('stock_actual').select('*');
  if (!error) {
    await stockCacheSet(data);
    return { rows: data, offline: false, fetchedAt: new Date().toISOString() };
  }
  const cache = await stockCacheGet();
  if (cache) return { rows: cache.rows, offline: true, fetchedAt: cache.fetched_at };
  return { rows: [], offline: true, fetchedAt: null };
}

// Reconstruye el stock a una fecha pasada sumando los movimientos hasta esa
// fecha (excluye anulados, igual que la vista stock_actual, pero sin tope inferior).
async function calcularStockAFecha(fecha, establecimientoId) {
  let query = supabase.from('movimiento_lineas').select('establecimiento, categoria, delta_cabezas').lte('fecha', fecha);
  if (establecimientoId) query = query.eq('establecimiento', establecimientoId);
  const { data, error } = await query;
  if (error) throw error;

  const acumulado = {};
  for (const r of data) {
    const clave = `${r.establecimiento}|${r.categoria}`;
    acumulado[clave] = (acumulado[clave] || 0) + r.delta_cabezas;
  }
  return Object.entries(acumulado).map(([clave, cabezas]) => {
    const [establecimiento, categoria] = clave.split('|');
    return { establecimiento, categoria, cabezas };
  });
}

function renderEstado({ offline, fetchedAt }) {
  const contenedor = el('dash-estado');
  if (!offline) {
    contenedor.textContent = 'Actualizado ahora.';
    contenedor.className = 'ok';
    return;
  }
  const hora = fetchedAt ? new Date(fetchedAt).toLocaleString('es-AR') : 'sin datos';
  contenedor.textContent = `Sin conexión — mostrando datos de ${hora}.`;
  contenedor.className = 'advertencia';
}

function renderGlobal(rows) {
  const totales = {};
  for (const c of CATEGORIAS) totales[c.id] = 0;
  for (const r of rows) totales[r.categoria] = (totales[r.categoria] || 0) + r.cabezas;

  const totalGeneral = Object.values(totales).reduce((a, b) => a + b, 0);
  el('dash-total-general').textContent = totalGeneral;

  const tbody = el('dash-global-tabla').querySelector('tbody');
  tbody.innerHTML = '';
  for (const c of CATEGORIAS) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.nombre}</td><td>${totales[c.id]}</td>`;
    tbody.appendChild(tr);
  }
}

function renderPorEstablecimiento(matriz) {
  const tabla = el('dash-establecimientos-tabla');
  tabla.querySelector('thead').innerHTML =
    `<tr><th>Establecimiento</th>${CATEGORIAS.map((c) => `<th>${c.nombre}</th>`).join('')}<th>Total</th></tr>`;

  const tbody = tabla.querySelector('tbody');
  tbody.innerHTML = '';
  for (const e of ESTABLECIMIENTOS) {
    const totalFila = CATEGORIAS.reduce((acc, c) => acc + matriz[e.id][c.id], 0);
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${e.nombre}</td>${CATEGORIAS.map((c) => `<td>${matriz[e.id][c.id]}</td>`).join('')}<td><strong>${totalFila}</strong></td>`;
    tbody.appendChild(tr);
  }
}

function poblarSelectFecha() {
  const select = el('dash-fecha-establecimiento');
  if (select.options.length) return;
  select.innerHTML = '<option value="">Todos los establecimientos</option>';
  for (const e of ESTABLECIMIENTOS) {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.nombre;
    select.appendChild(opt);
  }
  el('dash-fecha').value = new Date().toISOString().slice(0, 10);
}

let ultimaMatrizStock = null;

export async function refrescarDashboard() {
  const { rows, offline, fetchedAt } = await obtenerStock();
  ultimaMatrizStock = construirMatriz(rows);
  renderEstado({ offline, fetchedAt });
  renderGlobal(rows);
  renderPorEstablecimiento(ultimaMatrizStock);
}

function exportarStockActual() {
  if (!ultimaMatrizStock) return;
  exportarMatrizStock(ultimaMatrizStock, 'stock_actual', 'Stock actual');
}

async function exportarStockAFecha() {
  const fecha = el('dash-fecha').value;
  const mensaje = el('dash-fecha-mensaje');
  if (!fecha) {
    mensaje.textContent = 'Elegí una fecha.';
    mensaje.className = 'error';
    return;
  }
  const establecimientoId = el('dash-fecha-establecimiento').value || null;
  try {
    const rows = await calcularStockAFecha(fecha, establecimientoId);
    const matriz = construirMatriz(rows);
    exportarMatrizStock(matriz, `stock_al_${fecha}`, `Stock al ${fecha}`);
    mensaje.textContent = '';
  } catch (error) {
    mensaje.textContent = `No se pudo calcular el stock a esa fecha (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
  }
}

export function initDashboard() {
  el('dash-actualizar').addEventListener('click', refrescarDashboard);
  el('dash-exportar').addEventListener('click', exportarStockActual);
  poblarSelectFecha();
  el('dash-fecha-exportar').addEventListener('click', exportarStockAFecha);
  refrescarDashboard();
}
