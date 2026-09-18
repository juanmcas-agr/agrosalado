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

// Guarda el movimiento y, si es una corrección (editado_de), marca el
// original como reemplazado para que deje de contar en el stock.
//
// Las dos operaciones viajan juntas en el MISMO ítem de la cola a
// propósito: antes la corrección se encolaba (durable) pero la marca se
// mandaba en vivo desde el formulario, así que si la conexión se cortaba
// entre una y otra —o si navigator.onLine mentía, que es lo normal con un
// wifi sin internet— la corrección terminaba entrando y el original seguía
// contando: stock duplicado, con un aviso que se perdía de vista. Acá, si
// la marca falla, el ítem NO se borra de la cola y se reintenta entero.
// Reintentarlo es inofensivo: el upsert no duplica (ignoreDuplicates) y el
// update deja exactamente el mismo valor.
async function guardarMovimiento(fila) {
  const { error } = await supabase
    .from('movimientos')
    .upsert(fila, { onConflict: 'id', ignoreDuplicates: true });
  if (error) return error;
  if (!fila.editado_de) return null;

  const { error: errorMarca } = await supabase
    .from('movimientos')
    .update({ reemplazado_por: fila.id })
    .eq('id', fila.editado_de);
  if (!errorMarca) return null;
  return {
    ...errorMarca,
    message: `La corrección entró, pero no se pudo marcar el movimiento original como reemplazado: ${errorMarca.message}`,
  };
}

export async function trySync() {
  if (sincronizando) return;
  sincronizando = true;
  try {
    const todos = (await outboxGetAll())
      .filter((m) => m.sync_status !== 'error')
      .sort((a, b) => (a.creado_localmente_at || '').localeCompare(b.creado_localmente_at || ''));

    for (const item of todos) {
      const { sync_status, intentos, ultimo_error, creado_localmente_at, ...fila } = item;
      const error = await guardarMovimiento(fila);

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

// Los movimientos que el servidor rechazó (no por falta de red: por una
// validación que no se cumple, ej. "no hay stock suficiente"). Quedan
// guardados acá para que el usuario pueda verlos y decidir — si no, el
// banner de error no se va nunca y no hay forma de saber qué los trabó.
export async function outboxConError() {
  const todos = await outboxGetAll();
  return todos.filter((m) => m.sync_status === 'error');
}

// Saca un movimiento de la cola sin mandarlo. Es la única salida cuando el
// servidor lo rechaza por algo que ya no tiene arreglo (ej. una venta
// cargada sin señal contra stock que ya no existe): antes quedaba trabado
// para siempre, con el banner de error permanente y sin forma de sacarlo
// que no fuera borrar los datos del navegador.
export async function descartarDeLaCola(id) {
  await outboxDelete(id);
  await reportarEstado();
}

// Se llama desde el panel de la cola: trySync() ignora para siempre los
// movimientos que ya llegaron a 'error' (así no reintenta sin parar algo
// roto), así que esta función los reintenta directo, una vez, fuera de ese
// circuito, y avisa en el momento si siguen fallando (en vez de dejarlos
// en 'pending' esperando 3 ciclos automáticos más).
export async function reintentarErrores() {
  const todos = await outboxGetAll();
  const conError = todos.filter((m) => m.sync_status === 'error');
  if (!conError.length) return [];

  const siguenFallando = [];
  for (const item of conError) {
    const { sync_status, intentos, ultimo_error, creado_localmente_at, ...fila } = item;
    const error = await guardarMovimiento(fila);

    if (!error) {
      await outboxDelete(item.id);
      continue;
    }

    await outboxUpdate(item.id, {
      intentos: intentos + 1,
      ultimo_error: error.message,
      sync_status: 'error',
    });
    siguenFallando.push(error.message);
  }

  await reportarEstado();
  return siguenFallando;
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
