// Comprador de una Venta: trazabilidad pura (a quién se le vendió), no
// afecta stock ni titularidad — tabla propia, separada de titulares.
// Mismo patrón que titulares.js (cache local + alta on-the-fly).
import { supabase } from './supabaseClient.js';

let cache = [];

export async function cargarCompradores() {
  const { data, error } = await supabase.from('compradores').select('*').eq('activo', true).order('orden');
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
    .from('compradores')
    .insert({ id, nombre, orden })
    .select()
    .single();
  if (error) throw error;
  cache = [...cache, data];
  return data;
}
