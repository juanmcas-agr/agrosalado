// Lógica real del scraper de Gas oil Grado 2 — separada de
// scraper-gasoil.js (el wrapper programado) para poder compartirla con
// actualizar-precios-relativos.js (el botón "Actualizar ahora" de $Rel).
// Ver la nota en scraper-gasoil.js sobre por qué hace falta este split.
//
// Usa el dataset público nacional "Precios en Surtidor" (Secretaría de
// Energía, Resolución 314/2016) como referencia — el proveedor real de
// Juan (Casa Eliceiry, Castelli) hace más de un año que no reporta ahí ese
// precio. Juan confirmó usar como referencia la estación YPF de Pilar
// ("GAS IMPULSO S.A.") o, si deja de reportar, San Pedro ("JORGE ALBERTO
// CASO S.A.") — región Pampeana, horario Diurno.

const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';
const CSV_URL = 'http://datos.energia.gob.ar/dataset/1c181390-5045-475e-94dc-410429be4b17/resource/80ac25de-a44a-4445-9215-090cf55cfda5/download/precios-en-surtidor-resolucin-3142016.csv';

// Orden de preferencia: se usa la primera que tenga un dato válido hoy.
const ESTACIONES_REFERENCIA = ['GAS IMPULSO', 'JORGE ALBERTO CASO'];

function fechaHoyArt() {
  const ahoraArt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return ahoraArt.toISOString().slice(0, 10);
}

// Parser CSV simple (RFC4180: campos entre comillas dobles, comilla
// escapada como ""). El dataset trae un campo geojson con comas adentro,
// así que un split(',') a secas rompe la fila — esto no.
function parsearFilaCsv(linea) {
  const campos = [];
  let actual = '';
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (entreComillas) {
      if (c === '"') {
        if (linea[i + 1] === '"') { actual += '"'; i++; } else entreComillas = false;
      } else {
        actual += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ',') {
      campos.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos;
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
  if (!res.ok) throw new Error(`No se pudo guardar gasoil_g2: ${res.status} ${await res.text()}`);
}

async function buscarPrecioGasoil() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`No se pudo descargar el CSV de Precios en Surtidor: ${res.status}`);
  const texto = await res.text();
  const lineas = texto.split('\n');

  const cabecera = parsearFilaCsv(lineas[0]);
  const idxProducto = cabecera.indexOf('producto');
  const idxHorario = cabecera.indexOf('tipohorario');
  const idxPrecio = cabecera.indexOf('precio');
  const idxRegion = cabecera.indexOf('region');
  const idxIndiceTiempo = cabecera.indexOf('indice_tiempo');

  for (const nombreEstacion of ESTACIONES_REFERENCIA) {
    // Filtro rápido por substring antes de parsear la línea completa — el
    // archivo es de varios MB / decenas de miles de filas.
    const candidatas = lineas.filter((l) => l.includes(nombreEstacion) && l.includes('Gas Oil Grado 2'));
    let mejor = null;
    for (const linea of candidatas) {
      const campos = parsearFilaCsv(linea);
      if (campos[idxProducto] !== 'Gas Oil Grado 2') continue;
      if (campos[idxHorario] !== 'Diurno') continue;
      if (campos[idxRegion] !== 'PAMPEANA') continue;
      const precio = Number(campos[idxPrecio]);
      if (!Number.isFinite(precio) || precio <= 0) continue;
      if (!mejor || campos[idxIndiceTiempo] > mejor.indiceTiempo) {
        mejor = { precio, indiceTiempo: campos[idxIndiceTiempo] };
      }
    }
    if (mejor) return { estacion: nombreEstacion, ...mejor };
  }
  return null;
}

async function ejecutarGasoil() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, mensaje: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Netlify.' };
  }
  try {
    const encontrado = await buscarPrecioGasoil();
    if (!encontrado) {
      return { ok: false, mensaje: 'Sin datos hoy para ninguna estación de referencia (Pilar/San Pedro).' };
    }
    await upsertPrecio('gasoil_g2', fechaHoyArt(), encontrado.precio, 'scraper');
    return { ok: true, ...encontrado };
  } catch (error) {
    return { ok: false, mensaje: error.message };
  }
}

module.exports = { ejecutarGasoil };
