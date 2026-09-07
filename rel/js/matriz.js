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
// configPorPar['idMenor|idMayor'] = fila de precios_relativos_ratios_config
// o undefined si nadie configuró ese par. Orden alfabético fijo (coincide
// con el check producto_a_id < producto_b_id de la tabla).
let configPorPar = {};
let cargado = false;

async function cargarHistorialCompleto() {
  if (cargado) return;
  const [
    { data: historial, error: errorHistorial },
    { data: indices, error: errorIndices },
    { data: configs, error: errorConfigs },
  ] = await Promise.all([
    supabase.from('precios_relativos_historial').select('producto_id, fecha, valor_nativo').order('fecha', { ascending: true }),
    supabase.from('precios_relativos_indices').select('tipo, fecha, indice').order('fecha', { ascending: true }),
    supabase.from('precios_relativos_ratios_config').select('*'),
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
  configPorPar = {};
  if (!errorConfigs && configs) {
    for (const fila of configs) {
      configPorPar[`${fila.producto_a_id}|${fila.producto_b_id}`] = fila;
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

// Promedio del valor nativo de un producto dentro de un mes ('YYYY-MM').
// Si ese mes no tiene ningún dato propio (típico en productos que se
// cargan cada tanto, no todos los días), cae al último valor conocido
// hasta el último día de ese mes — mismo criterio "arrastre" que el resto
// de la matriz, para no dejar la celda vacía.
function promedioNativoDelMes(productoId, anioMes) {
  if (productoId === ID_PESOS) return 1;
  const serie = historialPorProducto[productoId] || [];
  const puntosDelMes = serie.filter((p) => p.fecha.slice(0, 7) === anioMes);
  if (puntosDelMes.length) {
    return puntosDelMes.reduce((suma, p) => suma + p.valorNativo, 0) / puntosDelMes.length;
  }
  const punto = valorAsOf(productoId, `${anioMes}-31`);
  return punto ? punto.valorNativo : null;
}

function valorArsPromedioMensual(productoId, anioMes) {
  const producto = porId(productoId);
  if (!producto) return null;
  const nativo = promedioNativoDelMes(productoId, anioMes);
  if (nativo == null) return null;
  if (producto.monedaNativa === 'ARS') return nativo;
  const dolarProm = promedioNativoDelMes('dolar_bna', anioMes);
  if (dolarProm == null) return null;
  return nativo * dolarProm;
}

function ratioPromedioMensual(idA, idB, anioMes) {
  const a = valorArsPromedioMensual(idA, anioMes);
  const b = valorArsPromedioMensual(idB, anioMes);
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

// ── Modo de la matriz: instantánea a una fecha, o promedio de un mes ──
let matrizModo = 'instantanea'; // 'instantanea' | 'promedio_mensual'
let matrizFechaSeleccionada = null; // 'YYYY-MM-DD', solo instantánea
let matrizMesSeleccionado = null; // 'YYYY-MM', solo promedio_mensual

function formatearMes(anioMes) {
  if (!anioMes) return '-';
  const [y, m] = anioMes.split('-');
  const NOMBRES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${NOMBRES[Number(m) - 1]} ${y}`;
}

function renderMatriz() {
  const fechaHoy = fechaMasReciente();
  const tabla = el('matrizTabla');
  if (!fechaHoy) {
    tabla.innerHTML = '<caption>Todavía no hay datos cargados en $Rel.</caption>';
    return;
  }
  if (!matrizFechaSeleccionada) matrizFechaSeleccionada = fechaHoy;
  if (!matrizMesSeleccionado) matrizMesSeleccionado = fechaHoy.slice(0, 7);
  el('matrizFechaInput').max = fechaHoy;
  el('matrizFechaInput').value = matrizFechaSeleccionada;
  el('matrizMesInput').max = fechaHoy.slice(0, 7);
  el('matrizMesInput').value = matrizMesSeleccionado;

  const esInstantanea = matrizModo === 'instantanea';
  const fechaReferencia = esInstantanea ? matrizFechaSeleccionada : matrizMesSeleccionado;
  const calcularRatio = esInstantanea
    ? (a, b) => ratioAsOf(a, b, matrizFechaSeleccionada)
    : (a, b) => ratioPromedioMensual(a, b, matrizMesSeleccionado);
  // Las alertas reflejan el estado de HOY, no el de la fecha que se esté
  // mirando — para no confundir "está en rojo" con "estaba en rojo ese
  // día". Solo se muestran cuando la vista coincide con la más reciente.
  const mostrarAlertas = esInstantanea && matrizFechaSeleccionada === fechaHoy;

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
      const v = calcularRatio(filaProd.id, colProd.id);
      const alerta = mostrarAlertas ? estadoAlertaParaPar(filaProd.id, colProd.id) : null;
      const claseAlerta = alerta?.estado === 'caro' ? ' celda-alerta-caro' : alerta?.estado === 'barato' ? ' celda-alerta-barato' : '';
      const icono = alerta?.estado === 'caro' ? ' 🔴' : alerta?.estado === 'barato' ? ' 🟢' : '';
      tbodyHtml += `<td class="celda-ratio${claseAlerta}" data-a="${filaProd.id}" data-b="${colProd.id}">${formatearRatio(v)}${icono}</td>`;
    }
    tbodyHtml += '</tr>';
  }
  tbodyHtml += '</tbody>';

  const leyendaFecha = esInstantanea
    ? `Datos al ${formatearFecha(matrizFechaSeleccionada)}`
    : `Promedio de ${formatearMes(matrizMesSeleccionado)}`;
  tabla.innerHTML = `<caption>${leyendaFecha}. Fila ÷ columna — dividí por "$ Pesos" o "U$ BNA" para ver el precio nominal en pesos o dólares.</caption>${theadHtml}${tbodyHtml}`;

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

// ── Alertas por ratio (percentil histórico y/o desvío % del promedio) ──
// $ Pesos es sintético (no existe en precios_relativos_productos, ver
// ID_PESOS más arriba), así que no puede tener fila de config — no se
// pueden armar alertas contra esa columna.
function clavePar(idA, idB) {
  return [idA, idB].sort().join('|');
}

function configDePar(idA, idB) {
  return configPorPar[clavePar(idA, idB)];
}

// Percentil del último valor de la serie dentro de su propia ventana: qué
// fracción de los valores del período es <= al actual.
function percentilActual(serie) {
  if (serie.length < 2) return null;
  const actual = serie[serie.length - 1].valor;
  const menoresOIguales = serie.filter((p) => p.valor <= actual).length;
  return (menoresOIguales / serie.length) * 100;
}

// Desvío % del último valor respecto al promedio de toda la ventana.
function desviacionActual(serie) {
  if (serie.length < 2) return null;
  const actual = serie[serie.length - 1].valor;
  const promedio = serie.reduce((suma, p) => suma + p.valor, 0) / serie.length;
  if (!promedio) return null;
  return ((actual - promedio) / promedio) * 100;
}

// Evalúa una config en su dirección CANÓNICA (producto_a_id ÷ producto_b_id
// — así se guardó, ver el check de la tabla) y devuelve el estado en esa
// dirección. estadoAlertaParaPar() se encarga de invertirlo si hace falta
// para la dirección que se está mostrando.
function evaluarConfig(config) {
  const tipoIndice = tipoIndiceAplicable(config.producto_a_id, config.producto_b_id);
  let serie = serieRatio(config.producto_a_id, config.producto_b_id);
  if (tipoIndice && (config.base === 'real_ars' || config.base === 'real_usd')) {
    serie = aplicarDeflactor(serie, tipoIndice);
  }
  serie = filtrarPorPeriodo(serie, config.ventana_meses);
  if (serie.length < 2) return null;

  const percentil = percentilActual(serie);
  const desviacionPct = desviacionActual(serie);

  let estado = 'neutral';
  const evaluarPercentil = () => {
    if (percentil == null) return 'neutral';
    if (percentil <= config.umbral_percentil_bajo) return 'barato';
    if (percentil >= config.umbral_percentil_alto) return 'caro';
    return 'neutral';
  };
  const evaluarDesvio = () => {
    if (desviacionPct == null) return 'neutral';
    if (desviacionPct <= -config.umbral_desvio_pct) return 'barato';
    if (desviacionPct >= config.umbral_desvio_pct) return 'caro';
    return 'neutral';
  };

  if (config.metodo === 'percentil') estado = evaluarPercentil();
  else if (config.metodo === 'desvio') estado = evaluarDesvio();
  else { // 'ambos': el primero que dispare gana
    const porPercentil = evaluarPercentil();
    const porDesvio = evaluarDesvio();
    estado = porPercentil !== 'neutral' ? porPercentil : porDesvio;
  }

  return { estado, percentil, desviacionPct };
}

function invertirEstado(estado) {
  if (estado === 'caro') return 'barato';
  if (estado === 'barato') return 'caro';
  return estado;
}

// Estado de alerta para el par mostrado en (idA, idB) — puede venir
// invertido respecto a cómo se guardó la config (esta siempre está en
// orden alfabético). null si no hay config, no está activa, o no hay datos
// suficientes.
function estadoAlertaParaPar(idA, idB) {
  const config = configDePar(idA, idB);
  if (!config || !config.alerta_activa) return null;
  const resultado = evaluarConfig(config);
  if (!resultado) return null;
  const esInverso = config.producto_a_id === idB && config.producto_b_id === idA;
  if (!esInverso) return resultado;
  return {
    ...resultado,
    estado: invertirEstado(resultado.estado),
    percentil: resultado.percentil == null ? null : 100 - resultado.percentil,
  };
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

// ── Panel de configuración de alerta (dentro del drill-down) ──
// Los umbrales/método/ventana se configuran SIEMPRE en la dirección
// canónica alfabética (idA < idB, igual que se guarda en la tabla), no en
// la dirección que se esté mirando en pantalla — así "percentil alto =
// caro" significa siempre lo mismo sin importar desde qué celda se abrió
// el drill-down. Por eso la nota de dirección es explícita.
function renderAlertaPanel() {
  const excluido = drillActualA === ID_PESOS || drillActualB === ID_PESOS;
  el('alertaSinPesosNota').classList.toggle('oculto', !excluido);
  el('alertaDireccionNota').classList.toggle('oculto', excluido);
  el('alertaFormWrap').classList.toggle('oculto', excluido);
  el('alertaEstadoActual').classList.toggle('oculto', excluido);
  if (excluido) return;

  const [idCanonA, idCanonB] = [drillActualA, drillActualB].sort();
  const config = configPorPar[`${idCanonA}|${idCanonB}`];

  el('alertaDireccionNota').textContent = `Esta alerta se configura para: ${porId(idCanonA).nombre} ÷ ${porId(idCanonB).nombre}.`;
  el('alertaFavorito').checked = !!(config && config.favorito);
  el('alertaActiva').checked = !!(config && config.alerta_activa);
  el('alertaMetodo').value = (config && config.metodo) || 'ambos';
  el('alertaVentana').value = String((config && config.ventana_meses) || 24);
  el('alertaUmbralDesvio').value = (config && config.umbral_desvio_pct) ?? 15;
  el('alertaUmbralPercentilBajo').value = (config && config.umbral_percentil_bajo) ?? 10;
  el('alertaUmbralPercentilAlto').value = (config && config.umbral_percentil_alto) ?? 90;
  const esReal = !!(config && (config.base === 'real_ars' || config.base === 'real_usd'));
  el('alertaBase').value = esReal ? 'real' : 'nominal';

  el('alertaBaseWrap').classList.toggle('oculto', !tipoIndiceAplicable(idCanonA, idCanonB));
  el('alertaOpciones').classList.toggle('oculto', !el('alertaActiva').checked);
  el('alertaMensaje').textContent = '';

  const alerta = estadoAlertaParaPar(drillActualA, drillActualB);
  const estadoEl = el('alertaEstadoActual');
  if (!config || !config.alerta_activa) {
    estadoEl.textContent = '';
    estadoEl.className = 'alerta-estado-actual';
  } else if (!alerta) {
    estadoEl.textContent = 'Todavía no hay datos suficientes para evaluar esta alerta.';
    estadoEl.className = 'alerta-estado-actual';
  } else {
    const texto = alerta.estado === 'caro' ? '🔴 En zona de "caro" respecto a su historia.'
      : alerta.estado === 'barato' ? '🟢 En zona de "barato" respecto a su historia.'
      : '⚪ En rango normal, sin alerta.';
    const detalle = alerta.percentil != null ? ` (percentil ${alerta.percentil.toFixed(0)})` : '';
    estadoEl.textContent = texto + detalle;
    estadoEl.className = `alerta-estado-actual ${alerta.estado}`;
  }
}

async function guardarAlerta() {
  if (drillActualA === ID_PESOS || drillActualB === ID_PESOS) return;
  const msj = el('alertaMensaje');
  msj.textContent = '';

  const [idCanonA, idCanonB] = [drillActualA, drillActualB].sort();
  const tipoIndice = tipoIndiceAplicable(idCanonA, idCanonB);
  const esReal = el('alertaBase').value === 'real';
  const base = esReal && tipoIndice === 'ARS' ? 'real_ars' : esReal && tipoIndice === 'USD' ? 'real_usd' : 'nominal_ars';

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { msj.textContent = 'No hay sesión activa.'; msj.className = 'mensaje full error'; return; }

  const { error } = await supabase.from('precios_relativos_ratios_config').upsert({
    producto_a_id: idCanonA,
    producto_b_id: idCanonB,
    favorito: el('alertaFavorito').checked,
    alerta_activa: el('alertaActiva').checked,
    metodo: el('alertaMetodo').value,
    ventana_meses: Number(el('alertaVentana').value),
    base,
    umbral_desvio_pct: Number(el('alertaUmbralDesvio').value) || 15,
    umbral_percentil_bajo: Number(el('alertaUmbralPercentilBajo').value),
    umbral_percentil_alto: Number(el('alertaUmbralPercentilAlto').value),
  }, { onConflict: 'producto_a_id,producto_b_id' });

  if (error) {
    msj.textContent = 'No se pudo guardar: ' + error.message;
    msj.className = 'mensaje full error';
    return;
  }
  msj.textContent = '✅ Guardado.';
  msj.className = 'mensaje full ok';

  cargado = false;
  await cargarHistorialCompleto();
  renderMatriz();
  renderAlertaPanel();
}

function abrirDrillDown(idA, idB) {
  drillActualA = idA;
  drillActualB = idB;
  renderDrillDown();
  renderAlertaPanel();
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

  document.querySelectorAll('.matriz-modo-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      matrizModo = btn.dataset.modo;
      document.querySelectorAll('.matriz-modo-btn').forEach((b) => b.classList.toggle('activo', b === btn));
      el('matrizFechaInput').classList.toggle('oculto', matrizModo !== 'instantanea');
      el('matrizMesInput').classList.toggle('oculto', matrizModo !== 'promedio_mensual');
      renderMatriz();
    });
  });
  el('matrizFechaInput').addEventListener('change', (evento) => {
    if (evento.target.value) matrizFechaSeleccionada = evento.target.value;
    renderMatriz();
  });
  el('matrizMesInput').addEventListener('change', (evento) => {
    if (evento.target.value) matrizMesSeleccionado = evento.target.value;
    renderMatriz();
  });

  el('alertaToggleBtn').addEventListener('click', () => {
    el('alertaPanel').classList.toggle('oculto');
  });
  el('alertaActiva').addEventListener('change', () => {
    el('alertaOpciones').classList.toggle('oculto', !el('alertaActiva').checked);
  });
  el('botonGuardarAlerta').addEventListener('click', guardarAlerta);

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
