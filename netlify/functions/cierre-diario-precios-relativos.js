// Wrapper programado: corre solo, una vez por día, vía Netlify Scheduled
// Functions (ver el cron en netlify.toml). IMPORTANTE: una vez que un
// archivo tiene "schedule" en netlify.toml, Netlify bloquea con 403
// cualquier invocación pública por HTTP directa — no se puede probar
// visitando esta URL a mano. La lógica real vive en lib/cierreDiario.js,
// compartida con actualizar-precios-relativos.js (SIN schedule, ese sí
// invocable por HTTP — lo usa el botón "🔄 Actualizar ahora" de $Rel).
const { ejecutarCierreDiario } = require('./lib/cierreDiario');

exports.handler = async function () {
  const resultado = await ejecutarCierreDiario();
  return { statusCode: resultado.ok ? 200 : 500, body: JSON.stringify(resultado) };
};
