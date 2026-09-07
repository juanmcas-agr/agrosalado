// Matriz de precios relativos: todos los productos contra todos, con el
// último valor disponible de cada uno. Click en una celda abre el
// histórico de ese ratio puntual.
import { supabase } from './supabaseClient.js';
import { getEstado } from './auth.js';
import { PRODUCTOS } from './config.js';

// Los scrapers/cierre diario (cierre-diario-precios-relativos, scraper-*)
// tienen "schedule" en netlify.toml, y Netlify bloquea con 403 cualquier
// invocación pública por HTTP una vez que un archivo tiene eso — no se los
// puede llamar directo. Por eso este botón pega a un endpoint aparte, sin
// schedule, que internamente corre la misma lógica compartida.
const FUNCION_ACTUALIZAR = 'actualizar-precios-relativos';

function el(id) {
  return document.getElementById(id);
}

// "$ Pesos" es un producto de referencia sintético, no vive en la base
// (no tiene fuente ni serie propia): vale siempre 1 ARS, por definición.
// Dividir cualquier producto por esta columna da directamente su precio
// nominal en pesos de esa fecha — igual que dividir por "Dólar Banco
// Nación" ya daba su precio nominal en dólares. Un ratio entre dos
// productos reales no cambia con esto (se cancela matemáticamente); esta
// referencia es la manera de sacar el valor absoluto, no un ratio.
const ID_PESOS = '__pesos__';
const PRODUCTO_PESOS = { id: ID_PESOS, nombre: 'Pesos (nominal)', corto: '$ Pesos', monedaNativa: 'ARS' };

function productosVisibles() {
  return [PRODUCTO_PESOS, ...PRODUCTOS];
}

function porId(id) {
  if (id === ID_PESOS) return PRODUCTO_PESOS;
  return PRODUCTOS.find((p) => p.id === id);
}

// historialPorProducto[producto_id] = [{ fecha, valorNativo }, ...] ordenado
// ascendente por fecha. Se carga una sola vez (fetch completo, la tabla es
// chica todavía) y se reusa tanto para la matriz como para el drill-down,
// mismo criterio que calcularLibres() en Granos.
let historialPorProducto = {};
// indicePorTipo['ARS'|'USD'] = [{ fecha, indice }, ...] ascendente — para
// re-expresar un valor absoluto (precio de un producto en $Pesos o en U$
// BNA) en moneda constante. Un ratio entre dos productos reales NO
// necesita esto (se cancela matemáticamente, ver comentario de ID_PESOS).
let indicePorTipo = {};
let cargado = false;

async function cargarHistorialCompleto() {
  if (cargado) return;
  const [{ data: historial, error: errorHistorial }, { data: indices, error: errorIndices }] = await Promise.all([
    supabase.from('precios_relativos_historial').select('producto_id, fecha, valor_nativo').order('fecha', { ascending: true }),
    supabase.from('precios_relativos_indices').select('tipo, fecha, indice').order('fecha', { ascending: true }),
  ]);
  if (errorHistorial) {
    console.error('No se pudo cargar el histórico de precios relativos:', errorHistorial);
    return;
  }
  historialPorProducto = {};
  for (const fila of historial) {
    if (!historialPorProducto[fila.producto_id]) historialPorProducto[fila.producto_id] = [];
    historialPorProducto[fila.producto_id].push({ fecha: fila.fecha, valorNativo: Number(fila.valor_nativo) });
  }
  indicePorTipo = { ARS: [], USD: [] };
  if (!errorIndices && indices) {
    for (const fila of indices) {
      if (!indicePorTipo[fila.tipo]) indicePorTipo[fila.tipo] = [];
      indicePorTipo[fila.tipo].push({ fecha: fila.fecha, indice: Number(fila.indice) });
    }
  }
  cargado = true;
}

function indiceAsOf(tipo, fechaLimite) {
  const serie = indicePorTipo[tipo] || [];
  let resultado = null;
  for (const punto of serie) {
    if (punto.fecha > fechaLimite) break;
    resultado = punto;
  }
  return resultado;
}

