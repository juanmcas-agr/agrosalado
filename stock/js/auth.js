import { supabase } from './supabaseClient.js';

const estado = {
  session: null,
  perfil: null, // { user_id, nombre_completo, rol }
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
    .select('user_id, nombre_completo, rol, activo, acceso_hacienda, acceso_granos')
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
  estado.perfil = session ? await cargarPerfil(session.user.id) : null;
  estado.listo = true;
  notificar();

  supabase.auth.onAuthStateChange(async (_evento, session) => {
    estado.session = session;
    estado.perfil = session ? await cargarPerfil(session.user.id) : null;
    notificar();
  });
}
