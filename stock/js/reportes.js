// Reportes: pestaña con 4 sub-secciones (Trabajo de Manga / Feed Lot /
// Historia de Rodeo / Índices). M4 armó el esqueleto; M5 completa
// Trabajo de Manga: listado filtrable con el detalle de qué se hizo
// (Sanidad/Reproducción/Manejo), exportable a PDF vía impresión del
// navegador (contenedor .imprimible, ver estilo.css) — sin librería
// nueva, mismo criterio minimalista que el resto de la app.
import { supabase } from './supabaseClient.js';
import { ESTABLECIMIENTOS, CATEGORIAS } from './config.js';
import { cargarRodeos, obtenerRodeosCache } from './rodeos.js';
import { cargarTitulares } from './titulares.js';
import { cargarCatalogosSanidad, obtenerTrabajosConDetalle, esRectificado } from './trabajoMangaDetalle.js';

function el(id) {
  return document.getElementById(id);
}

const SUBSECCIONES = ['manga', 'feedlot', 'rodeo', 'indices'];

function mostrarSubseccion(nombre) {
  for (const s of SUBSECCIONES) {
    el(`reportes-${s}`).classList.toggle('oculto', s !== nombre);
  }
  document.querySelectorAll('.reportes-tab').forEach((boton) => {
    boton.classList.toggle('activo', boton.dataset.subseccion === nombre);
  });
  if (nombre === 'manga') cargarTrabajosManga();
  if (nombre === 'feedlot') cargarFeedLot();
  if (nombre === 'rodeo') cargarHistoriaRodeo();
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

// Diferencia en días entre dos fechas ISO (hasta - desde); positivo si
// "hasta" es posterior.
function diasEntre(desdeIso, hastaIso) {
  const desde = new Date(desdeIso + 'T00:00:00');
  const hasta = new Date(hastaIso + 'T00:00:00');
  return Math.round((hasta - desde) / 86400000);
}

// ─── Trabajo de Manga ───────────────────────────────────────────────────

function poblarSelectRodeoReportes() {
  const select = el('rep-manga-rodeo');
  const valorPrevio = select.value;
  select.innerHTML = '<option value="">Todos los rodeos</option>';
  for (const r of obtenerRodeosCache()) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.codigo;
    select.appendChild(opt);
  }
  if (valorPrevio && [...select.options].some((o) => o.value === valorPrevio)) select.value = valorPrevio;
}

function renderTrabajosManga(trabajos) {
  const tbody = el('rep-manga-tabla').querySelector('tbody');
  tbody.innerHTML = '';
  if (!trabajos.length) {
    tbody.innerHTML = '<tr><td colspan="8">Sin trabajos de manga en el rango elegido.</td></tr>';
    return;
  }
  for (const t of trabajos) {
    const tr = document.createElement('tr');
    if (esRectificado(t)) tr.classList.add('rectificado');
    tr.innerHTML = `
      <td>${t.codigo}</td>
      <td>${t.fecha}</td>
      <td>${t.rodeo || ''}</td>
      <td>${t.categoriaNombre}</td>
      <td>${t.cantidad_trabajada}${t.diferencia_pendiente ? ' ⚠️' : ''}${esRectificado(t) ? ' ✏️' : ''}</td>
      <td>${t.propietariosTexto}</td>
      <td>${t.detalleTexto}</td>
      <td>${t.usuario_nombre || ''}</td>
    `;
    tbody.appendChild(tr);
  }
}

