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

// Supabase/PostgREST limita cada respuesta a 1000 filas por default — con
// más de un año de histórico diario × 13 productos ya se supera esa cifra.
// Sin paginar, `.order('fecha', {ascending:true})` devuelve solo las 1000
// filas más VIEJAS y corta ahí, haciendo que "la fecha más reciente"
// parezca congelada muy atrás en el tiempo (bug real detectado en
// producción). Se pagina con `.range()` hasta agotar los resultados.
const TAMANO_PAGINA = 1000;

async function fetchTodasLasFilas(tabla, columnas, ordenarPor) {
  let desde = 0;
  let todas = [];
  while (true) {
    const { data, error } = await supabase
      .from(tabla)
      .select(columnas)
      .order(ordenarPor, { ascending: true })
      .range(desde, desde + TAMANO_PAGINA - 1);
    if (error) return { data: null, error };
    todas = todas.concat(data);
    if (data.length < TAMANO_PAGINA) break;
    desde += TAMANO_PAGINA;
  }
  return { data: todas, error: null };
}

async function cargarHistorialCompleto() {
  if (cargado) return;
  const [
    { data: historial, error: errorHistorial },
    { data: indices, error: errorIndices },
    { data: configs, error: errorConfigs },
  ] = await Promise.all([
    fetchTodasLasFilas('precios_relativos_historial', 'producto_id, fecha, valor_nativo', 'fecha'),
    fetchTodasLasFilas('precios_relativos_indices', 'tipo, fecha, indice', 'fecha'),
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
  // Las alertas reflejan el estado de HOY, no el de la fecha/mes que se
  // esté mirando — para no confundir "está en rojo" con "estaba en rojo
  // esa vez". Se muestran mientras la vista sea "el presente": la fecha
  // más reciente en instantánea, o el mes en curso en promedio mensual.
  const mostrarAlertas = esInstantanea
    ? matrizFechaSeleccionada === fechaHoy
    : matrizMesSeleccionado === fechaHoy.slice(0, 7);

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
      tbodyHtml += `<td class="celda-ratio${claseAlerta}" data-a="${filaProd.id}" data-b="${colProd.id}">${formatearRatio(v)}</td>`;
    }
    tbodyHtml += '</tr>';
  }
  tbodyHtml += '</tbody>';

  const leyendaFecha = esInstantanea
    ? `Datos al ${formatearFecha(matrizFechaSeleccionada)}`
    : `Promedio de ${formatearMes(matrizMesSeleccionado)}`;
  tabla.innerHTML = `<caption>${leyendaFecha}.</caption>${theadHtml}${tbodyHtml}`;

  tabla.querySelectorAll('.celda-ratio').forEach((celda) => {
    celda.addEventListener('click', () => abrirDrillDown(celda.dataset.a, celda.dataset.b));
  });
}

// ── Drill-down: histórico de un ratio puntual ──
let drillActualA = null;
let drillActualB = null;
let drillPeriodoMeses = 24; // default
let drillModoValor = 'nominal'; // 'nominal' | 'real' — solo aplica a valores absolutos
let drillRangoPersonalizado = null; // { desde, hasta } | null — si está seteado, gana sobre drillPeriodoMeses

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

function filtrarPorRango(serie, desde, hasta) {
  return serie.filter((p) => (!desde || p.fecha >= desde) && (!hasta || p.fecha <= hasta));
}

// Último valor conocido en o antes de (fecha más reciente de la serie −
// meses) — para variación interanual/intermensual. Busca DENTRO de la
// propia serie ya calculada (no vuelve a pegarle a historialPorProducto),
// para que respete el modo nominal/constante ya aplicado.
function valorHaceMeses(serieCompleta, meses) {
  if (!serieCompleta.length) return null;
  const fechaRef = new Date(`${serieCompleta[serieCompleta.length - 1].fecha}T00:00:00`);
  fechaRef.setMonth(fechaRef.getMonth() - meses);
  const fechaIso = fechaRef.toISOString().slice(0, 10);
  let resultado = null;
  for (const p of serieCompleta) {
    if (p.fecha > fechaIso) break;
    resultado = p;
  }
  return resultado ? resultado.valor : null;
}

