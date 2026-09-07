// Novillo: Mercado Agroganadero (mercadoagroganadero.com.ar), categoría
// "NOVILLITOS EyB P. 391/430", columna Promedio — confirmado por Juan con
// una captura de la página real. La página es un formulario clásico (sin
// login) que responde a un POST con rango de fechas; se probó server-side
// (sin browser) y funciona con un POST plano.
//
// Corre solo, una vez por día, vía Netlify Scheduled Functions (ver el
// cron en netlify.toml). También se puede invocar manualmente (GET) para
// probar el parseo sin esperar al cron. Requiere SUPABASE_SERVICE_ROLE_KEY.

const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';
const URL_MAG = 'https://mercadoagroganadero.com.ar/dll/hacienda1.dll/haciinfo000002';
const CATEGORIA = 'NOVILLITOS EyB P. 391/430';

function instanteHoyArt() {
  const ahoraArt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return ahoraArt;
}

function formatearDDMMYYYY(fecha) {
  const dd = String(fecha.getUTCDate()).padStart(2, '0');
  const mm = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = fecha.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function parsearNumeroArgentino(texto) {
  // "4510,473" -> 4510.473 (acá no hay separador de miles en este campo).
  const n = Number(texto.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

async function buscarPromedioNovillo() {
  const hoy = instanteHoyArt();
  const hace7Dias = new Date(hoy.getTime() - 7 * 24 * 60 * 60 * 1000);
  const body = new URLSearchParams({
    ID: '', CP: '', FLASH: '', USUARIO: 'SIN IDENTIFICAR',
    OPCIONMENU: '', OPCIONSUBMENU: '',
    // Ventana de 7 días: si "hoy" todavía no tiene remates cargados, igual
    // trae el último dato disponible dentro del rango.
    txtFechaIni: formatearDDMMYYYY(hace7Dias),
    txtFechaFin: formatearDDMMYYYY(hoy),
  });

  const res = await fetch(URL_MAG, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Mercado Agroganadero respondió ${res.status}`);
  const html = await res.text();

  const escapado = CATEGORIA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `${escapado}\\s*</TD>\\s*<TD[^>]*>([\\d.,]+)</TD>\\s*<TD[^>]*>([\\d.,]+)</TD>\\s*<TD[^>]*>([\\d.,]+)</TD>`,
    'i'
  );
  const match = html.match(regex);
  if (!match) return null;

  return parsearNumeroArgentino(match[3]); // 3er valor = columna Promedio
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
  if (!res.ok) throw new Error(`No se pudo guardar novillo: ${res.status} ${await res.text()}`);
}

exports.handler = async function () {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Netlify.' };
  }
  try {
    const promedio = await buscarPromedioNovillo();
    if (!promedio) {
      console.error(`No se encontró la categoría "${CATEGORIA}" en Mercado Agroganadero.`);
      return { statusCode: 200, body: 'Sin datos para esa categoría en el rango consultado.' };
    }
    const fecha = instanteHoyArt().toISOString().slice(0, 10);
    await upsertPrecio('novillo', fecha, promedio, 'scraper');
    return { statusCode: 200, body: JSON.stringify({ promedio }) };
  } catch (error) {
    console.error('Error en scraper-novillo:', error);
    return { statusCode: 500, body: error.message };
  }
};
