import { supabase } from './supabaseClient.js';

// Cache del perfil en localStorage (misma clave que usan Granos/Hacienda/
// Logística — comparten origen en producción, así que sirve para las 4)
// para no tener que esperar la red en CADA cambio de app: al entrar se
// muestra de entrada el último perfil conocido (si hay) y se revalida
// enseguida en segundo plano, así un cambio real de rol/accesos se
// termina reflejando igual, solo que sin el parpadeo de "Verificando
// acceso..." en el caso común (nada cambió desde la última vez).
const CACHE_KEY = 'agrosalado_perfil_cache';

function leerPerfilCache(userId) {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return cache && cache.user_id === userId ? cache : null;
  } catch {
    return null;
  }
}

function guardarPerfilCache(perfil) {
  try {
    if (perfil) localStorage.setItem(CACHE_KEY, JSON.stringify(perfil));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // localStorage puede fallar (modo privado, cuota llena) — no es
    // crítico, simplemente se vuelve a pedir por red la próxima vez.
  }
}

const estado = {
  session: null,
  perfil: null, // { user_id, nombre_completo, rol, acceso_precios_relativos, acceso_granos, acceso_hacienda }
  listo: false,
};

const listeners = new Set();

function notificar() {
  for (const cb of listeners) cb(estado);
}

export function onAuthChange(callback) {
  listeners.add(callback);
  if (estado.listo) callback(estado);
  return () => listeners.delete(callback);
}

async function cargarPerfil(userId) {
  const { data, error } = await supabase
    .from('perfiles')
    .select('user_id, nombre_completo, rol, activo, acceso_precios_relativos, acceso_granos, acceso_hacienda, acceso_logistica')
    .eq('user_id', userId)
    .single();
  if (error) {
    console.error('No se pudo cargar el perfil del usuario', error);
    return null;
  }
  return data;
}

export async function iniciarSesion(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function cerrarSesion() {
  await supabase.auth.signOut();
}

export function getEstado() {
  return estado;
}

export async function initAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  estado.session = session;
  const cache = session ? leerPerfilCache(session.user.id) : null;
  if (cache) {
    estado.perfil = cache;
    estado.listo = true;
    notificar();
  }
  estado.perfil = session ? await cargarPerfil(session.user.id) : null;
  guardarPerfilCache(estado.perfil);
  estado.listo = true;
  notificar();

  supabase.auth.onAuthStateChange(async (_evento, session) => {
    estado.session = session;
    estado.perfil = session ? await cargarPerfil(session.user.id) : null;
    guardarPerfilCache(estado.perfil);
    notificar();
  });
}
