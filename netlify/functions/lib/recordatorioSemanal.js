// Lógica real del recordatorio semanal de $Rel — separada de
// recordatorio-semanal-precios.js (el wrapper programado) para poder
// compartirla con un endpoint de prueba sin schedule. Ver la nota en
// recordatorio-semanal-precios.js.
//
// Todos los viernes revisa si los productos manuales (MAP/UREA/Glifosato)
// tuvieron al menos una carga HUMANA real (origen_dato='manual', no
// 'arrastre') en los últimos 7 días. Si a alguno le falta, manda un mail
// avisando cuáles — a quien tenga tildado "Recibe alertas de $Rel" en
// Administrar usuarios (columna recibe_alertas_precios de
// destinatarios_negocio), no solo a owners.

const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';
const DESTINATARIOS_DEFAULT = ['juanmanueluranga@gmail.com'];

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

function fechaHaceNDiasArt(n) {
  const ahoraArt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  ahoraArt.setUTCDate(ahoraArt.getUTCDate() - n);
  return ahoraArt.toISOString().slice(0, 10);
}

async function obtenerDestinatarios() {
  if (process.env.RESEND_TO_PRECIOS) {
    return process.env.RESEND_TO_PRECIOS.split(',').map((m) => m.trim()).filter(Boolean);
  }
  try {
    const filas = await consultarSupabase('destinatarios_negocio?recibe_alertas_precios=eq.true&select=email');
    const emails = filas.map((f) => f.email).filter(Boolean);
    if (emails.length) return emails;
  } catch (error) {
    console.error('No se pudo leer destinatarios_negocio, uso la lista de respaldo:', error);
  }
  return DESTINATARIOS_DEFAULT;
}

async function productosSinConfirmarEstaSemana() {
  const manuales = await consultarSupabase('precios_relativos_productos?origen=eq.manual&select=id,nombre');
  const desde = fechaHaceNDiasArt(7);

  const faltantes = [];
  for (const producto of manuales) {
    const cargasRecientes = await consultarSupabase(
      `precios_relativos_historial?producto_id=eq.${producto.id}&origen_dato=eq.manual&fecha=gte.${desde}&select=id&limit=1`
    );
    if (!cargasRecientes.length) faltantes.push(producto);
  }
  return faltantes;
}

async function ejecutarRecordatorioSemanal() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, mensaje: 'Faltan variables de entorno (RESEND_API_KEY / SUPABASE_SERVICE_ROLE_KEY).' };
  }

  let faltantes;
  try {
    faltantes = await productosSinConfirmarEstaSemana();
  } catch (error) {
    return { ok: false, mensaje: 'No se pudo consultar la base: ' + error.message };
  }

  if (!faltantes.length) {
    return { ok: true, enviado: false, mensaje: 'Todos los productos manuales se confirmaron esta semana, no se manda mail.' };
  }

  const remitente = process.env.RESEND_FROM || 'AGROSALADO <onboarding@resend.dev>';
  const destinatarios = await obtenerDestinatarios();
  const listaHtml = faltantes.map((p) => `<li>${p.nombre}</li>`).join('');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: remitente,
      to: destinatarios,
      subject: 'AGROSALADO $Rel — Faltan precios por confirmar esta semana',
      html: `
        <p><strong>Esta semana no se confirmó ningún valor a mano para:</strong></p>
        <ul>${listaHtml}</ul>
        <p>El sistema sigue arrastrando el último valor conocido, pero conviene confirmarlo (o actualizarlo) en la pantalla "Cargar precios manuales" de $Rel.</p>
      `,
    }),
  });

  if (!res.ok) {
    const detalle = await res.text();
    return { ok: false, mensaje: `Resend rechazó el mail: ${detalle}` };
  }

  return { ok: true, enviado: true, faltantes: faltantes.map((p) => p.nombre) };
}

module.exports = { ejecutarRecordatorioSemanal };
