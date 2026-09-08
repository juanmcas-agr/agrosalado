import { supabase } from './supabaseClient.js';
import { ESTABLECIMIENTOS, CATEGORIAS } from './config.js';
import { stockCacheGet, stockCacheSet } from './db-local.js';
import { exportarMatrizStock, exportarStockEstablecimiento } from './export.js';
import { cargarTitulares, obtenerTitularesCache } from './titulares.js';
import { cargarRodeos, obtenerRodeosCache, cargarInfoFeedLot } from './rodeos.js';
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
    if (!acumulado[r.rodeo_id]) acumulado[r.rodeo_id] = { rodeoId: r.rodeo_id, rodeo: r.rodeo, categoriaId: r.categoria, cabezas: 0 };
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

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function esHoy(fecha) {
  return !fecha || fecha === hoyISO();
}

// Reconstruye el stock a una fecha pasada sumando movimiento_lineas hasta
// esa fecha, con la misma agregación (y misma fórmula de kilos promedio
// ponderado) que la vista stock_actual — así el resultado tiene la misma
// forma de fila y las tablas/exportación existentes lo pueden usar sin
// cambios cuando la fecha elegida no es hoy.
async function obtenerStockAFecha(fecha) {
  const { data, error } = await supabase
    .from('movimiento_lineas')
    .select('establecimiento, categoria, titular, rodeo_id, delta_cabezas, kilos_promedio')
    .lte('fecha', fecha);
  if (error) throw error;

  const grupos = {};
  for (const r of data) {
    const clave = `${r.establecimiento}|${r.categoria}|${r.titular}|${r.rodeo_id || ''}`;
    if (!grupos[clave]) {
      grupos[clave] = { establecimiento: r.establecimiento, categoria: r.categoria, titular: r.titular, rodeo_id: r.rodeo_id, cabezas: 0, sumaKg: 0 };
    }
    grupos[clave].cabezas += r.delta_cabezas;
    grupos[clave].sumaKg += r.delta_cabezas * r.kilos_promedio;
  }

  const rodeosCache = obtenerRodeosCache();
  return Object.values(grupos).map((g) => ({
    establecimiento: g.establecimiento,
    categoria: g.categoria,
    titular: g.titular,
    rodeo_id: g.rodeo_id,
    rodeo: g.rodeo_id ? rodeosCache.find((r) => r.id === g.rodeo_id)?.codigo || null : null,
    cabezas: g.cabezas,
    kilos_promedio_ponderado: g.cabezas > 0 ? Math.round((g.sumaKg / g.cabezas) * 100) / 100 : null,
  }));
}

function renderEstado({ offline, fetchedAt, fecha }) {
  const contenedor = el('dash-estado');
  if (!esHoy(fecha)) {
    contenedor.textContent = `Mostrando stock al ${formatearFechaDMY(fecha)}.`;
    contenedor.className = 'ok';
    return;
  }
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
          let extra = '';
          if (e.id === 'feed_lot') {
            const info = infoFeedLot[r.rodeoId];
            const partes = [];
            if (info?.corral) partes.push(`corral ${info.corral}`);
            if (info?.fechaEstimadaSalida) partes.push(`salida est. ${formatearFechaDMY(info.fechaEstimadaSalida)}`);
            if (info?.kilosSalidaObjetivo) partes.push(`objetivo ${info.kilosSalidaObjetivo}kg`);
            if (partes.length) extra = ` [${partes.join(', ')}]`;
          }
          return `${r.rodeo} (${cat ? cat.nombre : r.categoriaId}: ${r.cabezas})${extra}`;
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
let infoFeedLot = {}; // { [rodeoId]: { corral, fechaEstimadaSalida, kilosSalidaObjetivo } }

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

function poblarSelectExportarEstablecimiento() {
  const select = el('dash-exportar-establecimiento');
  select.innerHTML = '<option value="">Todos los establecimientos</option>';
  for (const e of ESTABLECIMIENTOS) {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.nombre;
    select.appendChild(opt);
  }
}

export async function refrescarDashboard() {
  const fecha = el('dash-fecha').value || hoyISO();
  const hoy = esHoy(fecha);

  let rows;
  let offline = false;
  let fetchedAt = null;
  if (hoy) {
    ({ rows, offline, fetchedAt } = await obtenerStock());
  } else {
    try {
      rows = await obtenerStockAFecha(fecha);
      fetchedAt = new Date().toISOString();
    } catch (error) {
      el('dash-estado').textContent = `No se pudo calcular el stock a esa fecha (¿sin conexión?): ${error.message}`;
      el('dash-estado').className = 'error';
      return;
    }
  }

  ultimasFilasStock = rows;
  infoFeedLot = {};
  if (hoy && !offline) {
    try { infoFeedLot = await cargarInfoFeedLot(); } catch (error) { console.warn('No se pudo cargar corral/ciclo de feed lot:', error); }
  }
  renderEstado({ offline, fetchedAt, fecha });
  renderResumenTitularidad(rows);
  renderTablaCategoria();
  renderTablaEstablecimiento();
}

// Exporta la misma vista (titularidad + fecha) que está en pantalla: un
// establecimiento puntual si se eligió uno en el selector de exportación,
// o todos desagregados + integrados (fila Total) en una sola hoja.
function exportarStock() {
  const fecha = el('dash-fecha').value || hoyISO();
  const establecimientoId = el('dash-exportar-establecimiento').value || null;
  const { vista, capitalizadorId } = leerVista('dash-establecimiento-vista', 'dash-establecimiento-cap-select');
  const rows = filtrarPorVista(ultimasFilasStock, vista, capitalizadorId);

  if (establecimientoId) {
    const nombreEst = ESTABLECIMIENTOS.find((e) => e.id === establecimientoId)?.nombre || establecimientoId;
    const totales = {};
    for (const c of CATEGORIAS) totales[c.id] = 0;
    for (const r of rows) {
      if (r.establecimiento === establecimientoId) totales[r.categoria] = (totales[r.categoria] || 0) + r.cabezas;
    }
    exportarStockEstablecimiento(totales, nombreEst, `stock_${establecimientoId}_${fecha}`);
    return;
  }

  const matriz = construirMatriz(rows);
  exportarMatrizStock(matriz, `stock_${fecha}`, `Stock al ${fecha}`);
}

export async function initDashboard() {
  await Promise.all([cargarTitulares(), cargarRodeos()]);
  inicializarSelectorVista('dash-categoria-vista', 'dash-categoria-cap-wrap', 'dash-categoria-cap-select', renderTablaCategoria);
  inicializarSelectorVista('dash-establecimiento-vista', 'dash-establecimiento-cap-wrap', 'dash-establecimiento-cap-select', renderTablaEstablecimiento);
  poblarSelectExportarEstablecimiento();
  el('dash-fecha').value = hoyISO();
  el('dash-fecha').addEventListener('change', refrescarDashboard);
  el('dash-actualizar').addEventListener('click', refrescarDashboard);
  el('dash-exportar').addEventListener('click', exportarStock);
  refrescarDashboard();
}