// Devuelve 'ARS' o 'USD' si el ratio pedido es en realidad el precio
// ABSOLUTO de un producto (contra $Pesos o contra U$ BNA) — ahí sí tiene
// sentido ofrecer nominal/constante. Si son dos productos reales entre
// sí, devuelve null (el toggle no cambiaría nada, se oculta).
function tipoIndiceAplicable(idA, idB) {
  if (idA === ID_PESOS || idB === ID_PESOS) return 'ARS';
  if (idA === 'dolar_bna' || idB === 'dolar_bna') return 'USD';
  return null;
}

// Re-expresa una serie nominal en moneda constante, tomando como "hoy" la
// fecha más reciente de la propia serie — así el número de "Actual" no
// cambia al togglear (es el ancla), y todo lo anterior se ajusta relativo
// a eso.
function aplicarDeflactor(serie, tipo) {
  if (!serie.length) return serie;
  const referencia = indiceAsOf(tipo, serie[serie.length - 1].fecha);
  if (!referencia) return serie; // todavía no hay índices cargados (M9)
  return serie
    .map((p) => {
      const indicePunto = indiceAsOf(tipo, p.fecha);
      if (!indicePunto || !indicePunto.indice) return null;
      return { fecha: p.fecha, valor: p.valor * (referencia.indice / indicePunto.indice) };
    })
    .filter(Boolean);
}

// Último valor conocido de un producto a una fecha dada (o antes) — permite
// que un producto que se actualiza con menos frecuencia (ej. carga manual
// mensual) siga apareciendo en la matriz con su último dato, en vez de un
// hueco, igual que el criterio de "arrastre" ya definido para la carga
// manual.
function valorAsOf(productoId, fechaLimite) {
  if (productoId === ID_PESOS) return { fecha: fechaLimite, valorNativo: 1 };
  const serie = historialPorProducto[productoId] || [];
  let resultado = null;
  for (const punto of serie) {
    if (punto.fecha > fechaLimite) break;
    resultado = punto;
  }
  return resultado;
}

// Convierte el valor nativo de un producto a ARS a una fecha dada, usando
// el dólar Banco Nación de esa misma fecha (o la más cercana anterior)
// como ancla — mismo criterio de conversión que ya validamos contra la
// historia real del usuario.
function valorArsAsOf(productoId, fechaLimite) {
  const producto = porId(productoId);
  const punto = valorAsOf(productoId, fechaLimite);
  if (!producto || !punto) return null;
  if (producto.monedaNativa === 'ARS') return punto.valorNativo;
  const dolar = valorAsOf('dolar_bna', fechaLimite);
  if (!dolar) return null;
  return punto.valorNativo * dolar.valorNativo;
}

