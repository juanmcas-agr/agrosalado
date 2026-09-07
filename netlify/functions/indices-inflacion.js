// Wrapper programado: corre una vez por mes (el IPC es mensual, no tiene
// sentido más seguido) vía Netlify Scheduled Functions (ver el cron en
// netlify.toml). IMPORTANTE: una vez que un archivo tiene "schedule" en
// netlify.toml, Netlify bloquea con 403 cualquier invocación pública por
// HTTP directa — no se puede probar visitando esta URL a mano. La lógica
// real vive en lib/indicesInflacion.js, compartida con
// actualizar-indices-inflacion.js (SIN schedule, ese sí invocable por HTTP
// para probar que la FRED_API_KEY funciona).
const { ejecutarIndicesInflacion } = require('./lib/indicesInflacion');

exports.handler = async function () {
  const resultado = await ejecutarIndicesInflacion();
  return { statusCode: resultado.ok ? 200 : 500, body: JSON.stringify(resultado) };
};
