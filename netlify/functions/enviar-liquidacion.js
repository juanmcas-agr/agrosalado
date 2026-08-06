// Envía mails de liquidación (nueva orden) y anulación de negocios
// cerrados en la app Granos. El asunto y el cuerpo los arma el cliente
// (index.html); esta función solo los reenvía por Resend, con la
// captura de la tabla adjunta cuando corresponde.
// Requiere la variable de entorno RESEND_API_KEY (Netlify > Site settings
// > Environment variables) y un remitente en un dominio verificado en
// https://resend.com/domains — mientras no esté verificado, usar
// 'onboarding@resend.dev' como remitente para pruebas.
//
// Con onboarding@resend.dev (sin dominio verificado), Resend solo entrega
// al mail con el que te registraste en Resend. Para probar de punta a
// punta mientras el dominio verifica, se puede setear RESEND_TO (uno o
// varios mails separados por coma) apuntando a ese mail; sin esa variable
// se usan los destinatarios reales del negocio.

const DESTINATARIOS_DEFAULT = [
  'braian.papastabru@agrosalado.com',
  'facturacion@agrosalado.com',
  'juan.uranga@agrosalado.com',
];

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Falta configurar RESEND_API_KEY en Netlify.' }),
    };
  }

  try {
    const { imagenBase64, subject, mensajeHtml, destinatariosCliente } = JSON.parse(event.body);
    if (!subject || !mensajeHtml) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta el asunto o el cuerpo del mail.' }) };
    }

    const remitente = process.env.RESEND_FROM || 'AGROSALADO <onboarding@resend.dev>';
    const destinatarios = process.env.RESEND_TO
      ? process.env.RESEND_TO.split(',').map((m) => m.trim()).filter(Boolean)
      : DESTINATARIOS_DEFAULT;

    const payload = {
      from: remitente,
      to: destinatarios,
      subject,
      html: mensajeHtml,
    };
    // El cliente va en bcc (no en to/cc) para que no vea las direcciones
    // internas del negocio. Nota: mientras el dominio de Resend no esté
    // verificado, esto igual va a fallar salvo que el bcc sea el mail con
    // el que te registraste en Resend — misma limitación que ya conocemos.
    if (Array.isArray(destinatariosCliente) && destinatariosCliente.length) {
      payload.bcc = destinatariosCliente.filter(Boolean);
    }
    if (imagenBase64) {
      payload.attachments = [{ filename: 'negocio.png', content: imagenBase64 }];
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const detalle = await res.text();
      return {
        statusCode: 502,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: `Resend rechazó el envío: ${detalle}` }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
