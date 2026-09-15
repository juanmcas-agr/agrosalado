// Comprador de una Venta: trazabilidad pura (a quién se le vendió), no
// afecta stock ni titularidad — tabla propia, separada de titulares.
// Mismo patrón que titulares.js (cache local + alta on-the-fly).
// Se llama "compradores_hacienda" (no "compradores" a secas) porque Granos
// ya tiene su propia tabla "compradores" (compradores de GRANOS) en el
// mismo proyecto de Supabase compartido — nombres de tabla comparten
// namespace entre las 4 apps.
import { supabase } from './supabaseClient.js';

let cache = [];

export async function cargarCompradores() {
  const { data, error } = await supabase.from('compradores_hacienda').select('*').eq('activo', true).order('orden');
  if (!error) cache = data;
  return cache;
}

export function obtenerCompradoresCache() {
  return cache;
}

function slugify(texto) {
  const sinAcentos = texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return sinAcentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export async function crearComprador(nombre) {
  const id = slugify(nombre);
  if (!id) throw new Error('Nombre inválido');
  const existente = cache.find((c) => c.id === id);
  if (existente) return existente;

  const orden = cache.length ? Math.max(...cache.map((c) => c.orden)) + 1 : 1;
  const { data, error } = await supabase
    .from('compradores_hacienda')
    .insert({ id, nombre, orden })
    .select()
    .single();
  if (error) throw error;
  cache = [...cache, data];
  return data;
}