function calcularVariacionPct(actual, anterior) {
  if (actual == null || anterior == null || !anterior) return null;
  return ((actual - anterior) / anterior) * 100;
}

function puntosUltimosMeses(serieCompleta, meses) {
  if (!serieCompleta.length) return [];
  const fechaMax = serieCompleta[serieCompleta.length - 1].fecha;
  const corte = new Date(`${fechaMax}T00:00:00`);
  corte.setMonth(corte.getMonth() - meses);
  const corteIso = corte.toISOString().slice(0, 10);
  return serieCompleta.filter((p) => p.fecha >= corteIso);
}

function promedioUltimosMeses(serieCompleta, meses) {
  const puntos = puntosUltimosMeses(serieCompleta, meses);
  if (!puntos.length) return null;
  return puntos.reduce((suma, p) => suma + p.valor, 0) / puntos.length;
}

function maximoHistorico(serieCompleta) {
  if (!serieCompleta.length) return null;
  return Math.max(...serieCompleta.map((p) => p.valor));
}

// ── Alertas por ratio (percentil histórico y/o desvío % del promedio) ──
// $ Pesos es sintético (no existe en precios_relativos_productos, ver
// ID_PESOS más arriba), así que no puede tener fila de config — no se
// pueden armar alertas contra esa columna. Cualquier otro par (incluidos
// los que van contra "Dólar Banco Nación", ej. Maíz÷Dólar = precio del
// maíz en dólares) sí puede tener alerta.

// Valores por defecto de una alerta: TODOS los pares (menos $ Pesos, que no
// puede tener config — no es un producto real) arrancan con la alerta
// ACTIVA usando estos valores, hasta que alguien la guarde explícitamente
// apagada. Así el usuario ve todo de entrada y va sacando lo que no le
// sirve, en vez de tener que prender par por par.
const ALERTA_DEFAULT = {
  favorito: false,
  alerta_activa: true,
  metodo: 'ambos',
  ventana_meses: 24,
  base: 'nominal_ars',
  umbral_desvio_pct: 15,
  umbral_percentil_bajo: 10,
  umbral_percentil_alto: 90,
};

