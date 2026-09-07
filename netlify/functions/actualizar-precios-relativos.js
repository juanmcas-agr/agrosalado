// Dispara manualmente el mismo trabajo que corren de noche los scrapers y
// el snapshot diario de $Rel — lo usa el botón "🔄 Actualizar ahora" de
// rel/js/matriz.js. A propósito NO tiene "schedule" en netlify.toml, así
// que Netlify lo deja invocar por HTTP público sin problema (a diferencia
// de cierre-diario-precios-relativos.js / scraper-*.js, que sí lo tienen y
// por eso Netlify les bloquea con 403 cualquier invocación directa). La
// lógica real de cada uno vive en netlify/functions/lib/*.js, compartida
// entre ambos caminos.

const { ejecutarCierreDiario } = require('./lib/cierreDiario');
const { ejecutarGasoil } = require('./lib/gasoil');
const { ejecutarNovillo } = require('./lib/novillo');
const { ejecutarInvernada } = require('./lib/invernada');

exports.handler = async function () {
  const [cierreDiario, gasoil, novillo, invernada] = await Promise.all([
    ejecutarCierreDiario(),
    ejecutarGasoil(),
    ejecutarNovillo(),
    ejecutarInvernada(),
  ]);

  return {
    statusCode: 200,
    body: JSON.stringify({ cierreDiario, gasoil, novillo, invernada }),
  };
};