export async function cargarTrabajosManga() {
  const mensaje = el('rep-manga-mensaje');
  mensaje.textContent = '';

  const desde = el('rep-manga-desde').value;
  const hasta = el('rep-manga-hasta').value;
  const rodeoId = el('rep-manga-rodeo').value;

  try {
    const trabajos = await obtenerTrabajosConDetalle({ desde, hasta, rodeoId });
    renderTrabajosManga(trabajos);
  } catch (error) {
    mensaje.textContent = `No se pudo cargar (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
  }
}

// ─── Feed Lot ───────────────────────────────────────────────────────────
// "Kilos ganados" mientras el ciclo sigue abierto solo se puede estimar
// si hubo una Pesada de control (Trabajo de Manga > Manejo de rodeo)
// después del ingreso — el ingreso a feed lot no actualiza el peso del
// rodeo por sí solo. Sin esa pesada, se muestra el objetivo pero no un
// "ganado hasta ahora" (no hay con qué calcularlo). Una vez cerrado el
// ciclo (kilos_salida_real cargado), el ganado ya es un dato exacto.

function renderCorralVacio(corral) {
  return `<div class="corral-card vacio"><h4>Corral ${corral}</h4><div>Vacío</div></div>`;
}

function renderCorralOcupado(corral, rodeo, ciclo, cabezas, pesada) {
  const hoy = hoyISO();
  const partes = [`<h4>Corral ${corral}</h4>`, `<div class="corral-linea"><strong>${rodeo.codigo}</strong></div>`];
  if (cabezas != null) partes.push(`<div class="corral-linea">${cabezas} cabezas</div>`);

  if (ciclo?.fecha_estimada_salida) {
    const dias = diasEntre(hoy, ciclo.fecha_estimada_salida);
    const claseDias = dias < 0 ? 'vencido' : 'ok';
    const textoDias = dias < 0 ? `vencido hace ${Math.abs(dias)} día(s)` : dias === 0 ? 'hoy' : `en ${dias} día(s)`;
    partes.push(`<div class="corral-linea corral-dias ${claseDias}">Salida estimada: ${ciclo.fecha_estimada_salida} (${textoDias})</div>`);
  } else {
    partes.push('<div class="corral-linea">Sin fecha estimada de salida cargada.</div>');
  }

  if (ciclo?.kilos_ingreso != null) partes.push(`<div class="corral-linea">Kilos de ingreso: ${ciclo.kilos_ingreso} kg</div>`);
  if (ciclo?.kilos_salida_objetivo != null) partes.push(`<div class="corral-linea">Kilos objetivo: ${ciclo.kilos_salida_objetivo} kg</div>`);

  if (pesada && ciclo?.kilos_ingreso != null) {
    const ganado = +(pesada.kilos_promedio - ciclo.kilos_ingreso).toFixed(1);
    partes.push(`<div class="corral-linea">Última pesada: ${pesada.kilos_promedio} kg (${pesada.fecha}) — <strong>${ganado >= 0 ? '+' : ''}${ganado} kg</strong> desde el ingreso</div>`);
  } else {
    partes.push('<div class="corral-linea ayuda">Sin pesada de control registrada todavía.</div>');
  }

  return `<div class="corral-card">${partes.join('')}</div>`;
}

function renderCorrales(corrales) {
  const cont = el('rep-feedlot-corrales');
  cont.innerHTML = ['1', '2', '3', '4'].map((corral) => {
    const ocupante = corrales[corral];
    return ocupante ? renderCorralOcupado(corral, ocupante.rodeo, ocupante.ciclo, ocupante.cabezas, ocupante.pesada) : renderCorralVacio(corral);
  }).join('');
}

function renderHistorialFeedLot(ciclosCerrados) {
  const tbody = el('rep-feedlot-historial-tabla').querySelector('tbody');
  if (!ciclosCerrados.length) {
    tbody.innerHTML = '<tr><td colspan="7">Sin ciclos cerrados todavía.</td></tr>';
    return;
  }
  tbody.innerHTML = ciclosCerrados.map((c) => {
    const rodeo = obtenerRodeosCache().find((r) => r.id === c.rodeo_id);
    const dias = c.fecha_salida_real ? diasEntre(c.fecha_ingreso, c.fecha_salida_real) : '';
    const ganado = c.kilos_salida_real != null && c.kilos_ingreso != null ? +(c.kilos_salida_real - c.kilos_ingreso).toFixed(1) : null;
    return `<tr>
      <td>${rodeo?.codigo || c.rodeo_id}</td>
      <td>${c.fecha_ingreso}</td>
      <td>${c.fecha_salida_real || ''}</td>
      <td>${dias}</td>
      <td>${c.kilos_ingreso ?? ''}</td>
      <td>${c.kilos_salida_real ?? ''}</td>
      <td>${ganado != null ? (ganado >= 0 ? '+' : '') + ganado + ' kg' : ''}</td>
    </tr>`;
  }).join('');
}

export async function cargarFeedLot() {
  const mensaje = el('rep-feedlot-mensaje');
  mensaje.textContent = '';

  const [rodeosFeedLot, ciclosAbiertos, ciclosCerrados, stockActual] = await Promise.all([
    supabase.from('rodeos').select('id, codigo, corral').eq('establecimiento_id', 'feed_lot').eq('activo', true),
    supabase.from('feed_lot_ciclos').select('*').eq('activo', true),
    supabase.from('feed_lot_ciclos').select('*').eq('activo', false).order('fecha_salida_real', { ascending: false }).limit(10),
    supabase.from('stock_actual').select('rodeo_id, cabezas').eq('establecimiento', 'feed_lot'),
  ]);
  if (rodeosFeedLot.error || ciclosAbiertos.error || ciclosCerrados.error || stockActual.error) {
    const error = rodeosFeedLot.error || ciclosAbiertos.error || ciclosCerrados.error || stockActual.error;
    mensaje.textContent = `No se pudo cargar (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
    return;
  }

  const rodeoIds = rodeosFeedLot.data.map((r) => r.id);
  let pesadas = [];
  if (rodeoIds.length) {
    const { data } = await supabase.from('rodeo_pesadas_historial').select('rodeo_id, fecha, kilos_promedio').in('rodeo_id', rodeoIds).order('fecha', { ascending: false });
    pesadas = data || [];
  }
  const pesadaMasRecientePorRodeo = {};
  for (const p of pesadas) {
    if (!pesadaMasRecientePorRodeo[p.rodeo_id]) pesadaMasRecientePorRodeo[p.rodeo_id] = p;
  }

  const cabezasPorRodeo = {};
  for (const r of stockActual.data) {
    cabezasPorRodeo[r.rodeo_id] = (cabezasPorRodeo[r.rodeo_id] || 0) + Number(r.cabezas);
  }

  const corrales = {};
  for (const rodeo of rodeosFeedLot.data) {
    if (!rodeo.corral) continue;
    corrales[rodeo.corral] = {
      rodeo,
      ciclo: ciclosAbiertos.data.find((c) => c.rodeo_id === rodeo.id) || null,
      cabezas: cabezasPorRodeo[rodeo.id] ?? 0,
      pesada: pesadaMasRecientePorRodeo[rodeo.id] || null,
    };
  }

  renderCorrales(corrales);
  renderHistorialFeedLot(ciclosCerrados.data);
}

// ─── Historia de Rodeo ──────────────────────────────────────────────────
// Una sola línea de tiempo con dos fuentes intercaladas cronológicamente:
// movimientos donde el rodeo es origen o destino (historial_movimientos)
// y pesadas de control (rodeo_pesadas_historial) — así se ve la
// evolución completa de un rodeo en un solo lugar, no dos tablas
// separadas que hay que cruzar a mano.

function poblarSelectRodeoHistoria() {
  const select = el('rep-rodeo-select');
  const valorPrevio = select.value;
  select.innerHTML = '<option value="">Elegir rodeo...</option>';
  for (const r of obtenerRodeosCache()) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.codigo;
    select.appendChild(opt);
  }
  if (valorPrevio && [...select.options].some((o) => o.value === valorPrevio)) select.value = valorPrevio;
}

