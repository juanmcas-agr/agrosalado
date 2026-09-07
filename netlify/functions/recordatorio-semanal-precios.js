// Wrapper programado: corre solo, todos los viernes a las 10:00 hora
// Argentina, vía Netlify Scheduled Functions (ver el cron en
// netlify.toml). IMPORTANTE: una vez que un archivo tiene "schedule" en
// netlify.toml, Netlify bloquea con 403 cualquier invocación pública por
// HTTP directa — no se puede probar visitando esta URL a mano. La lógica
// real vive en lib/recordatorioSemanal.js, compartida con
// actualizar-recordatorio-semanal.js (SIN schedule, ese sí invocable por
// HTTP para poder probarlo).
//
// Requiere en Netlify: RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Opcional: RESEND_FROM, RESEND_TO_PRECIOS (override para pruebas).
const { ejecutarRecordatorioSemanal } = require('./lib/recordatorioSemanal');

exports.handler = async function () {
  const resultado = await ejecutarRecordatorioSemanal();
  return { statusCode: resultado.ok ? 200 : 500, body: JSON.stringify(resultado) };
};
