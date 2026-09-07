// Endpoint sin "schedule" (a propósito) para poder invocar por HTTP y
// probar el recordatorio semanal sin esperar al viernes — misma lógica
// que recordatorio-semanal-precios.js (el wrapper programado), compartida
// vía lib/recordatorioSemanal.js. Ojo: si de verdad falta algún producto
// por confirmar, esto MANDA EL MAIL real (no es un simulacro).
const { ejecutarRecordatorioSemanal } = require('./lib/recordatorioSemanal');

exports.handler = async function () {
  const resultado = await ejecutarRecordatorioSemanal();
  return { statusCode: resultado.ok ? 200 : 500, body: JSON.stringify(resultado) };
};
