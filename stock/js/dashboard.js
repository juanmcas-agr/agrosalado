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

// Kilos promedio ponderado por celda establecimiento×categoría: pondera
// el kilos_promedio_ponderado de cada fila de stock_actual (que ya viene
// ponderado a nivel rodeo/titular) por sus propias cabezas — es la misma
// identidad matemática que un promedio ponderado de promedios ponderados
// (sum(cabezas×kg)/sum(cabezas) en cada nivel de agregación).
function construirMatrizKilos(rows) {
  const sumaKg = {};
  const sumaCab = {};
  for (const e of ESTABLECIMIENTOS) {
    sumaKg[e.id] = {};
    sumaCab[e.id] = {};
    for (const c of CATEGORIAS) { sumaKg[e.id][c.id] = 0; sumaCab[e.id][c.id] = 0; }
  }
  for (const r of rows) {
    if (!sumaCab[r.establecimiento] || r.kilos_promedio_ponderado == null || r.cabezas <= 0) continue;
    sumaCab[r.establecimiento][r.categoria] += r.cabezas;
    sumaKg[r.establecimiento][r.categoria] += r.cabezas * r.kilos_promedio_ponderado;
  }
  const matriz = {};
  for (const e of ESTABLECIMIENTOS) {
    matriz[e.id] = {};
    for (const c of CATEGORIAS) {
      matriz[e.id][c.id] = sumaCab[e.id][c.id] > 0 ? sumaKg[e.id][c.id] / sumaCab[e.id][c.id] : null;
    }
  }
  return matriz;
}

function totalesKilosPorCategoria(rows) {
  const sumaKg = {};
  const sumaCab = {};
  for (const c of CATEGORIAS) { sumaKg[c.id] = 0; sumaCab[c.id] = 0; }
  for (const r of rows) {
    if (r.kilos_promedio_ponderado == null || r.cabezas <= 0) continue;
    sumaCab[r.categoria] = (sumaCab[r.categoria] || 0) + r.cabezas;
    sumaKg[r.categoria] = (sumaKg[r.categoria] || 0) + r.cabezas * r.kilos_promedio_ponderado;
  }
  const resultado = {};
  for (const c of CATEGORIAS) resultado[c.id] = sumaCab[c.id] > 0 ? sumaKg[c.id] / sumaCab[c.id] : null;
  return resultado;
}

function formatearKilos(kg) {
  return kg == null ? '—' : `${kg.toFixed(0)} kg`;
}

