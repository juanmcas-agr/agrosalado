import { supabase } from './supabaseClient.js';
import { ESTABLECIMIENTOS, CATEGORIAS } from './config.js';
import { stockCacheGet, stockCacheSet } from './db-local.js';

function el(id) {
  return document.getElementById(id);
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

function renderPorEstablecimiento(rows) {
  const matriz = {};
  for (const e of ESTABLECIMIENTOS) {
    matriz[e.id] = {};
    for (const c of CATEGORIAS) matriz[e.id][c.id] = 0;
  }
  for (const r of rows) {
    if (matriz[r.establecimiento]) matriz[r.establecimiento][r.categoria] = (matriz[r.establecimiento][r.categoria] || 0) + r.cabezas;
  }

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

export async function refrescarDashboard() {
  const { rows, offline, fetchedAt } = await obtenerStock();
  renderEstado({ offline, fetchedAt });
  renderGlobal(rows);
  renderPorEstablecimiento(rows);
}

export function initDashboard() {
  el('dash-actualizar').addEventListener('click', refrescarDashboard);
  refrescarDashboard();
}
