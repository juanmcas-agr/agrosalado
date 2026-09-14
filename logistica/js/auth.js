// A diferencia de las otras 3 apps (un solo tipo de usuario: personal
// interno con fila en perfiles), acá hay DOS identidades posibles para un
// mismo user_id de Supabase Auth: personal interno (perfiles, como
// siempre) o transportista (tabla aparte, propio o externo — ver
// supabase/schema.sql, sección "Logística"). Al iniciar sesión se busca
// primero en perfiles y, si no está, en transportistas — el modo
// resultante ("staff" | "transportista") decide qué pantallas mostrar
// (ver app.js).
import { supabase } from './supabaseClient.js';

// Cache de la identidad resuelta en localStorage, para no esperar la red
// en CADA cambio de app: se muestra de entrada la última identidad
// conocida (si hay) y se revalida enseguida en segundo plano, así un
// cambio real de rol/accesos se termina reflejando igual, solo que sin
// el parpadeo de "Verificando acceso..." en el caso común (nada cambió
// desde la última vez). Dos claves porque son dos identidades excluyentes
// (staff vs. transportista) — la de perfil es la MISMA que usan Granos/
// Hacienda/$Rel (comparten origen en producción), así que loguearse acá
// también acelera el primer ingreso a esas otras apps.
const CACHE_KEY_PERFIL = 'agrosalado_perfil_cache';
const CACHE_KEY_TRANSPORTISTA = 'agrosalado_transportista_cache';

function leerCache(key, userId) {
  try {
    const cache = JSON.parse(localStorage.getItem(key) || 'null');
    return cache && cache.user_id === userId ? cache : null;
  } catch {
    return null;
  }
}

function guardarCache(key, valor) {
  try {
    if (valor) localStorage.setItem(key, JSON.stringify(valor));
    else localStorage.removeItem(key);
  } catch {
    // localStorage puede fallar (modo privado, cuota llena) — no es
    // crítico, se vuelve a pedir por red la próxima vez.
  }
}

function leerIdentidadCache(userId) {
  const perfil = leerCache(CACHE_KEY_PERFIL, userId);
  if (perfil) return { modo: 'staff', perfil, transportista: null };
  const transportista = leerCache(CACHE_KEY_TRANSPORTISTA, userId);
  if (transportista) return { modo: 'transportista', perfil: null, transportista };
  return null;
}

function guardarIdentidadCache(identidad) {
  guardarCache(CACHE_KEY_PERFIL, identidad.modo === 'staff' ? identidad.perfil : null);
  guardarCache(CACHE_KEY_TRANSPORTISTA, identidad.modo === 'transportista' ? identidad.transportista : null);
}

const estado = {
  session: null,
  modo: null, // 'staff' | 'transportista' | null
  perfil: null, // { user_id, nombre_completo, rol, acceso_logistica, acceso_logistica_sueldos } — solo si modo === 'staff'
  transportista: null, // { user_id, nombre_completo, email, categoria } — solo si modo === 'transportista'
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
    .select('user_id, nombre_completo, rol, activo, acceso_hacienda, acceso_granos, acceso_precios_relativos, acceso_logistica, acceso_logistica_sueldos')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('No se pudo cargar el perfil del usuario', error);
    return null;
  }
  return data;
}

async function cargarTransportista(userId) {
  const { data, error } = await supabase
    .from('transportistas')
    .select('user_id, nombre_completo, email, categoria, activo')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('No se pudo cargar el transportista', error);
    return null;
  }
  return data;
}

// Un mismo user_id no debería estar en las dos tablas a la vez, pero si
// pasara (o si no está en ninguna), prioriza "perfil" (personal interno).
async function resolverIdentidad(userId) {
  const perfil = await cargarPerfil(userId);
  if (perfil) return { modo: 'staff', perfil, transportista: null };
  const transportista = await cargarTransportista(userId);
  if (transportista) return { modo: 'transportista', perfil: null, transportista };
  return { modo: null, perfil: null, transportista: null };
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
  const cache = session ? leerIdentidadCache(session.user.id) : null;
  if (cache) {
    Object.assign(estado, cache);
    estado.listo = true;
    notificar();
  }
  const identidad = session ? await resolverIdentidad(session.user.id) : { modo: null, perfil: null, transportista: null };
  Object.assign(estado, identidad);
  guardarIdentidadCache(identidad);
  estado.listo = true;
  notificar();

  supabase.auth.onAuthStateChange(async (_evento, session) => {
    estado.session = session;
    const identidad = session ? await resolverIdentidad(session.user.id) : { modo: null, perfil: null, transportista: null };
    Object.assign(estado, identidad);
    guardarIdentidadCache(identidad);
    notificar();
  });
}
