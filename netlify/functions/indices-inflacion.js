// Índices de inflación para "moneda constante" en $Rel: ARS vía IPC INDEC
// (API pública ArgentinaDatos, que da variación % mensual — acá se
// encadena para construir un índice acumulado) y USD vía CPI de EEUU
// (FRED, serie CPIAUCSL, que ya viene como índice directo).
//
// El punto de partida (2019-01, "índice=100") es arbitrario — no importa
// cuál se elija, porque cualquier comparación "real" que arme la app usa
// SIEMPRE un cociente entre dos fechas (indice_hoy / indice_de_la_fecha),
// y ese cociente da lo mismo sin importar dónde se ancló el 100 (se
// cancela matemáticamente). Se arranca en 2019-01 nada más para no cargar
// décadas de historia que este proyecto no necesita (los datos de
// productos más viejos son de abril 2020).
//
// Corre una vez por mes (el IPC es mensual, no tiene sentido más seguido)
// vía Netlify Scheduled Functions (ver el cron en netlify.toml). También
// se puede invocar manualmente (GET) para forzar una actualización.
// Requiere SUPABASE_SERVICE_ROLE_KEY y FRED_API_KEY.

const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';
const FECHA_DESDE = '2019-01-01';

function headersSupabase(extra) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function upsertIndice(tipo, fecha, indice) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/precios_relativos_indices?on_conflict=tipo,fecha`, {
    method: 'POST',
    headers: headersSupabase({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify({ tipo, fecha, indice }),
  });
  if (!res.ok) throw new Error(`No se pudo guardar índice ${tipo} (${fecha}): ${res.status} ${await res.text()}`);
}

// Primer día del mes de una fecha (la API a veces da el último día del
// mes; acá se normaliza para que combine con cómo se guardan los demás
// datos de $Rel).
function primerDiaDelMes(fechaIso) {
  return `${fechaIso.slice(0, 7)}-01`;
}

async function actualizarIndiceArs() {
  const res = await fetch('https://api.argentinadatos.com/v1/finanzas/indices/inflacion');
  if (!res.ok) throw new Error(`ArgentinaDatos respondió ${res.status}`);
  const datos = await res.json();

  const enRango = datos
    .filter((d) => d.fecha >= FECHA_DESDE && typeof d.valor === 'number')
    .sort((a, b) => (a.fecha < b.fecha ? -1 : 1));

  let indice = 100;
  let guardados = 0;
  for (const punto of enRango) {
    // Primer mes del rango: se ancla en 100 y no se le aplica su propia
    // variación (esa variación es respecto al mes anterior, que quedó
    // fuera del rango). A partir del segundo, se encadena.
    if (guardados > 0) indice = indice * (1 + punto.valor / 100);
    await upsertIndice('ARS', primerDiaDelMes(punto.fecha), Math.round(indice * 100) / 100);
    guardados++;
  }
  return guardados;
}

async function actualizarIndiceUsd() {
  const apiKey = process.env.FRED_API_KEY;
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&api_key=${apiKey}&file_type=json&observation_start=${FECHA_DESDE}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED respondió ${res.status}`);
  const datos = await res.json();

  let guardados = 0;
  for (const obs of datos.observations || []) {
    const valor = Number(obs.value);
    if (!Number.isFinite(valor)) continue; // FRED marca los faltantes con "."
    await upsertIndice('USD', primerDiaDelMes(obs.date), valor);
    guardados++;
  }
  return guardados;
}

exports.handler = async function () {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Netlify.' };
  }
  if (!process.env.FRED_API_KEY) {
    return { statusCode: 500, body: 'Falta configurar FRED_API_KEY en Netlify.' };
  }

  const resultado = {};
  try {
    resultado.ars = await actualizarIndiceArs();
  } catch (error) {
    console.error('No se pudo actualizar el índice ARS (IPC):', error);
    resultado.ars_error = error.message;
  }
  try {
    resultado.usd = await actualizarIndiceUsd();
  } catch (error) {
    console.error('No se pudo actualizar el índice USD (CPI):', error);
    resultado.usd_error = error.message;
  }

  return { statusCode: 200, body: JSON.stringify(resultado) };
};
