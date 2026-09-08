// Lógica compartida para mostrar Trabajo de Manga "con detalle" (qué se
// hizo realmente — Sanidad/Reproducción/Manejo — no solo cantidad
// trabajada) — la usan tanto Historial (pantalla-historial, vista rápida
// del día a día) como Reportes > Trabajo de Manga (vista más completa,
// imprimible). Se armó acá para no duplicar el join client-side contra
// las tablas hijas ni la descripción de cada sección en dos archivos.
import { supabase } from './supabaseClient.js';
import { CATEGORIAS } from './config.js';
import { obtenerTitularesCache } from './titulares.js';

let catalogos = { drogas: {}, vacunas: {}, otras: {}, toros: {} };

export async function cargarCatalogosSanidad() {
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

export function nombreCategoriaManga(categoriaId) {
  return CATEGORIAS.find((c) => c.id === categoriaId)?.nombre || categoriaId;
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

// Trae trabajos_manga (vía historial_trabajos_manga, ya con nombres
// resueltos) filtrados por código, o por fecha/rodeo si no hay código —
// y arma para cada uno el texto de propietarios y el detalle completo
// (Sanidad/Reproducción/Manejo), listo para pintar en una tabla.
export async function obtenerTrabajosConDetalle({ desde, hasta, rodeoId, codigo, limite = 200 } = {}) {
  let query = supabase.from('historial_trabajos_manga').select('*').order('fecha', { ascending: false }).limit(limite);
  if (codigo) {
    query = query.ilike('codigo', `%${codigo}%`);
  } else {
    if (desde) query = query.gte('fecha', desde);
    if (hasta) query = query.lte('fecha', hasta);
    if (rodeoId) query = query.eq('rodeo_id', rodeoId);
  }

  const { data, error } = await query;
  if (error) throw error;
  if (!data.length) return [];

  const ids = data.map((t) => t.id);
  const [propietarios, sanidad, vacunas, otras, reproduccion, toros, manejo] = await Promise.all([
    supabase.from('trabajo_manga_propietarios').select('trabajo_manga_id, titular_id').in('trabajo_manga_id', ids),
    supabase.from('trabajo_manga_sanidad').select('*').in('trabajo_manga_id', ids),
    supabase.from('trabajo_manga_vacunas').select('trabajo_manga_id, vacuna_id').in('trabajo_manga_id', ids),
    supabase.from('trabajo_manga_otras_sanidades').select('trabajo_manga_id, sanidad_id').in('trabajo_manga_id', ids),
    supabase.from('trabajo_manga_reproduccion').select('*').in('trabajo_manga_id', ids),
    supabase.from('trabajo_manga_inseminacion_toros').select('trabajo_manga_id, toro_id').in('trabajo_manga_id', ids),
    supabase.from('trabajo_manga_manejo').select('*').in('trabajo_manga_id', ids),
  ]);

  const porPropietario = agruparPor('trabajo_manga_id', propietarios.data);
  const porSanidad = agruparPor('trabajo_manga_id', sanidad.data);
  const porVacunas = agruparPor('trabajo_manga_id', vacunas.data);
  const porOtras = agruparPor('trabajo_manga_id', otras.data);
  const porReproduccion = agruparPor('trabajo_manga_id', reproduccion.data);
  const porToros = agruparPor('trabajo_manga_id', toros.data);
  const porManejo = agruparPor('trabajo_manga_id', manejo.data);

  return data.map((t) => ({
    ...t,
    categoriaNombre: nombreCategoriaManga(t.categoria_id),
    propietariosTexto: (porPropietario[t.id] || [])
      .map((p) => obtenerTitularesCache().find((x) => x.id === p.titular_id)?.nombre || p.titular_id)
      .join(', '),
    detalleTexto: [
      describirSanidad(porSanidad[t.id]?.[0], porVacunas[t.id] || [], porOtras[t.id] || []),
      describirReproduccion(porReproduccion[t.id]?.[0], porToros[t.id] || []),
      describirManejo(porManejo[t.id]?.[0]),
    ].filter(Boolean).join(' | ') || '—',
  }));
}
