import { supabase } from './supabaseClient.js';
import { ESTABLECIMIENTOS, CATEGORIAS } from './config.js';
import { stockCacheGet, stockCacheSet } from './db-local.js';
import { exportarMatrizStock } from './export.js';
import { cargarTitulares, obtenerTitularesCache } from './titulares.js';
import { crearGrupoBotones, obtenerSeleccion, establecerSeleccion } from './botones.js';

function el(id) {
  return document.getElementById(id);
}

function esCapitalizador(titularId) {
  const t = obtenerTitularesCache().find((x) => x.id === titularId);
  return t ? t.tipo === 'capitalizador' : titularId !== 'agro_salado' && titularId !== 'dona_julia';
}

// Filtra las filas de stock_actual según la "vista" de titularidad elegida.
function filtrarPorVista(rows, vista, capitalizadorId) {
  if (vista === 'agro_salado') return rows.filter((r) => r.titular === 'agro_salado');
  if (vista === 'dona_julia') return rows.filter((r) => r.titular === 'dona_julia');
  if (vista === 'capitalizadores') {
    if (capitalizadorId) return rows.filter((r) => r.titular === capitalizadorId);
    return rows.filter((r) => esCapitalizador(r.titular));
  }
  return rows.filter((r) => r.titular === 'agro_salado' || r.titular === 'dona_julia'); // 'grupo'
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
  const hora = fetchedAt ? new Date(fetchedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—';
  if (!offline) {
    contenedor.textContent = `Actualizado a las ${hora}.`;
    contenedor.className = 'ok';
    return;
  }
  contenedor.textContent = `Sin conexión — mostrando datos de las ${hora}.`;
  contenedor.className = 'advertencia';
}

function renderResumenTitularidad(rows) {
  const suma = (filtro) => rows.filter(filtro).reduce((acc, r) => acc + r.cabezas, 0);
  const totalAgro = suma((r) => r.titular === 'agro_salado');
  const totalDona = suma((r) => r.titular === 'dona_julia');
  const totalGrupo = totalAgro + totalDona;
  const totalTerceros = suma((r) => esCapitalizador(r.titular));
  const totalGeneral = totalGrupo + totalTerceros;

  el('dash-total-agro').textContent = totalAgro;
  el('dash-total-dona').textContent = totalDona;
  el('dash-total-grupo').textContent = totalGrupo;
  el('dash-total-terceros').textContent = totalTerceros;
  el('dash-total-general').textContent = totalGeneral;
}

function renderGlobal(rows) {
  const totales = {};
  for (const c of CATEGORIAS) totales[c.id] = 0;
  for (const r of rows) totales[r.categoria] = (totales[r.categoria] || 0) + r.cabezas;

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
  const totalesPorCategoria = {};
  for (const c of CATEGORIAS) totalesPorCategoria[c.id] = 0;

  for (const e of ESTABLECIMIENTOS) {
    const totalFila = CATEGORIAS.reduce((acc, c) => acc + matriz[e.id][c.id], 0);
    for (const c of CATEGORIAS) totalesPorCategoria[c.id] += matriz[e.id][c.id];
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${e.nombre}</td>${CATEGORIAS.map((c) => `<td>${matriz[e.id][c.id]}</td>`).join('')}<td><strong>${totalFila}</strong></td>`;
    tbody.appendChild(tr);
  }

  const totalGeneral = Object.values(totalesPorCategoria).reduce((a, b) => a + b, 0);
  const trTotal = document.createElement('tr');
  trTotal.classList.add('fila-total');
  trTotal.innerHTML =
    `<td><strong>Total</strong></td>${CATEGORIAS.map((c) => `<td><strong>${totalesPorCategoria[c.id]}</strong></td>`).join('')}<td><strong>${totalGeneral}</strong></td>`;
  tbody.appendChild(trTotal);
}

// ─── selectores de vista (Grupo / Agro Salado / Doña Julia / Capitalizadores) ───

function poblarSelectCapitalizadores(idSelect) {
  const select = el(idSelect);
  select.innerHTML = '<option value="">Todos (suma)</option>';
  for (const c of obtenerTitularesCache().filter((t) => t.tipo === 'capitalizador')) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.nombre;
    select.appendChild(opt);
  }
}

function inicializarSelectorVista(idGrupo, idCapWrap, idCapSelect, onCambio) {
  crearGrupoBotones(idGrupo, [
    { id: 'grupo', nombre: 'Grupo' },
    { id: 'agro_salado', nombre: 'Agro Salado' },
    { id: 'dona_julia', nombre: 'Doña Julia' },
    { id: 'capitalizadores', nombre: 'Capitalizadores' },
  ]);
  poblarSelectCapitalizadores(idCapSelect);
  establecerSeleccion(idGrupo, 'grupo');

  el(idGrupo).addEventListener('cambio', () => {
    const vista = obtenerSeleccion(idGrupo);
    el(idCapWrap).classList.toggle('oculto', vista !== 'capitalizadores');
    onCambio();
  });
  el(idCapSelect).addEventListener('change', onCambio);
}

function leerVista(idGrupo, idCapSelect) {
  return { vista: obtenerSeleccion(idGrupo), capitalizadorId: el(idCapSelect).value || null };
}

let ultimasFilasStock = [];

function renderTablaCategoria() {
  const { vista, capitalizadorId } = leerVista('dash-categoria-vista', 'dash-categoria-cap-select');
  renderGlobal(filtrarPorVista(ultimasFilasStock, vista, capitalizadorId));
}

function renderTablaEstablecimiento() {
  const { vista, capitalizadorId } = leerVista('dash-establecimiento-vista', 'dash-establecimiento-cap-select');
  renderPorEstablecimiento(construirMatriz(filtrarPorVista(ultimasFilasStock, vista, capitalizadorId)));
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

export async function refrescarDashboard() {
  const { rows, offline, fetchedAt } = await obtenerStock();
  ultimasFilasStock = rows;
  renderEstado({ offline, fetchedAt });
  renderResumenTitularidad(rows);
  renderTablaCategoria();
  renderTablaEstablecimiento();
}

function exportarStockActual() {
  exportarMatrizStock(construirMatriz(ultimasFilasStock), 'stock_actual', 'Stock actual');
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

export async function initDashboard() {
  await cargarTitulares();
  inicializarSelectorVista('dash-categoria-vista', 'dash-categoria-cap-wrap', 'dash-categoria-cap-select', renderTablaCategoria);
  inicializarSelectorVista('dash-establecimiento-vista', 'dash-establecimiento-cap-wrap', 'dash-establecimiento-cap-select', renderTablaEstablecimiento);
  el('dash-actualizar').addEventListener('click', refrescarDashboard);
  el('dash-exportar').addEventListener('click', exportarStockActual);
  poblarSelectFecha();
  el('dash-fecha-exportar').addEventListener('click', exportarStockAFecha);
  refrescarDashboard();
}