function describirMovimientoTimeline(m) {
  const origen = m.establecimiento_origen_nombre ? `${m.establecimiento_origen_nombre} (${m.categoria_origen_nombre})` : null;
  const destino = m.establecimiento_destino_nombre ? `${m.establecimiento_destino_nombre} (${m.categoria_destino_nombre})` : null;
  const recorrido = [origen, destino].filter(Boolean).join(' → ');
  const titular = m.titular_origen_nombre || m.titular_destino_nombre;
  return [
    recorrido,
    `${m.cantidad_cabezas} cab. (${m.kilos_promedio} kg prom.)`,
    titular ? `titular: ${titular}` : null,
    m.rodeo_destino ? `pasa al rodeo ${m.rodeo_destino}` : null,
  ].filter(Boolean).join(' — ');
}

// Arma la línea de tiempo ordenada: movimientos (fecha + created_at como
// desempate) y pesadas (fecha + creado_at) mezclados en un único array.
function construirLineaDeTiempo(movimientos, pesadas) {
  const eventos = [
    ...movimientos.map((m) => ({ fecha: m.fecha, orden: m.created_at, tipo: 'movimiento', datos: m })),
    ...pesadas.map((p) => ({ fecha: p.fecha, orden: p.creado_at, tipo: 'pesada', datos: p })),
  ];
  eventos.sort((a, b) => (a.fecha === b.fecha ? (a.orden || '').localeCompare(b.orden || '') : a.fecha.localeCompare(b.fecha)));
  return eventos;
}

