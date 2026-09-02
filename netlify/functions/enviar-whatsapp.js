// Manda por WhatsApp (vía Twilio) un resumen del negocio recién cerrado
// en Granos, a los destinatarios que tengan tildado "Recibe WhatsApp de
// negocio cerrado" en Configuración > Administrar usuarios (con teléfono
// cargado). El texto lo arma el cliente (index.html); esta función solo
// lo reenvía, número por número (la API de Twilio no soporta envío
// masivo en una sola llamada).
//
// Requiere en Netlify: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
// TWILIO_WHATSAPP_FROM (el remitente habilitado en Twilio, con el
// prefijo "whatsapp:", ej. "whatsapp:+14155238886" para el sandbox).
//
// Mientras se prueba con el sandbox de Twilio, cada número destino tiene
// que haberse unido mandando el código de "join" al número de sandbox.
// Para pruebas de punta a punta a un solo número fijo (sin depender de
// los destinatarios reales todavía cargados), se puede setear
// TWILIO_WHATSAPP_TO (uno o varios números separados por coma).

function headersJson() {
  return { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const remitente = process.env.TWILIO_WHATSAPP_FROM;
  if (!accountSid || !authToken || !remitente) {
    return {
      statusCode: 500,
      headers: headersJson(),
      body: JSON.stringify({ error: 'Falta configurar TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN o TWILIO_WHATSAPP_FROM en Netlify.' }),
    };
  }

  try {
    const { mensaje, destinatarios } = JSON.parse(event.body);
    if (!mensaje) {
      return { statusCode: 400, headers: headersJson(), body: JSON.stringify({ error: 'Falta el mensaje.' }) };
    }

    const numeros = process.env.TWILIO_WHATSAPP_TO
      ? process.env.TWILIO_WHATSAPP_TO.split(',').map((n) => n.trim()).filter(Boolean)
      : (Array.isArray(destinatarios) ? destinatarios.filter(Boolean) : []);

    if (!numeros.length) {
      // No es un error: puede que nadie tenga tildado "Recibe WhatsApp".
      return { statusCode: 200, headers: headersJson(), body: JSON.stringify({ ok: true, enviados: 0 }) };
    }

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const resultados = await Promise.all(
      numeros.map(async (numero) => {
        const body = new URLSearchParams({
          From: remitente,
          To: numero.startsWith('whatsapp:') ? numero : `whatsapp:${numero}`,
          Body: mensaje,
        });
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });
        if (res.ok) return { numero, ok: true };
        const detalle = await res.text();
        return { numero, ok: false, error: detalle };
      })
    );

    const fallidos = resultados.filter((r) => !r.ok);
    return {
      statusCode: 200,
      headers: headersJson(),
      body: JSON.stringify({ ok: true, enviados: resultados.length - fallidos.length, fallidos }),
    };
  } catch (error) {
    return { statusCode: 500, headers: headersJson(), body: JSON.stringify({ error: error.message }) };
  }
};
