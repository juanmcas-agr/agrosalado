// Lógica real de la foto diaria de $Rel — separada de
// cierre-diario-precios-relativos.js (el wrapper programado) para poder
// compartirla con actualizar-precios-relativos.js. Ver la nota en
// cierre-diario-precios-relativos.js.
//
// Guarda el valor de hoy de dólar (oficial/BNA y blue) y los 4 granos de
// pizarra (soja/maíz/trigo/girasol), reusando los endpoints que Granos ya
// llama en vivo (tc.js/pizarra.js — esos NO tienen schedule, siguen siendo
// invocables por HTTP normal). Además corre el arrastre (LOCF): para cada
// producto manual (MAP/UREA/Glifosato) que no tuvo carga humana hoy, copia
// el último valor conocido con origen_dato='arrastre'.

const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';

function fechaHoyArt() {
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

async function ejecutarCierreDiario() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, mensaje: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Netlify.' };
  }

  const fecha = fechaHoyArt();
  const baseUrl = process.env.URL || '';
  const errores = [];

  try {
    await guardarDolarDelDia(baseUrl, fecha);
  } catch (error) {
    errores.push(`dólar: ${error.message}`);
  }

  try {
    await guardarGranosDelDia(baseUrl, fecha);
  } catch (error) {
    errores.push(`granos: ${error.message}`);
  }

  try {
    await arrastrarProductosManuales(fecha);
  } catch (error) {
    errores.push(`arrastre: ${error.message}`);
  }

  return { ok: errores.length === 0, mensaje: errores.join(' ') || undefined };
}

module.exports = { ejecutarCierreDiario };
