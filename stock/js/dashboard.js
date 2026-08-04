import { supabase } from './supabaseClient.js';
import { ESTABLECIMIENTOS, CATEGORIAS } from './config.js';
import { stockCacheGet, stockCacheSet } from './db-local.js';

function el(id) {
  return document.getElementById(id);
}

function nombreEstablecimiento(id) {
  return ESTABLECIMIENTOS.find((e) => e.id === id)?.nombre || id;
}

function nombreCategoria(id) {
  return CATEGORIAS.find((c) => c.id === id)?.nombre || id;
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
  const totales = {};
  for (const e of ESTABLECIMIENTOS) totales[e.id] = 0;
  for (const r of rows) totales[r.establecimiento] = (totales[r.establecimiento] || 0) + r.cabezas;

  const tbody = el('dash-establecimientos-tabla').querySelector('tbody');
  tbody.innerHTML = '';
  for (const e of ESTABLECIMIENTOS) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${e.nombre}</td><td>${totales[e.id]}</td>`;
    tbody.appendChild(tr);
  }
}

function renderDrilldown(rows) {
  const establecimientoId = el('dash-establecimiento').value;
  const porCategoria = {};
  for (const c of CATEGORIAS) porCategoria[c.id] = 0;
  for (const r of rows) {
    if (r.establecimiento === establecimientoId) porCategoria[r.categoria] = (porCategoria[r.categoria] || 0) + r.cabezas;
  }

  const tbody = el('dash-drilldown-tabla').querySelector('tbody');
  tbody.innerHTML = '';
  for (const c of CATEGORIAS) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.nombre}</td><td>${porCategoria[c.id]}</td>`;
    tbody.appendChild(tr);
  }
}

function poblarSelectEstablecimiento() {
  const select = el('dash-establecimiento');
  if (select.options.length) return;
  for (const e of ESTABLECIMIENTOS) {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.nombre;
    select.appendChild(opt);
  }
}

let ultimasFilas = [];

export async function refrescarDashboard() {
  const { rows, offline, fetchedAt } = await obtenerStock();
  ultimasFilas = rows;
  renderEstado({ offline, fetchedAt });
  renderGlobal(rows);
  renderPorEstablecimiento(rows);
  renderDrilldown(rows);
}

export function initDashboard() {
  poblarSelectEstablecimiento();
  el('dash-establecimiento').addEventListener('change', () => renderDrilldown(ultimasFilas));
  el('dash-actualizar').addEventListener('click', refrescarDashboard);
  refrescarDashboard();
}
