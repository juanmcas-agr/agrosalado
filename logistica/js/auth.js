// A diferencia de las otras 3 apps (un solo tipo de usuario: personal
// interno con fila en perfiles), acá hay DOS identidades posibles para un
// mismo user_id de Supabase Auth: personal interno (perfiles, como
// siempre) o transportista (tabla aparte, propio o externo — ver
// supabase/schema.sql, sección "Logística"). Al iniciar sesión se busca
// primero en perfiles y, si no está, en transportistas — el modo
// resultante ("staff" | "transportista") decide qué pantallas mostrar
// (ver app.js).
import { supabase } from './supabaseClient.js';

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
  Object.assign(estado, session ? await resolverIdentidad(session.user.id) : { modo: null, perfil: null, transportista: null });
  estado.listo = true;
  notificar();

  supabase.auth.onAuthStateChange(async (_evento, session) => {
    estado.session = session;
    Object.assign(estado, session ? await resolverIdentidad(session.user.id) : { modo: null, perfil: null, transportista: null });
    notificar();
  });
}