// Rodeos con stock (>0) en un establecimiento, sumando titulares — para el
// detalle que se abre al tocar la fila en "Por establecimiento".
function rodeosPorEstablecimiento(rows, establecimientoId) {
  const acumulado = {};
  for (const r of rows) {
    if (r.establecimiento !== establecimientoId || !r.rodeo_id || r.cabezas <= 0) continue;
    if (!acumulado[r.rodeo_id]) acumulado[r.rodeo_id] = { rodeo: r.rodeo, categoriaId: r.categoria, cabezas: 0 };
    acumulado[r.rodeo_id].cabezas += r.cabezas;
  }
  return Object.values(acumulado).sort((a, b) => (a.rodeo || '').localeCompare(b.rodeo || ''));
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
  const kilos = totalesKilosPorCategoria(rows);

  const tbody = el('dash-global-tabla').querySelector('tbody');
  tbody.innerHTML = '';
  for (const c of CATEGORIAS) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.nombre}</td><td>${totales[c.id]}</td><td class="kilos-cell">${formatearKilos(kilos[c.id])}</td>`;
    tbody.appendChild(tr);
  }

  const totalGeneral = Object.values(totales).reduce((a, b) => a + b, 0);
  const trTotal = document.createElement('tr');
  trTotal.classList.add('fila-total');
  trTotal.innerHTML = `<td><strong>Total</strong></td><td><strong>${totalGeneral}</strong></td><td></td>`;
  tbody.appendChild(trTotal);
}

// rowsFiltradas: mismas filas (ya filtradas por vista de titularidad) que
// se usaron para armar `matriz`, para poder abrir el detalle de rodeos de
// cada establecimiento con la misma vista activa.
function renderPorEstablecimiento(matriz, matrizKilos, rowsFiltradas) {
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
    tr.className = 'fila-clickeable';
    tr.innerHTML =
      `<td>${e.nombre}</td>` +
      CATEGORIAS.map((c) => `<td>${matriz[e.id][c.id]}${matrizKilos[e.id][c.id] != null ? `<br><span class="kilos-cell">${formatearKilos(matrizKilos[e.id][c.id])}</span>` : ''}</td>`).join('') +
      `<td><strong>${totalFila}</strong></td>`;

    const trRodeos = document.createElement('tr');
    trRodeos.className = 'fila-rodeos oculto';
    const tdRodeos = document.createElement('td');
    tdRodeos.colSpan = CATEGORIAS.length + 2;
    const rodeos = rodeosPorEstablecimiento(rowsFiltradas, e.id);
    tdRodeos.innerHTML = rodeos.length
      ? `<strong>${rodeos.length} rodeo(s):</strong> ` + rodeos.map((r) => {
          const cat = CATEGORIAS.find((c) => c.id === r.categoriaId);
          return `${r.rodeo} (${cat ? cat.nombre : r.categoriaId}: ${r.cabezas})`;
        }).join(' · ')
      : 'Sin rodeos con stock en este establecimiento.';
    trRodeos.appendChild(tdRodeos);

    tr.addEventListener('click', () => trRodeos.classList.toggle('oculto'));
    tbody.appendChild(tr);
    tbody.appendChild(trRodeos);
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
    { id: 'grupo', nombre: 'AS + DJ' },
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
  const rows = filtrarPorVista(ultimasFilasStock, vista, capitalizadorId);
  renderPorEstablecimiento(construirMatriz(rows), construirMatrizKilos(rows), rows);
}

function formatearFechaDMY(fecha) {
  const [y, m, d] = fecha.split('-');
  return `${d}/${m}/${y}`;
}

// "Todos los establecimientos" desagregado (una fila por establecimiento,
// misma matriz que "Por establecimiento") e integrado (fila Total al pie)
// en la misma tabla; un establecimiento puntual muestra solo sus categorías.
function renderTablaFecha(rows, establecimientoId, fecha) {
  const tabla = el('dash-fecha-tabla');
  tabla.classList.remove('oculto');
  const tbody = tabla.querySelector('tbody');
  tbody.innerHTML = '';

  if (establecimientoId) {
    const nombreEst = ESTABLECIMIENTOS.find((e) => e.id === establecimientoId)?.nombre || establecimientoId;
    tabla.querySelector('thead').innerHTML =
      `<tr><th colspan="2">${nombreEst} al ${formatearFechaDMY(fecha)}</th></tr><tr><th>Categoría</th><th>Cabezas</th></tr>`;
    const totales = {};
    for (const c of CATEGORIAS) totales[c.id] = 0;
    for (const r of rows) totales[r.categoria] = (totales[r.categoria] || 0) + r.cabezas;
    let totalGeneral = 0;
    for (const c of CATEGORIAS) {
      totalGeneral += totales[c.id];
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${c.nombre}</td><td>${totales[c.id]}</td>`;
      tbody.appendChild(tr);
    }
    const trTotal = document.createElement('tr');
    trTotal.className = 'fila-total';
    trTotal.innerHTML = `<td><strong>Total</strong></td><td><strong>${totalGeneral}</strong></td>`;
    tbody.appendChild(trTotal);
    return;
  }

  const matriz = construirMatriz(rows);
  tabla.querySelector('thead').innerHTML =
    `<tr><th colspan="${CATEGORIAS.length + 2}">Todos los establecimientos al ${formatearFechaDMY(fecha)}</th></tr>` +
    `<tr><th>Establecimiento</th>${CATEGORIAS.map((c) => `<th>${c.nombre}</th>`).join('')}<th>Total</th></tr>`;
  const totalesPorCategoria = {};
  for (const c of CATEGORIAS) totalesPorCategoria[c.id] = 0;
  for (const e of ESTABLECIMIENTOS) {
    const totalFila = CATEGORIAS.reduce((acc, c) => acc + matriz[e.id][c.id], 0);
    for (const c of CATEGORIAS) totalesPorCategoria[c.id] += matriz[e.id][c.id];
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${e.nombre}</td>${CATEGORIAS.map((c) => `<td>${matriz[e.id][c.id]}</td>`).join('')}<td><strong>${totalFila}</strong></td>`;
    tbody.appendChild(tr);
  }
  const totalGeneral = Object.values(totalesPorCategoria).reduce((a, b) => a + b, 0);
  const trTotal = document.createElement('tr');
  trTotal.className = 'fila-total';
  trTotal.innerHTML = `<td><strong>Total</strong></td>${CATEGORIAS.map((c) => `<td><strong>${totalesPorCategoria[c.id]}</strong></td>`).join('')}<td><strong>${totalGeneral}</strong></td>`;
  tbody.appendChild(trTotal);
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

async function verStockAFecha() {
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
    renderTablaFecha(rows, establecimientoId, fecha);
    mensaje.textContent = '';
  } catch (error) {
    mensaje.textContent = `No se pudo calcular el stock a esa fecha (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
  }
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
  poblarSelectFecha();
  el('dash-fecha-ver').addEventListener('click', verStockAFecha);
  el('dash-fecha-exportar').addEventListener('click', exportarStockAFecha);
  refrescarDashboard();
}
