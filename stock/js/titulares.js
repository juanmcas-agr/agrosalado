import { supabase } from './supabaseClient.js';

let cache = [];

export async function cargarTitulares() {
  const { data, error } = await supabase.from('titulares').select('*').eq('activo', true).order('orden');
  if (!error) cache = data;
  return cache;
}

export function obtenerTitularesCache() {
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

export async function crearCapitalizador(nombre) {
  const id = slugify(nombre);
  if (!id) throw new Error('Nombre inválido');
  const existente = cache.find((t) => t.id === id);
  if (existente) return existente;

  const orden = cache.length ? Math.max(...cache.map((t) => t.orden)) + 1 : 1;
  const { data, error } = await supabase
    .from('titulares')
    .insert({ id, nombre, tipo: 'capitalizador', orden })
    .select()
    .single();
  if (error) throw error;
  cache = [...cache, data];
  return data;
}
