// Endpoint sin "schedule" (a propósito) para poder invocar por HTTP y
// probar que los índices de inflación (ARS/USD) se arman bien — sobre
// todo para confirmar que FRED_API_KEY quedó bien cargada en Netlify sin
// tener que esperar al cron mensual. Misma lógica que indices-inflacion.js
// (el wrapper programado), compartida vía lib/indicesInflacion.js.
const { ejecutarIndicesInflacion } = require('./lib/indicesInflacion');

exports.handler = async function () {
  const resultado = await ejecutarIndicesInflacion();
  return { statusCode: resultado.ok ? 200 : 500, body: JSON.stringify(resultado) };
};
