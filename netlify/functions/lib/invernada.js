// Lógica real del scraper de Ternero/Vaca preñada — separada de
// scraper-invernada.js (el wrapper programado) para poder compartirla con
// actualizar-precios-relativos.js. Ver la nota en scraper-invernada.js.
//
// deCampoaCampo (decampoacampo.com), API JSON pública sin login
// (`/gh_funciones.php?function=getListadoPreciosInvernada`) que usa la
// propia página para renderizar su tabla de precios. Categorías
// confirmadas por Juan: "Terneros 180-200 Kg." (categoría 1 = Machos) y
// "Vaquillonas Preñadas" (categoría 3 = Vientres), precio de la semana más
// reciente, en pesos.

const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';
const URL_API = 'https://www.decampoacampo.com/gh_funciones.php';

const PRODUCTOS_A_BUSCAR = [
  { categoriaApi: 1, nombreFila: 'Terneros 180-200 Kg.', productoId: 'ternero' },
  { categoriaApi: 3, nombreFila: 'Vaquillonas Preñadas', productoId: 'vaca_prenada' },
];

function fechaHoyArt() {
  const ahoraArt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return ahoraArt.toISOString().slice(0, 10);
}

async function obtenerPrecio(categoriaApi, nombreFila) {
  const url = `${URL_API}?function=getListadoPreciosInvernada&p=${categoriaApi}&m=peso`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`deCampoaCampo respondió ${res.status}`);
  const datos = await res.json();
  const fila = (datos.data || []).find((f) => f.categoria.trim() === nombreFila);
  if (!fila) return null;
  const precio = Number(fila.precio_semana_1);
  return Number.isFinite(precio) && precio > 0 ? precio : null;
}

async function upsertPrecio(producto_id, fecha, valor_nativo, origen_dato) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/precios_relativos_historial?on_conflict=producto_id,fecha`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ producto_id, fecha, valor_nativo, origen_dato }),
  });
  if (!res.ok) throw new Error(`No se pudo guardar ${producto_id}: ${res.status} ${await res.text()}`);
}

async function ejecutarInvernada() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, mensaje: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Netlify.' };
  }

  const fecha = fechaHoyArt();
  const valores = {};
  const errores = [];

  for (const { categoriaApi, nombreFila, productoId } of PRODUCTOS_A_BUSCAR) {
    try {
      const precio = await obtenerPrecio(categoriaApi, nombreFila);
      if (precio == null) {
        errores.push(`Sin precio válido para "${nombreFila}".`);
        continue;
      }
      await upsertPrecio(productoId, fecha, precio, 'scraper');
      valores[productoId] = precio;
    } catch (error) {
      errores.push(`${productoId}: ${error.message}`);
    }
  }

  return { ok: errores.length === 0, valores, mensaje: errores.join(' ') || undefined };
}

module.exports = { ejecutarInvernada };
