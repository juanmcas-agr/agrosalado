// Reportes: pestaña con 4 sub-secciones (Trabajo de Manga / Feed Lot /
// Historia de Rodeo / Índices). M4 armó el esqueleto; M5 completa
// Trabajo de Manga: listado filtrable con el detalle de qué se hizo
// (Sanidad/Reproducción/Manejo), exportable a PDF vía impresión del
// navegador (contenedor .imprimible, ver estilo.css) — sin librería
// nueva, mismo criterio minimalista que el resto de la app.
import { supabase } from './supabaseClient.js';
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

function imprimirReporte() {
  window.print();
}

export async function initReportes() {
  document.querySelectorAll('.reportes-tab').forEach((boton) => {
    boton.addEventListener('click', () => mostrarSubseccion(boton.dataset.subseccion));
  });
  el('rep-manga-filtrar').addEventListener('click', cargarTrabajosManga);
  el('rep-manga-imprimir').addEventListener('click', imprimirReporte);
  el('rep-feedlot-actualizar').addEventListener('click', cargarFeedLot);
  el('rep-feedlot-imprimir').addEventListener('click', imprimirReporte);

  // Los caches (rodeos/titulares/catálogos) tienen que estar cargados
  // ANTES de mostrar la primera sub-sección — si no, la primera carga de
  // datos corre con nombres sin resolver.
  await Promise.all([cargarRodeos(), cargarTitulares(), cargarCatalogosSanidad()]);
  poblarSelectRodeoReportes();
  mostrarSubseccion('manga');
}

// Llamado por router.js al navegar a #reportes — recarga la sub-sección
// que esté activa en ese momento (no siempre "manga": el usuario puede
// haber quedado en otra al salir de la pestaña).
export async function refrescarReportes() {
  const activa = document.querySelector('.reportes-tab.activo')?.dataset.subseccion || 'manga';
  if (activa === 'manga') await cargarTrabajosManga();
  if (activa === 'feedlot') await cargarFeedLot();
}
