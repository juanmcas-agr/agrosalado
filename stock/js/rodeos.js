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

// Cabezas actuales de un rodeo (sumando todos los titulares) — se pide en
// vivo al validar un movimiento de salida/interna, no se cachea, para no
// dar luz verde con un stock desactualizado.
export async function stockDelRodeo(rodeoId) {
  const { data, error } = await supabase.from('stock_actual').select('cabezas').eq('rodeo_id', rodeoId);
  if (error) throw error;
  return data.reduce((acc, r) => acc + Number(r.cabezas), 0);
}