// Config real (guardada) para el par, o un objeto con los valores por
// defecto si nadie la personalizó todavía. null solo si el par no puede
// tener alerta ($ Pesos).
function configDePar(idA, idB) {
  if (idA === ID_PESOS || idB === ID_PESOS) return null;
  const [a, b] = [idA, idB].sort();
  const guardada = configPorPar[`${a}|${b}`];
  if (guardada) return guardada;
  return { producto_a_id: a, producto_b_id: b, personalizada: false, ...ALERTA_DEFAULT };
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

// Evalúa la alerta directamente en la dirección que se está MOSTRANDO
// (idA ÷ idB, tal cual se pidió) — no en la canónica. Como serieRatio(idA,
// idB) siempre calcula el ratio de verdad en ESE sentido, un valor "alto"
// siempre significa "idA caro respecto a idB" sin importar en qué orden se
// haya guardado la config (el orden guardado es solo para no duplicar fila
// A÷B y B÷A — los umbrales/método/ventana son los mismos para el par,
// mirado desde cualquier lado).
function evaluarParEnDireccion(idA, idB, config) {
  const tipoIndice = tipoIndiceAplicable(idA, idB);
  let serie = serieRatio(idA, idB);
  if (tipoIndice && (config.base === 'real_ars' || config.base === 'real_usd')) {
    serie = aplicarDeflactor(serie, tipoIndice);
  }
  serie = filtrarPorPeriodo(serie, config.ventana_meses);
  if (serie.length < 2) return null;

  const percentil = percentilActual(serie);
  const desviacionPct = desviacionActual(serie);

  function evaluarPercentil() {
    if (percentil == null) return { estado: 'neutral', detalle: null };
    if (percentil <= config.umbral_percentil_bajo) return { estado: 'barato', detalle: `percentil ${percentil.toFixed(0)} (umbral ≤${config.umbral_percentil_bajo})` };
    if (percentil >= config.umbral_percentil_alto) return { estado: 'caro', detalle: `percentil ${percentil.toFixed(0)} (umbral ≥${config.umbral_percentil_alto})` };
    return { estado: 'neutral', detalle: `percentil ${percentil.toFixed(0)}` };
  }
  function evaluarDesvio() {
    if (desviacionPct == null) return { estado: 'neutral', detalle: null };
    const signo = desviacionPct > 0 ? '+' : '';
    if (desviacionPct <= -config.umbral_desvio_pct) return { estado: 'barato', detalle: `${signo}${desviacionPct.toFixed(1)}% del promedio (umbral ±${config.umbral_desvio_pct}%)` };
    if (desviacionPct >= config.umbral_desvio_pct) return { estado: 'caro', detalle: `${signo}${desviacionPct.toFixed(1)}% del promedio (umbral ±${config.umbral_desvio_pct}%)` };
    return { estado: 'neutral', detalle: `${signo}${desviacionPct.toFixed(1)}% del promedio` };
  }

  const porPercentil = config.metodo === 'percentil' || config.metodo === 'ambos' ? evaluarPercentil() : null;
  const porDesvio = config.metodo === 'desvio' || config.metodo === 'ambos' ? evaluarDesvio() : null;

  let estado = 'neutral';
  let motivo = null;
  if (porPercentil && porPercentil.estado !== 'neutral') { estado = porPercentil.estado; motivo = `Percentil: ${porPercentil.detalle}`; }
  else if (porDesvio && porDesvio.estado !== 'neutral') { estado = porDesvio.estado; motivo = `Desvío: ${porDesvio.detalle}`; }

  const detalles = [];
  if (porPercentil) detalles.push(`Percentil: ${porPercentil.detalle}`);
  if (porDesvio) detalles.push(`Desvío: ${porDesvio.detalle}`);

  return { estado, motivo, detalles, ventanaMeses: config.ventana_meses };
}

// Estado de alerta para el par mostrado en (idA, idB). null si no hay
// config, no está activa, o no hay datos suficientes en la ventana.
function estadoAlertaParaPar(idA, idB) {
  const config = configDePar(idA, idB);
  if (!config || !config.alerta_activa) return null;
  return evaluarParEnDireccion(idA, idB, config);
}

function formatearFechaCorta(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

// Chart en SVG puro (sin librerías, coherente con el resto del proyecto):
// ejes con grilla horizontal (valores) y etiquetas de fecha (eje X), más
// una capa transparente que captura el mouse para el hover — mostrar fecha
// y valor exactos del punto más cercano, con una línea guía + punto
// resaltado sobre la curva.
function svgLineChart(puntos, ancho, alto) {
  if (puntos.length < 2) return '<div class="chart-vacio">No hay suficientes datos para graficar.</div>';
  const valores = puntos.map((p) => p.valor);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const margenIzq = 68;
  const margenDer = 14;
  const margenSup = 14;
  const margenInf = 30;
  const anchoUtil = ancho - margenIzq - margenDer;
  const altoUtil = alto - margenSup - margenInf;
  const rango = max - min || 1;

  const coordenadas = puntos.map((p, i) => ({
    x: margenIzq + (i / (puntos.length - 1)) * anchoUtil,
    y: margenSup + altoUtil - ((p.valor - min) / rango) * altoUtil,
    fecha: p.fecha,
    valor: p.valor,
  }));

  const path = coordenadas.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  const NUM_LINEAS_Y = 4;
  let gridY = '';
  for (let i = 0; i <= NUM_LINEAS_Y; i++) {
    const frac = i / NUM_LINEAS_Y;
    const y = margenSup + altoUtil * frac;
    const valor = max - rango * frac;
    gridY += `<line x1="${margenIzq}" y1="${y.toFixed(1)}" x2="${ancho - margenDer}" y2="${y.toFixed(1)}" class="chart-grid"/>`;
    gridY += `<text x="${margenIzq - 6}" y="${(y + 3).toFixed(1)}" class="chart-etiqueta-y" text-anchor="end">${formatearRatio(valor)}</text>`;
  }

  const numEtiquetasX = Math.min(5, coordenadas.length);
  let etiquetasX = '';
  for (let i = 0; i < numEtiquetasX; i++) {
    const idx = numEtiquetasX === 1 ? 0 : Math.round((i / (numEtiquetasX - 1)) * (coordenadas.length - 1));
    const c = coordenadas[idx];
    etiquetasX += `<text x="${c.x.toFixed(1)}" y="${alto - margenInf + 16}" class="chart-etiqueta-x" text-anchor="middle">${formatearFechaCorta(c.fecha)}</text>`;
  }

  const ultimo = coordenadas[coordenadas.length - 1];
  const datosJson = JSON.stringify(coordenadas).replace(/"/g, '&quot;');

  return `
    <svg viewBox="0 0 ${ancho} ${alto}" class="chart-svg" id="chartSvgActual"
         data-margen-izq="${margenIzq}" data-ancho-util="${anchoUtil}"
         data-margen-sup="${margenSup}" data-alto-inf="${alto - margenInf}"
         data-puntos="${datosJson}">
      ${gridY}
      <path d="${path}" fill="none" stroke="#8a5a34" stroke-width="2"/>
      <circle cx="${ultimo.x.toFixed(1)}" cy="${ultimo.y.toFixed(1)}" r="3.5" fill="#8a5a34"/>
      ${etiquetasX}
      <g id="chartHoverGrupo" class="oculto">
        <line id="chartHoverLinea" y1="${margenSup}" y2="${alto - margenInf}" class="chart-hover-linea"/>
        <circle id="chartHoverPunto" r="4" fill="#ad1e19"/>
        <rect id="chartHoverFondo" class="chart-hover-fondo" rx="4"/>
        <text id="chartHoverTexto" class="chart-hover-texto"></text>
      </g>
      <rect x="${margenIzq}" y="${margenSup}" width="${anchoUtil}" height="${altoUtil}"
            fill="transparent" id="chartHoverCaptura" style="cursor:crosshair;"/>
    </svg>
  `;
}

// Cablea el hover del gráfico recién insertado en el DOM — se llama
// después de setear innerHTML porque necesita el <svg> ya en el árbol.
function wireHoverChart() {
  const svg = el('chartSvgActual');
  if (!svg) return;
  const captura = el('chartHoverCaptura');
  const grupo = el('chartHoverGrupo');
  const linea = el('chartHoverLinea');
  const punto = el('chartHoverPunto');
  const fondo = el('chartHoverFondo');
  const texto = el('chartHoverTexto');

  const margenIzq = Number(svg.dataset.margenIzq);
  const anchoUtil = Number(svg.dataset.anchoUtil);
  const margenSup = Number(svg.dataset.margenSup);
  const altoInf = Number(svg.dataset.altoInf);
  const puntos = JSON.parse(svg.dataset.puntos.replace(/&quot;/g, '"'));

  function mostrarEnIndice(idx) {
    const c = puntos[idx];
    linea.setAttribute('x1', c.x);
    linea.setAttribute('x2', c.x);
    punto.setAttribute('cx', c.x);
    punto.setAttribute('cy', c.y);
    texto.textContent = `${formatearFechaCorta(c.fecha)} · ${formatearRatio(c.valor)}`;
    grupo.classList.remove('oculto');

    // El texto se ancla a la izquierda o derecha del punto según de qué
    // lado quede más lugar, para que no se salga del gráfico.
    const anchoAprox = texto.textContent.length * 6.5 + 12;
    const haciaLaIzquierda = c.x + anchoAprox > margenIzq + anchoUtil;
    const xTexto = haciaLaIzquierda ? c.x - anchoAprox - 8 : c.x + 8;
    const yTexto = c.y > margenSup + 20 ? c.y - 10 : c.y + 22;
    texto.setAttribute('x', xTexto + 6);
    texto.setAttribute('y', yTexto);
    fondo.setAttribute('x', xTexto);
    fondo.setAttribute('y', yTexto - 13);
    fondo.setAttribute('width', anchoAprox);
    fondo.setAttribute('height', 18);
  }

  captura.addEventListener('mousemove', (evento) => {
    const rect = svg.getBoundingClientRect();
    const escala = svg.viewBox.baseVal.width / rect.width;
    const xSvg = (evento.clientX - rect.left) * escala;
    const fraccion = (xSvg - margenIzq) / anchoUtil;
    const idx = Math.max(0, Math.min(puntos.length - 1, Math.round(fraccion * (puntos.length - 1))));
    mostrarEnIndice(idx);
  });
  captura.addEventListener('mouseleave', () => {
    grupo.classList.add('oculto');
  });
  // Punto de partida: el último dato (igual que el resumen de "Actual").
  mostrarEnIndice(puntos.length - 1);
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
  const serie = drillRangoPersonalizado
    ? filtrarPorRango(serieCompleta, drillRangoPersonalizado.desde, drillRangoPersonalizado.hasta)
    : filtrarPorPeriodo(serieCompleta, drillPeriodoMeses);

  document.querySelectorAll('.drill-periodo-btn').forEach((btn) => {
    btn.classList.toggle('activo', !drillRangoPersonalizado && Number(btn.dataset.meses || 0) === drillPeriodoMeses);
  });
  document.querySelectorAll('.drill-modo-btn').forEach((btn) => {
    btn.classList.toggle('activo', btn.dataset.modo === drillModoValor);
  });
  el('drillRangoLimpiar').classList.toggle('oculto', !drillRangoPersonalizado);

  if (!serie.length) {
    el('drillGrafico').innerHTML = '<div class="chart-vacio">No hay datos para este período.</div>';
    el('drillResumen').textContent = '';
    return;
  }

  el('drillGrafico').innerHTML = svgLineChart(serie, 600, 220);
  wireHoverChart();

  const actual = serie[serie.length - 1].valor;
  const valores = serie.map((p) => p.valor);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  el('drillResumen').innerHTML = `
    Actual (${formatearFecha(serie[serie.length - 1].fecha)}): <strong>${formatearRatio(actual)}</strong>
    &nbsp;·&nbsp; Mínimo del período: ${formatearRatio(min)}
    &nbsp;·&nbsp; Máximo del período: ${formatearRatio(max)}
  `;

  const interanual = calcularVariacionPct(actual, valorHaceMeses(serieCompleta, 12));
  const intermensual = calcularVariacionPct(actual, valorHaceMeses(serieCompleta, 1));
  el('drillVariaciones').innerHTML = `
    <span>Variación interanual: ${formatearVariacionPct(interanual)}</span>
    <span>Variación intermensual: ${formatearVariacionPct(intermensual)}</span>
  `;
  renderSpotVsPromedio(serieCompleta, actual);
}

function formatearVariacionPct(pct) {
  if (pct == null) return 'sin datos suficientes';
  const signo = pct > 0 ? '+' : '';
  const clase = pct > 0 ? 'positiva' : pct < 0 ? 'negativa' : '';
  return `<span class="${clase}">${signo}${pct.toFixed(1)}%</span>`;
}

// Compara el valor spot (más reciente) contra el promedio del período
// elegido en #drillSpotPeriodo (o el máximo histórico) — usa la serie
// completa sin filtrar por período de visualización, para que "máximo
// histórico" sea realmente histórico y no dependa del rango del gráfico.
function renderSpotVsPromedio(serieCompleta, actual) {
  const periodo = el('drillSpotPeriodo').value;
  let referencia;
  let etiqueta;
  let ventana;
  if (periodo === 'max') {
    referencia = maximoHistorico(serieCompleta);
    etiqueta = 'el máximo histórico';
    ventana = serieCompleta;
  } else {
    const meses = Number(periodo);
    ventana = puntosUltimosMeses(serieCompleta, meses);
    referencia = promedioUltimosMeses(serieCompleta, meses);
    etiqueta = meses === 1 ? 'el promedio del último mes' : meses === 6 ? 'el promedio semestral' : 'el promedio anual';
  }
  if (referencia == null) {
    el('drillSpotResultado').textContent = 'Sin datos suficientes para ese período.';
    return;
  }
  const variacion = calcularVariacionPct(actual, referencia);
  el('drillSpotResultado').innerHTML = `
    Spot actual (${formatearRatio(actual)}) vs. ${etiqueta} (${formatearRatio(referencia)}): ${formatearVariacionPct(variacion)}
    ${interpretarSpotVsPromedio(percentilActual(ventana))}
  `;
}

// La recomendación de compra/venta se basa en el PERCENTIL de hoy dentro de
// esa misma ventana, no en el % crudo de distancia al promedio/máximo — el
// percentil es la única medida simétrica al invertir la relación
// (percentil(A÷B) es siempre 100-percentil(B÷A) en la misma ventana). Con
// el % crudo, A÷B y B÷A comparan cada una contra SU PROPIO máximo/promedio
// (que ocurre en fechas distintas), y podían dar lecturas contradictorias
// —las dos direcciones "convenía comprar"— que es lo que se reportó.
function interpretarSpotVsPromedio(percentil) {
  if (percentil == null) return '';
  const nombreA = porId(drillActualA).nombre;
  const nombreB = porId(drillActualB).nombre;
  if (percentil >= 45 && percentil <= 55) {
    return `<div class="drill-spot-interpretacion">En línea con ese período — sin ventaja clara entre ${nombreA} y ${nombreB}.</div>`;
  }
  if (percentil > 55) {
    return `<div class="drill-spot-interpretacion">${nombreA} está relativamente caro frente a ${nombreB} en ese período (percentil ${percentil.toFixed(0)}): convendría vender ${nombreA} y comprar ${nombreB}.</div>`;
  }
  return `<div class="drill-spot-interpretacion">${nombreA} está relativamente barato frente a ${nombreB} en ese período (percentil ${percentil.toFixed(0)}): convendría comprar ${nombreA} y vender ${nombreB}.</div>`;
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
  if (excluido) {
    el('alertaExplicacionBtn').classList.add('oculto');
    el('alertaExplicacionPanel').classList.add('oculto');
    return;
  }

  const [idCanonA, idCanonB] = [drillActualA, drillActualB].sort();
  const config = configDePar(idCanonA, idCanonB); // nunca null acá (ya se filtró $ Pesos arriba)

  const notaPersonalizada = config.personalizada === false
    ? ' (valores por defecto — todavía no la personalizaste)'
    : '';
  el('alertaDireccionNota').textContent = `Esta alerta se configura para: ${porId(idCanonA).nombre} ÷ ${porId(idCanonB).nombre}.${notaPersonalizada}`;
  el('alertaFavorito').checked = !!config.favorito;
  el('alertaActiva').checked = !!config.alerta_activa;
  el('alertaMetodo').value = config.metodo;
  el('alertaVentana').value = String(config.ventana_meses);
  el('alertaUmbralDesvio').value = config.umbral_desvio_pct;
  el('alertaUmbralPercentilBajo').value = config.umbral_percentil_bajo;
  el('alertaUmbralPercentilAlto').value = config.umbral_percentil_alto;
  const esReal = config.base === 'real_ars' || config.base === 'real_usd';
  el('alertaBase').value = esReal ? 'real' : 'nominal';

  el('alertaBaseWrap').classList.toggle('oculto', !tipoIndiceAplicable(idCanonA, idCanonB));
  el('alertaOpciones').classList.toggle('oculto', !el('alertaActiva').checked);
  el('alertaMensaje').textContent = '';

  const alerta = estadoAlertaParaPar(drillActualA, drillActualB);
  const estadoEl = el('alertaEstadoActual');
  if (!config.alerta_activa) {
    estadoEl.innerHTML = '';
    estadoEl.className = 'alerta-estado-actual';
  } else if (!alerta) {
    estadoEl.textContent = `Todavía no hay suficientes datos en los últimos ${config.ventana_meses} meses para evaluar esta alerta.`;
    estadoEl.className = 'alerta-estado-actual';
  } else {
    const nombreA = porId(drillActualA).nombre;
    const nombreB = porId(drillActualB).nombre;
    const encabezado = alerta.estado === 'caro'
      ? `🔴 Caro: ${nombreA} está caro respecto a ${nombreB} frente a los últimos ${alerta.ventanaMeses} meses.`
      : alerta.estado === 'barato'
      ? `🟢 Barato: ${nombreA} está barato respecto a ${nombreB} frente a los últimos ${alerta.ventanaMeses} meses.`
      : `⚪ En rango normal frente a los últimos ${alerta.ventanaMeses} meses, sin alerta.`;
    const porQue = alerta.motivo ? `<div class="alerta-estado-motivo">Por qué: ${alerta.motivo}.</div>` : '';
    const detalleCompleto = alerta.detalles.length
      ? `<div class="alerta-estado-detalle">${alerta.detalles.join(' · ')}</div>`
      : '';
    estadoEl.innerHTML = `<div>${encabezado}</div>${porQue}${detalleCompleto}`;
    estadoEl.className = `alerta-estado-actual ${alerta.estado}`;
  }

  renderExplicacionAlerta(config.alerta_activa ? alerta : null, config, drillActualA, drillActualB);
}

// Explicación genérica de cómo se calculan percentil y desvío, más el
// detalle puntual de este ratio — para el botón "¿Cómo se calcula esto?".
// Colapsado por defecto (se re-arma el contenido en cada render, pero el
// estado abierto/cerrado del botón lo maneja initMatriz()).
function renderExplicacionAlerta(alerta, config, idA, idB) {
  const boton = el('alertaExplicacionBtn');
  const panel = el('alertaExplicacionPanel');
  if (!alerta) {
    boton.classList.add('oculto');
    panel.classList.add('oculto');
    panel.innerHTML = '';
    return;
  }
  boton.classList.remove('oculto');

  const nombreA = porId(idA).nombre;
  const nombreB = porId(idB).nombre;
  const detalleActual = alerta.detalles.length
    ? `<p><strong>${nombreA} ÷ ${nombreB}, ahora mismo (últimos ${config.ventana_meses} meses):</strong></p><ul>${alerta.detalles.map((d) => `<li>${d}</li>`).join('')}</ul>`
    : '';

  panel.innerHTML = `
    <p><strong>Percentil histórico:</strong> ubica el valor de HOY entre todos los valores de la ventana elegida. Percentil 100 = el valor más alto de todo ese período; percentil 0 = el más bajo. Con el umbral por defecto, percentil ≥90 dispara "caro" (casi nunca estuvo tan alto) y percentil ≤10 dispara "barato" (casi nunca estuvo tan bajo).</p>
    <p><strong>Desvío % del promedio:</strong> cuánto se aleja el valor de HOY del promedio de esa misma ventana, en porcentaje. +20% significa 20% por encima del promedio histórico; -20%, 20% por debajo. Con el umbral por defecto, ±15% o más dispara la alerta.</p>
    ${detalleActual}
  `;
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

// Muestra la misma relación al revés (ej. Novillo÷Trigo -> Trigo÷Novillo)
// sin cerrar el modal — conserva el período/rango/modo elegidos.
function invertirDrillDown() {
  [drillActualA, drillActualB] = [drillActualB, drillActualA];
  renderDrillDown();
  renderAlertaPanel();
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
      drillRangoPersonalizado = null; // un preset de período reemplaza el rango custom
      renderDrillDown();
    });
  });
  document.querySelectorAll('.drill-modo-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      drillModoValor = btn.dataset.modo;
      renderDrillDown();
    });
  });
  el('drillRangoAplicar').addEventListener('click', () => {
    const desde = el('drillRangoDesde').value;
    const hasta = el('drillRangoHasta').value;
    if (!desde && !hasta) return;
    drillRangoPersonalizado = { desde: desde || null, hasta: hasta || null };
    renderDrillDown();
  });
  el('drillRangoLimpiar').addEventListener('click', () => {
    drillRangoPersonalizado = null;
    el('drillRangoDesde').value = '';
    el('drillRangoHasta').value = '';
    renderDrillDown();
  });
  el('drillCerrar').addEventListener('click', cerrarDrillDown);
  el('modalDrillDownFondo').addEventListener('click', cerrarDrillDown);
  el('drillSpotPeriodo').addEventListener('change', renderDrillDown);
  el('drillInvertir').addEventListener('click', invertirDrillDown);

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
  el('alertaExplicacionBtn').addEventListener('click', () => {
    el('alertaExplicacionPanel').classList.toggle('oculto');
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
