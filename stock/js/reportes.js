// Reportes: pestaña con 4 sub-secciones (Trabajo de Manga / Feed Lot /
// Historia de Rodeo / Índices). M4 armó el esqueleto; M5 completa
// Trabajo de Manga: listado filtrable con el detalle de qué se hizo
// (Sanidad/Reproducción/Manejo), exportable a PDF vía impresión del
// navegador (contenedor .imprimible, ver estilo.css) — sin librería
// nueva, mismo criterio minimalista que el resto de la app.
import { supabase } from './supabaseClient.js';
import { CATEGORIAS } from './config.js';
import { cargarRodeos, obtenerRodeosCache } from './rodeos.js';
import { cargarTitulares, obtenerTitularesCache } from './titulares.js';

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
}

function nombreCategoriaManga(categoriaId) {
  return CATEGORIAS.find((c) => c.id === categoriaId)?.nombre || categoriaId;
}

// ─── Trabajo de Manga ───────────────────────────────────────────────────

let catalogos = { drogas: {}, vacunas: {}, otras: {}, toros: {} };

async function cargarCatalogosSanidad() {
  const mapa = (filas) => Object.fromEntries((filas || []).map((f) => [f.id, f.nombre]));
  const [drogas, vacunas, otras, toros] = await Promise.all([
    supabase.from('catalogo_drogas').select('id, nombre'),
    supabase.from('catalogo_vacunas_reproductivas').select('id, nombre'),
    supabase.from('catalogo_otras_sanidades').select('id, nombre'),
    supabase.from('catalogo_toros').select('id, nombre'),
  ]);
  catalogos = {
    drogas: mapa(drogas.data),
    vacunas: mapa(vacunas.data),
    otras: mapa(otras.data),
    toros: mapa(toros.data),
  };
}

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

function agruparPor(campo, filas) {
  const mapa = {};
  for (const f of filas || []) {
    (mapa[f[campo]] = mapa[f[campo]] || []).push(f);
  }
  return mapa;
}

function describirSanidad(s, vacunasDeEste, otrasDeEste) {
  if (!s) return null;
  const partes = [];
  if (s.desparasitada) partes.push('Desparasitada' + (s.droga_id && catalogos.drogas[s.droga_id] ? ` (${catalogos.drogas[s.droga_id]})` : ''));
  if (s.cobre) partes.push('Cobre');
  if (s.aftosa) partes.push('Aftosa');
  if (s.brucelosis) partes.push('Brucelosis');
  if (s.carbunclo) partes.push('Carbunclo');
  if (vacunasDeEste.length) partes.push('Vacunas: ' + vacunasDeEste.map((v) => catalogos.vacunas[v.vacuna_id] || v.vacuna_id).join(', '));
  if (otrasDeEste.length) partes.push('Otras: ' + otrasDeEste.map((o) => catalogos.otras[o.sanidad_id] || o.sanidad_id).join(', '));
  return partes.length ? 'Sanidad: ' + partes.join(', ') : null;
}

function describirReproduccion(r, torosDeEste) {
  if (!r) return null;
  const partes = [];
  if (r.estado_corporal != null) partes.push(`Estado corporal ${r.estado_corporal}`);
  if (r.inseminacion) partes.push('Inseminación' + (torosDeEste.length ? ` (${torosDeEste.map((t) => catalogos.toros[t.toro_id] || t.toro_id).join(', ')})` : ''));
  if (r.tacto) partes.push('Tacto');
  if (r.raspaje) partes.push('Raspaje');
  if (r.ecografia) partes.push('Ecografía');
  if (r.resincronizacion) partes.push('Resincronización');
  return partes.length ? 'Reproducción: ' + partes.join(', ') : null;
}

function describirManejo(m) {
  if (!m) return null;
  const partes = [];
  if (m.aparte) partes.push('Aparte');
  if (m.capada) partes.push('Capada');
  if (m.pesada_control_kilos != null) partes.push(`Pesada de control: ${m.pesada_control_kilos} kg`);
  if (m.destete) {
    const detalle = [];
    if (m.destete_machos_cantidad) detalle.push(`${m.destete_machos_cantidad} machos${m.destete_kilos_ternero ? ` (${m.destete_kilos_ternero} kg)` : ''}`);
    if (m.destete_hembras_cantidad) detalle.push(`${m.destete_hembras_cantidad} hembras${m.destete_kilos_ternera ? ` (${m.destete_kilos_ternera} kg)` : ''}`);
    partes.push('Destete: ' + detalle.join(', '));
  }
  return partes.length ? 'Manejo de rodeo: ' + partes.join(', ') : null;
}

