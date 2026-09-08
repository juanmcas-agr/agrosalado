// Rodeos: grupos de animales que se trackean como unidad (nacen, engordan,
// se mueven de establecimiento, van a feed lot, se venden). Mismo patrón
// que titulares.js (cache local + alta on-the-fly desde el formulario).
import { supabase } from './supabaseClient.js';

let cache = [];

export async function cargarRodeos() {
  const { data, error } = await supabase.from('rodeos').select('*').eq('activo', true).order('codigo');
  if (!error) cache = data;
  return cache;
}

export function obtenerRodeosCache() {
  return cache;
}

export function rodeosDe(establecimientoId, categoriaId) {
  return cache.filter((r) => r.establecimiento_id === establecimientoId && r.categoria_id === categoriaId);
}

// Para Trabajo de Manga: no se elige establecimiento por separado (el
// rodeo ya sabe dónde está), así que alcanza con filtrar por categoría.
export function rodeosDeCategoria(categoriaId) {
  return cache.filter((r) => r.categoria_id === categoriaId);
}

// El código (ej. "Vaquillona San Miguel 202601") se arma acá, no en la
// base: año + secuencia salen de siguiente_secuencia_rodeo(), que es
// atómica (RPC con función security definer) para que dos altas
// simultáneas no puedan pisarse el mismo número.
export async function crearRodeo({ nombre, categoriaId, establecimientoId, fechaCreacion, usuarioId }) {
  const fecha = fechaCreacion || new Date().toISOString().slice(0, 10);
  const anio = Number(fecha.slice(0, 4));
  const { data: secuencia, error: errorSecuencia } = await supabase.rpc('siguiente_secuencia_rodeo', { p_anio: anio });
  if (errorSecuencia) throw errorSecuencia;
  const codigo = `${nombre} ${anio}${String(secuencia).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('rodeos')
    .insert({
      nombre,
      anio,
      secuencia,
      codigo,
      categoria_id: categoriaId,
      establecimiento_id: establecimientoId,
      fecha_creacion: fecha,
      creado_por: usuarioId,
    })
    .select()
    .single();
  if (error) throw error;
  cache = [...cache, data];
  return data;
}

// Renombrar un rodeo: el código se re-arma con el nombre nuevo pero el
// mismo año/secuencia (esos no cambian nunca, son la identidad real del
// rodeo — el nombre es solo la parte "humana" del código).
export async function renombrarRodeo(id, nuevoNombre) {
  const rodeo = cache.find((r) => r.id === id);
  if (!rodeo) throw new Error('Rodeo no encontrado — recargá la página e intentá de nuevo.');
  const nuevoCodigo = `${nuevoNombre} ${rodeo.anio}${String(rodeo.secuencia).padStart(2, '0')}`;
  const { data, error } = await supabase
    .from('rodeos')
    .update({ nombre: nuevoNombre, codigo: nuevoCodigo })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  cache = cache.map((r) => (r.id === id ? data : r));
  return data;
}

// Cabezas actuales de un rodeo (sumando todos los titulares) — se pide en
// vivo al validar un movimiento de salida/interna, no se cachea, para no
// dar luz verde con un stock desactualizado.
export async function stockDelRodeo(rodeoId) {
  const { data, error } = await supabase.from('stock_actual').select('cabezas').eq('rodeo_id', rodeoId);
  if (error) throw error;
  return data.reduce((acc, r) => acc + Number(r.cabezas), 0);
}

// Cabezas de una categoría puntual dentro de un rodeo (ej. cuántos
// "ternero" hay en el rodeo de la madre, para validar un Destete).
export async function stockDelRodeoPorCategoria(rodeoId, categoriaId) {
  const { data, error } = await supabase.from('stock_actual').select('cabezas').eq('rodeo_id', rodeoId).eq('categoria', categoriaId);
  if (error) throw error;
  return data.reduce((acc, r) => acc + Number(r.cabezas), 0);
}

// Titulares con cabezas reales en un rodeo (para no dejar elegir, al
// cargar un movimiento de salida/interna, una titularidad que ese rodeo
// ni siquiera tiene).
export async function titularesDelRodeo(rodeoId) {
  const { data, error } = await supabase.from('stock_actual').select('titular, cabezas').eq('rodeo_id', rodeoId);
  if (error) throw error;
  const conStock = new Set();
  for (const r of data) if (Number(r.cabezas) > 0) conStock.add(r.titular);
  return conStock;
}

// ─── Feed lot: corral + ciclo ───
// fecha/kilos de INGRESO salen del propio movimiento que trae el rodeo a
// feed lot (no se vuelven a tipear); fecha estimada de salida y kilos
// objetivo son el único dato nuevo que se pide en ese momento.
export async function registrarEntradaFeedLot({ rodeoId, corral, fecha, kilosIngreso, fechaEstimadaSalida, kilosSalidaObjetivo }) {
  const { error: errorCorral } = await supabase.from('rodeos').update({ corral }).eq('id', rodeoId);
  if (errorCorral) throw errorCorral;
  const { error } = await supabase.from('feed_lot_ciclos').insert({
    rodeo_id: rodeoId,
    fecha_ingreso: fecha,
    kilos_ingreso: kilosIngreso,
    fecha_estimada_salida: fechaEstimadaSalida || null,
    kilos_salida_objetivo: kilosSalidaObjetivo || null,
  });
  if (error) throw error;
}

// Se llama cuando un rodeo deja feed lot (traslado a otro establecimiento,
// o una salida — venta/faena/mortandad — desde feed lot): cierra el ciclo
// abierto con la fecha/kilos reales del propio movimiento, y limpia el
// corral (ya no está físicamente ahí).
export async function registrarSalidaFeedLot({ rodeoId, fecha, kilosSalida }) {
  const { error: errorCorral } = await supabase.from('rodeos').update({ corral: null }).eq('id', rodeoId);
  if (errorCorral) throw errorCorral;
  const { error } = await supabase
    .from('feed_lot_ciclos')
    .update({ fecha_salida_real: fecha, kilos_salida_real: kilosSalida, activo: false })
    .eq('rodeo_id', rodeoId)
    .eq('activo', true);
  if (error) throw error;
}

// Corral + ciclo activo por rodeo, para mostrar en el dashboard al mirar
// el stock de feed lot ("¿en qué corral está, cuándo sale?").
export async function cargarInfoFeedLot() {
  const [{ data: rodeosFeedLot, error: errorRodeos }, { data: ciclos, error: errorCiclos }] = await Promise.all([
    supabase.from('rodeos').select('id, corral').eq('establecimiento_id', 'feed_lot'),
    supabase.from('feed_lot_ciclos').select('rodeo_id, fecha_estimada_salida, kilos_salida_objetivo').eq('activo', true),
  ]);
  const info = {};
  if (!errorRodeos) {
    for (const r of rodeosFeedLot) info[r.id] = { corral: r.corral };
  }
  if (!errorCiclos) {
    for (const c of ciclos) {
      info[c.rodeo_id] = { ...(info[c.rodeo_id] || {}), fechaEstimadaSalida: c.fecha_estimada_salida, kilosSalidaObjetivo: c.kilos_salida_objetivo };
    }
  }
  return info;
}