function ratioAsOf(idA, idB, fechaLimite) {
  const a = valorArsAsOf(idA, fechaLimite);
  const b = valorArsAsOf(idB, fechaLimite);
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

function fechaMasReciente() {
  let max = null;
  for (const serie of Object.values(historialPorProducto)) {
    const ultima = serie[serie.length - 1];
    if (ultima && (!max || ultima.fecha > max)) max = ultima.fecha;
  }
  return max;
}

function formatearRatio(v) {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const decimales = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 4;
  return v.toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

function formatearFecha(iso) {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function renderMatriz() {
  const fechaHoy = fechaMasReciente();
  const tabla = el('matrizTabla');
  if (!fechaHoy) {
    tabla.innerHTML = '<caption>Todavía no hay datos cargados en $Rel.</caption>';
    return;
  }

  const productos = productosVisibles();
  let theadHtml = '<thead><tr><th></th>';
  for (const p of productos) theadHtml += `<th>${p.corto}</th>`;
  theadHtml += '</tr></thead>';

  let tbodyHtml = '<tbody>';
  for (const filaProd of productos) {
    tbodyHtml += `<tr><th>${filaProd.corto}</th>`;
    for (const colProd of productos) {
      if (filaProd.id === colProd.id) {
        tbodyHtml += '<td class="celda-diagonal">—</td>';
        continue;
      }
      const v = ratioAsOf(filaProd.id, colProd.id, fechaHoy);
      tbodyHtml += `<td class="celda-ratio" data-a="${filaProd.id}" data-b="${colProd.id}">${formatearRatio(v)}</td>`;
    }
    tbodyHtml += '</tr>';
  }
  tbodyHtml += '</tbody>';

  tabla.innerHTML = `<caption>Datos al ${formatearFecha(fechaHoy)}. Fila ÷ columna — dividí por "$ Pesos" o "U$ BNA" para ver el precio nominal en pesos o dólares.</caption>${theadHtml}${tbodyHtml}`;

  tabla.querySelectorAll('.celda-ratio').forEach((celda) => {
    celda.addEventListener('click', () => abrirDrillDown(celda.dataset.a, celda.dataset.b));
  });
}

// ── Drill-down: histórico de un ratio puntual ──
let drillActualA = null;
let drillActualB = null;
let drillPeriodoMeses = 24; // default
let drillModoValor = 'nominal'; // 'nominal' | 'real' — solo aplica a valores absolutos

function serieRatio(idA, idB) {
  const fechasA = (historialPorProducto[idA] || []).map((p) => p.fecha);
  const fechasB = (historialPorProducto[idB] || []).map((p) => p.fecha);
  const todasFechas = Array.from(new Set([...fechasA, ...fechasB])).sort();
  return todasFechas
    .map((fecha) => ({ fecha, valor: ratioAsOf(idA, idB, fecha) }))
    .filter((p) => p.valor != null);
}

function filtrarPorPeriodo(serie, meses) {
  if (!meses || !serie.length) return serie;
  const fechaMax = new Date(serie[serie.length - 1].fecha);
  const fechaCorte = new Date(fechaMax);
  fechaCorte.setMonth(fechaCorte.getMonth() - meses);
  const corteIso = fechaCorte.toISOString().slice(0, 10);
  return serie.filter((p) => p.fecha >= corteIso);
}

function svgLineChart(puntos, ancho, alto) {
  if (puntos.length < 2) return '<div class="chart-vacio">No hay suficientes datos para graficar.</div>';
  const valores = puntos.map((p) => p.valor);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const margen = 24;
  const rango = max - min || 1;
  const coordenadas = puntos.map((p, i) => {
    const x = margen + (i / (puntos.length - 1)) * (ancho - margen * 2);
    const y = alto - margen - ((p.valor - min) / rango) * (alto - margen * 2);
    return [x, y];
  });
  const path = coordenadas.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const ultimo = coordenadas[coordenadas.length - 1];
  return `
    <svg viewBox="0 0 ${ancho} ${alto}" class="chart-svg">
      <path d="${path}" fill="none" stroke="#8a5a34" stroke-width="2"/>
      <circle cx="${ultimo[0]}" cy="${ultimo[1]}" r="3.5" fill="#8a5a34"/>
      <text x="${margen}" y="14" class="chart-etiqueta">${formatearRatio(max)}</text>
      <text x="${margen}" y="${alto - 8}" class="chart-etiqueta">${formatearRatio(min)}</text>
    </svg>
  `;
}

function renderDrillDown() {
  const a = porId(drillActualA);
  const b = porId(drillActualB);
  el('drillTitulo').textContent = `${a.nombre} ÷ ${b.nombre}`;

  const tipoIndice = tipoIndiceAplicable(drillActualA, drillActualB);
  el('drillModoValorWrap').classList.toggle('oculto', !tipoIndice);
  el('drillModoValorNota').classList.toggle('oculto', !!tipoIndice);
  if (!tipoIndice) drillModoValor = 'nominal';

  let serieCompleta = serieRatio(drillActualA, drillActualB);
  if (tipoIndice && drillModoValor === 'real') {
    serieCompleta = aplicarDeflactor(serieCompleta, tipoIndice);
  }
  const serie = filtrarPorPeriodo(serieCompleta, drillPeriodoMeses);

  document.querySelectorAll('.drill-periodo-btn').forEach((btn) => {
    btn.classList.toggle('activo', Number(btn.dataset.meses || 0) === drillPeriodoMeses);
  });
  document.querySelectorAll('.drill-modo-btn').forEach((btn) => {
    btn.classList.toggle('activo', btn.dataset.modo === drillModoValor);
  });

  if (!serie.length) {
    el('drillGrafico').innerHTML = '<div class="chart-vacio">No hay datos para este período.</div>';
    el('drillResumen').textContent = '';
    return;
  }

  el('drillGrafico').innerHTML = svgLineChart(serie, 600, 220);

  const actual = serie[serie.length - 1].valor;
  const valores = serie.map((p) => p.valor);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  el('drillResumen').innerHTML = `
    Actual (${formatearFecha(serie[serie.length - 1].fecha)}): <strong>${formatearRatio(actual)}</strong>
    &nbsp;·&nbsp; Mínimo del período: ${formatearRatio(min)}
    &nbsp;·&nbsp; Máximo del período: ${formatearRatio(max)}
  `;
}

function abrirDrillDown(idA, idB) {
  drillActualA = idA;
  drillActualB = idB;
  renderDrillDown();
  el('modalDrillDown').classList.add('abierto');
}

function cerrarDrillDown() {
  el('modalDrillDown').classList.remove('abierto');
}

// Dispara las funciones de scraping/snapshot manualmente, sin esperar al
// cron nocturno — mismo resultado que dejar que corran solas, solo que
// ahora mismo. Cada una guarda directo en la base con service role, así
// que alcanza con invocarlas y esperar a que terminen.
async function actualizarAhora() {
  const boton = el('botonActualizarAhora');
  const msj = el('actualizarAhoraMensaje');
  boton.disabled = true;
  msj.textContent = 'Actualizando…';
  msj.className = 'mensaje';

  try {
    const res = await fetch(`/.netlify/functions/${FUNCION_ACTUALIZAR}`);
    const datos = await res.json();
    const fallidas = Object.entries(datos).filter(([, r]) => r && r.ok === false).map(([nombre]) => nombre);
    if (fallidas.length) {
      msj.textContent = `⚠️ No se pudo actualizar: ${fallidas.join(', ')}. El resto sí se actualizó.`;
      msj.className = 'mensaje advertencia';
    } else {
      msj.textContent = '✅ Datos actualizados.';
      msj.className = 'mensaje ok';
    }
  } catch (error) {
    msj.textContent = '⚠️ No se pudo actualizar: ' + error.message;
    msj.className = 'mensaje advertencia';
  }

  boton.disabled = false;
  cargado = false; // fuerza a que el próximo refrescarMatriz() vuelva a traer todo
  await refrescarMatriz();
}

export async function initMatriz() {
  document.querySelectorAll('.drill-periodo-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      drillPeriodoMeses = Number(btn.dataset.meses || 0) || null;
      renderDrillDown();
    });
  });
  document.querySelectorAll('.drill-modo-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      drillModoValor = btn.dataset.modo;
      renderDrillDown();
    });
  });
  el('drillCerrar').addEventListener('click', cerrarDrillDown);
  el('modalDrillDownFondo').addEventListener('click', cerrarDrillDown);

  // Disparar scrapers a demanda queda para owner — no tiene sentido que
  // cualquier usuario autorizado ande pegándole a fuentes externas cada
  // vez que abre la pantalla.
  if (getEstado().perfil?.rol === 'owner') {
    el('botonActualizarAhora').classList.remove('oculto');
    el('botonActualizarAhora').addEventListener('click', actualizarAhora);
  }
}

export async function refrescarMatriz() {
  await cargarHistorialCompleto();
  renderMatriz();
}