function renderTrabajosManga(trabajos, detalles) {
  const tbody = el('rep-manga-tabla').querySelector('tbody');
  tbody.innerHTML = '';
  if (!trabajos.length) {
    tbody.innerHTML = '<tr><td colspan="8">Sin trabajos de manga en el rango elegido.</td></tr>';
    return;
  }
  for (const t of trabajos) {
    const propietarios = (detalles.porPropietario[t.id] || [])
      .map((p) => obtenerTitularesCache().find((x) => x.id === p.titular_id)?.nombre || p.titular_id)
      .join(', ');
    const detalle = [
      describirSanidad(detalles.porSanidad[t.id]?.[0], detalles.porVacunas[t.id] || [], detalles.porOtras[t.id] || []),
      describirReproduccion(detalles.porReproduccion[t.id]?.[0], detalles.porToros[t.id] || []),
      describirManejo(detalles.porManejo[t.id]?.[0]),
    ].filter(Boolean).join(' | ') || '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t.codigo}</td>
      <td>${t.fecha}</td>
      <td>${t.rodeo || ''}</td>
      <td>${nombreCategoriaManga(t.categoria_id)}</td>
      <td>${t.cantidad_trabajada}${t.diferencia_pendiente ? ' ⚠️' : ''}</td>
      <td>${propietarios}</td>
      <td>${detalle}</td>
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

  let query = supabase.from('historial_trabajos_manga').select('*').order('fecha', { ascending: false }).limit(200);
  if (desde) query = query.gte('fecha', desde);
  if (hasta) query = query.lte('fecha', hasta);
  if (rodeoId) query = query.eq('rodeo_id', rodeoId);

  const { data, error } = await query;
  if (error) {
    mensaje.textContent = `No se pudo cargar (¿sin conexión?): ${error.message}`;
    mensaje.className = 'error';
    return;
  }

  const ids = data.map((t) => t.id);
  if (!ids.length) {
    renderTrabajosManga([], { porPropietario: {}, porSanidad: {}, porVacunas: {}, porOtras: {}, porReproduccion: {}, porToros: {}, porManejo: {} });
    return;
  }

  const [propietarios, sanidad, vacunas, otras, reproduccion, toros, manejo] = await Promise.all([
    supabase.from('trabajo_manga_propietarios').select('trabajo_manga_id, titular_id').in('trabajo_manga_id', ids),
    supabase.from('trabajo_manga_sanidad').select('*').in('trabajo_manga_id', ids),
    supabase.from('trabajo_manga_vacunas').select('trabajo_manga_id, vacuna_id').in('trabajo_manga_id', ids),
    supabase.from('trabajo_manga_otras_sanidades').select('trabajo_manga_id, sanidad_id').in('trabajo_manga_id', ids),
    supabase.from('trabajo_manga_reproduccion').select('*').in('trabajo_manga_id', ids),
    supabase.from('trabajo_manga_inseminacion_toros').select('trabajo_manga_id, toro_id').in('trabajo_manga_id', ids),
    supabase.from('trabajo_manga_manejo').select('*').in('trabajo_manga_id', ids),
  ]);

  renderTrabajosManga(data, {
    porPropietario: agruparPor('trabajo_manga_id', propietarios.data),
    porSanidad: agruparPor('trabajo_manga_id', sanidad.data),
    porVacunas: agruparPor('trabajo_manga_id', vacunas.data),
    porOtras: agruparPor('trabajo_manga_id', otras.data),
    porReproduccion: agruparPor('trabajo_manga_id', reproduccion.data),
    porToros: agruparPor('trabajo_manga_id', toros.data),
    porManejo: agruparPor('trabajo_manga_id', manejo.data),
  });
}

function imprimirReporte() {
  window.print();
}

export async function initReportes() {
  document.querySelectorAll('.reportes-tab').forEach((boton) => {
    boton.addEventListener('click', () => mostrarSubseccion(boton.dataset.subseccion));
  });
  mostrarSubseccion('manga');

  await Promise.all([cargarRodeos(), cargarTitulares(), cargarCatalogosSanidad()]);
  poblarSelectRodeoReportes();
  el('rep-manga-filtrar').addEventListener('click', cargarTrabajosManga);
  el('rep-manga-imprimir').addEventListener('click', imprimirReporte);
}

// Llamado por router.js al navegar a #reportes.
export async function refrescarReportes() {
  await cargarTrabajosManga();
}
