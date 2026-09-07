// Foto diaria de $Rel: guarda el valor de hoy de dólar (oficial/BNA y
// blue) y los 4 granos de pizarra (soja/maíz/trigo/girasol), reusando los
// endpoints que Granos ya llama en vivo (tc.js/pizarra.js) — cero
// re-scrapeo acá. Además corre el arrastre (LOCF): para cada producto
// manual (MAP/UREA/Glifosato) que no tuvo carga humana hoy, copia el
// último valor conocido con origen_dato='arrastre', para que la matriz de
// $Rel nunca tenga huecos y para que más adelante se pueda avisar cuántos
// días pasaron sin una carga humana real.
//
// Corre solo, una vez por día, vía Netlify Scheduled Functions (ver el
// cron en netlify.toml). Requiere SUPABASE_SERVICE_ROLE_KEY (misma que el
// resto de las funciones de servidor, ver resumen-diario-hacienda.js).

const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';

function fechaHoyArt() {
  // Mismo criterio que resumen-diario-hacienda.js: se resta el offset de
  // Argentina (UTC-3) al momento UTC de la corrida para saber qué fecha
  // ART corresponde.
  const ahoraArt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return ahoraArt.toISOString().slice(0, 10);
}

function headersSupabase(extra) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function consultarSupabase(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headersSupabase() });
  if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${await res.text()}`);
  return res.json();
}

async function upsertPrecio(producto_id, fecha, valor_nativo, origen_dato) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/precios_relativos_historial?on_conflict=producto_id,fecha`, {
    method: 'POST',
    headers: headersSupabase({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify({ producto_id, fecha, valor_nativo, origen_dato }),
  });
  if (!res.ok) {
    console.error(`No se pudo guardar ${producto_id} (${fecha}):`, await res.text());
  }
}

function numeroSeguro(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function guardarDolarDelDia(baseUrl, fecha) {
  const res = await fetch(`${baseUrl}/.netlify/functions/tc`);
  const datos = await res.json();
  // "oficial" es el que Granos ya muestra como "OFICIAL BNA".
  const mapa = { oficial: 'dolar_bna', blue: 'dolar_blue' };
  for (const [casa, productoId] of Object.entries(mapa)) {
    const d = datos[casa];
    if (!d) continue;
    const compra = numeroSeguro(d.compra);
    const venta = numeroSeguro(d.venta);
    // Promedio compra/venta como valor representativo del día; si solo
    // vino uno de los dos, se usa ese.
    const valor = compra && venta ? (compra + venta) / 2 : venta || compra;
    if (valor) await upsertPrecio(productoId, fecha, valor, 'scraper');
  }
}

async function guardarGranosDelDia(baseUrl, fecha) {
  const res = await fetch(`${baseUrl}/.netlify/functions/pizarra`);
  const datos = await res.json();
  const mapa = { soja: 'soja_ros', maiz: 'maiz_ros', trigo: 'trigo_ros', girasol: 'girasol_ros' };
  for (const [clave, productoId] of Object.entries(mapa)) {
    const valor = numeroSeguro(datos.granos && datos.granos[clave]);
    if (valor) await upsertPrecio(productoId, fecha, valor, 'scraper');
  }
}

async function arrastrarProductosManuales(fecha) {
  const manuales = await consultarSupabase('precios_relativos_productos?origen=eq.manual&select=id');
  for (const { id: productoId } of manuales) {
    const yaTieneHoy = await consultarSupabase(
      `precios_relativos_historial?producto_id=eq.${productoId}&fecha=eq.${fecha}&select=id&limit=1`
    );
    if (yaTieneHoy.length) continue; // ya se cargó (a mano, o ya se arrastró) hoy

    const ultimo = await consultarSupabase(
      `precios_relativos_historial?producto_id=eq.${productoId}&order=fecha.desc&limit=1&select=valor_nativo`
    );
    if (!ultimo.length) continue; // todavía no hay ningún dato histórico para arrastrar

    await upsertPrecio(productoId, fecha, ultimo[0].valor_nativo, 'arrastre');
  }
}

exports.handler = async function () {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Falta SUPABASE_SERVICE_ROLE_KEY.');
    return { statusCode: 500, body: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Netlify.' };
  }

  const fecha = fechaHoyArt();
  const baseUrl = process.env.URL || '';

  try {
    await guardarDolarDelDia(baseUrl, fecha);
  } catch (error) {
    console.error('No se pudo obtener/guardar el dólar del día:', error);
  }

  try {
    await guardarGranosDelDia(baseUrl, fecha);
  } catch (error) {
    console.error('No se pudo obtener/guardar los granos del día:', error);
  }

  try {
    await arrastrarProductosManuales(fecha);
  } catch (error) {
    console.error('No se pudo correr el arrastre de productos manuales:', error);
  }

  return { statusCode: 200, body: 'ok' };
};