function renderHistoriaRodeo(rodeo, eventos) {
  const info = el('rep-rodeo-info');
  if (!rodeo) {
    info.textContent = '';
    el('rep-rodeo-tabla').querySelector('tbody').innerHTML = '';
    return;
  }
  const categoriaNombre = CATEGORIAS.find((c) => c.id === rodeo.categoria_id)?.nombre || rodeo.categoria_id;
  const establecimientoNombre = ESTABLECIMIENTOS.find((e) => e.id === rodeo.establecimiento_id)?.nombre || rodeo.establecimiento_id;
  info.textContent = `${rodeo.codigo} — categoría actual: ${categoriaNombre} — establecimiento actual: ${establecimientoNombre}`;

  const tbody = el('rep-rodeo-tabla').querySelector('tbody');
  if (!eventos.length) {
    tbody.innerHTML = '<tr><td colspan="4">Sin movimientos ni pesadas registradas para este rodeo.</td></tr>';
    return;
  }
  tbody.innerHTML = eventos.map((e) => {
    if (e.tipo === 'pesada') {
      return `<tr><td>${e.fecha}</td><td>⚖️ Pesada de control</td><td>${e.datos.kilos_promedio} kg</td><td></td></tr>`;
    }
    return `<tr><td>${e.fecha}</td><td>${e.datos.tipo_movimiento_nombre}</td><td>${describirMovimientoTimeline(e.datos)}</td><td>${e.datos.codigo || ''}</td></tr>`;
  }).join('');
}

export async function cargarHistoriaRodeo() {
  const mensaje = el('rep-rodeo-mensaje');
  mensaje.textContent = '';
  const rodeoId = el('rep-rodeo-select').value;
  if (!rodeoId) {
    renderHistoriaRodeo(null, []);
    return;
  }

  const [movimientos, pesadas] = await Promise.all([
    supabase.from('historial_movimientos').select('*').or(`rodeo_id.eq.${rodeoId},rodeo_destino_id.eq.${rodeoId}`).order('fecha', { ascending: true }),
    supabase.from('rodeo_pesadas_historial').select('*').eq('rodeo_id', rodeoId).order('fecha', { ascending: true }),
  ]);
  if (movimientos.error || pesadas.error) {
    const error = movimientos.error || pesadas.error;
    mensaje.textContent = `No se pudo cargar (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
    return;
  }

  const rodeo = obtenerRodeosCache().find((r) => r.id === rodeoId);
  renderHistoriaRodeo(rodeo, construirLineaDeTiempo(movimientos.data, pesadas.data));
}

function imprimirReporte() {
  window.print();
}

// Acceso directo desde el clic en un rodeo dentro de "Por establecimiento"
// (Stock) — ver dashboard.js, que dispara este evento en vez de importar
// reportes.js directo (mismo criterio de siempre para no armar imports
// circulares entre pantallas).
function verHistoriaRodeo(rodeoId) {
  location.hash = 'reportes';
  el('rep-rodeo-select').value = rodeoId;
  mostrarSubseccion('rodeo');
}

export async function initReportes() {
  document.querySelectorAll('.reportes-tab').forEach((boton) => {
    boton.addEventListener('click', () => mostrarSubseccion(boton.dataset.subseccion));
  });
  el('rep-manga-filtrar').addEventListener('click', cargarTrabajosManga);
  el('rep-manga-imprimir').addEventListener('click', imprimirReporte);
  el('rep-feedlot-actualizar').addEventListener('click', cargarFeedLot);
  el('rep-feedlot-imprimir').addEventListener('click', imprimirReporte);
  el('rep-rodeo-ver').addEventListener('click', cargarHistoriaRodeo);
  el('rep-rodeo-imprimir').addEventListener('click', imprimirReporte);
  document.addEventListener('hacienda:ver-historia-rodeo', (evento) => verHistoriaRodeo(evento.detail.rodeoId));

  // Los caches (rodeos/titulares/catálogos) tienen que estar cargados
  // ANTES de mostrar la primera sub-sección — si no, la primera carga de
  // datos corre con nombres sin resolver.
  await Promise.all([cargarRodeos(), cargarTitulares(), cargarCatalogosSanidad()]);
  poblarSelectRodeoReportes();
  poblarSelectRodeoHistoria();
  mostrarSubseccion('manga');
}

// Llamado por router.js al navegar a #reportes — recarga la sub-sección
// que esté activa en ese momento (no siempre "manga": el usuario puede
// haber quedado en otra al salir de la pestaña).
export async function refrescarReportes() {
  const activa = document.querySelector('.reportes-tab.activo')?.dataset.subseccion || 'manga';
  if (activa === 'manga') await cargarTrabajosManga();
  if (activa === 'feedlot') await cargarFeedLot();
  if (activa === 'rodeo') await cargarHistoriaRodeo();
}
