import { supabase } from './supabaseClient.js';
import { outboxAdd, outboxGetAll, outboxUpdate, outboxDelete } from './db-local.js';

const MAX_INTENTOS_VALIDACION = 3;
const INTERVALO_MS = 30000;

const listeners = new Set();
let sincronizando = false;

function notificar(estado) {
  for (const cb of listeners) cb(estado);
}

export function onSyncChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

async function estadoActual() {
  const todos = await outboxGetAll();
  return {
    pendientes: todos.filter((m) => m.sync_status !== 'error').length,
    conError: todos.filter((m) => m.sync_status === 'error').length,
    total: todos.length,
  };
}

async function reportarEstado() {
  notificar(await estadoActual());
}

// Se llama desde el formulario de carga: guarda el movimiento localmente
// y lo muestra optimista, e intenta sincronizarlo si hay conexión.
export async function encolarMovimiento(row) {
  const conMeta = {
    ...row,
    sync_status: 'pending',
    intentos: 0,
    ultimo_error: null,
    creado_localmente_at: new Date().toISOString(),
  };
  await outboxAdd(conMeta);
  await reportarEstado();
  if (navigator.onLine) trySync();
  return conMeta;
}

function esErrorDeRed(error) {
  const msg = (error && error.message) || '';
  // fetch fallido (sin red) no trae código de Postgres/PostgREST
  return !error?.code && /fetch|network|failed/i.test(msg);
}

export async function trySync() {
  if (sincronizando) return;
  sincronizando = true;
  try {
    const todos = (await outboxGetAll())
      .filter((m) => m.sync_status !== 'error')
      .sort((a, b) => a.creado_localmente_at.localeCompare(b.creado_localmente_at));

    for (const item of todos) {
      const { sync_status, intentos, ultimo_error, creado_localmente_at, ...fila } = item;
      const { error } = await supabase
        .from('movimientos')
        .upsert(fila, { onConflict: 'id', ignoreDuplicates: true });

      if (!error) {
        await outboxDelete(item.id);
        continue;
      }

      if (esErrorDeRed(error)) {
        await outboxUpdate(item.id, {
          intentos: intentos + 1,
          ultimo_error: error.message,
        });
        // sin red: no tiene sentido seguir intentando el resto ahora
        break;
      }

      const nuevosIntentos = intentos + 1;
      await outboxUpdate(item.id, {
        intentos: nuevosIntentos,
        ultimo_error: error.message,
        sync_status: nuevosIntentos >= MAX_INTENTOS_VALIDACION ? 'error' : 'pending',
      });
    }
  } finally {
    sincronizando = false;
    await reportarEstado();
  }
}

export function initSync() {
  window.addEventListener('online', () => trySync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') trySync();
  });
  setInterval(() => trySync(), INTERVALO_MS);
  reportarEstado();
  if (navigator.onLine) trySync();
}
