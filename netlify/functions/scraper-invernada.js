// Ternero y Vaca preñada: deCampoaCampo (decampoacampo.com), API JSON
// pública sin login (`/gh_funciones.php?function=getListadoPreciosInvernada`)
// que usa la propia página para renderizar su tabla de precios — se
// encontró inspeccionando el llamado AJAX de la página, sin necesitar
// parsear HTML. Categorías confirmadas por Juan: "Terneros 180-200 Kg."
// (categoría 1 = Machos) y "Vaquillonas Preñadas" (categoría 3 =
// Vientres), tomando el precio de la semana más reciente, en pesos.
//
// Corre solo, una vez por día, vía Netlify Scheduled Functions (ver el
// cron en netlify.toml). También se puede invocar manualmente (GET) para
// probar el parseo sin esperar al cron. Requiere SUPABASE_SERVICE_ROLE_KEY.

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

exports.handler = async function () {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Netlify.' };
  }

  const fecha = fechaHoyArt();
  const resultado = {};

  for (const { categoriaApi, nombreFila, productoId } of PRODUCTOS_A_BUSCAR) {
    try {
      const precio = await obtenerPrecio(categoriaApi, nombreFila);
      if (precio == null) {
        console.error(`No se encontró/hay precio válido para "${nombreFila}" en deCampoaCampo.`);
        continue;
      }
      await upsertPrecio(productoId, fecha, precio, 'scraper');
      resultado[productoId] = precio;
    } catch (error) {
      console.error(`Error buscando/guardando ${productoId}:`, error);
    }
  }

  return { statusCode: 200, body: JSON.stringify(resultado) };
};
