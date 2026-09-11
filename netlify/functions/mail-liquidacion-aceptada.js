// Acepta una liquidación de transporte: genera el código correlativo,
// marca la liquidación como aceptada, y manda el mail al transportista
// avisándole que ya puede facturar. Todo server-side en un mismo lugar
// (no en dos pasos desde el cliente) para que nunca quede un código
// "huérfano" por un fallo a mitad de camino — si esto falla, no se
// generó código ni se marcó nada.
//
// Quien llama tiene que ser administrativo u owner (mismo criterio que
// la política RLS liquidaciones_transporte_update) — se verifica acá,
// server-side, con el token de sesión.
//
// Requiere en Netlify: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.
// Opcional: RESEND_FROM (remitente; por defecto onboarding@resend.dev).

const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';

function headersJson() {
  return { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
}

function headersSupabase(extra) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function usuarioDelToken(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function puedeAceptar(userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/perfiles?user_id=eq.${userId}&select=rol`, { headers: headersSupabase() });
  if (!res.ok) return false;
  const filas = await res.json();
  return ['administrativo', 'owner'].includes(filas[0]?.rol);
}

function describirViaje(v) {
  return `${v.codigo} — ${v.fecha_carga} — ${v.origen} → ${v.destino} — ${v.mercaderia} — ${v.km ?? '-'} km, ${v.tn ?? '-'} tn`;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.RESEND_API_KEY) {
    return { statusCode: 500, headers: headersJson(), body: JSON.stringify({ error: 'Faltan variables de entorno.' }) };
  }

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /i, '');
  if (!token) {
    return { statusCode: 401, headers: headersJson(), body: JSON.stringify({ error: 'Falta autenticación.' }) };
  }
  const usuario = await usuarioDelToken(token);
  if (!usuario || !usuario.id) {
    return { statusCode: 401, headers: headersJson(), body: JSON.stringify({ error: 'Sesión inválida o vencida.' }) };
  }
  if (!(await puedeAceptar(usuario.id))) {
    return { statusCode: 403, headers: headersJson(), body: JSON.stringify({ error: 'Solo administración puede aceptar liquidaciones.' }) };
  }

  try {
    const { liquidacion_id } = JSON.parse(event.body);
    if (!liquidacion_id) {
      return { statusCode: 400, headers: headersJson(), body: JSON.stringify({ error: 'Falta liquidacion_id.' }) };
    }

    const resLiq = await fetch(
      `${SUPABASE_URL}/rest/v1/liquidaciones_transporte_detalle?id=eq.${liquidacion_id}&select=*`,
      { headers: headersSupabase() },
    );
    const liquidacion = (await resLiq.json())[0];
    if (!liquidacion) {
      return { statusCode: 404, headers: headersJson(), body: JSON.stringify({ error: 'No se encontró la liquidación.' }) };
    }
    if (liquidacion.estado !== 'pendiente') {
      return { statusCode: 400, headers: headersJson(), body: JSON.stringify({ error: `Esta liquidación ya está "${liquidacion.estado}", no se puede volver a aceptar.` }) };
    }

    // Código correlativo — se genera acá, recién al aceptar (antes no hay
    // nada que facturar todavía).
    const resCodigo = await fetch(`${SUPABASE_URL}/rest/v1/rpc/siguiente_codigo`, {
      method: 'POST',
      headers: headersSupabase(),
      body: JSON.stringify({ p_tipo: 'liquidacion_transporte', p_prefijo: 'LT' }),
    });
    if (!resCodigo.ok) {
      const detalle = await resCodigo.text();
      return { statusCode: 500, headers: headersJson(), body: JSON.stringify({ error: `No se pudo generar el código: ${detalle}` }) };
    }
    const codigo = await resCodigo.json();

    const resUpdate = await fetch(`${SUPABASE_URL}/rest/v1/liquidaciones_transporte?id=eq.${liquidacion_id}`, {
      method: 'PATCH',
      headers: headersSupabase(),
      body: JSON.stringify({
        estado: 'aceptada',
        codigo,
        resuelto_por: usuario.id,
        resuelto_at: new Date().toISOString(),
      }),
    });
    if (!resUpdate.ok) {
      const detalle = await resUpdate.text();
      return { statusCode: 500, headers: headersJson(), body: JSON.stringify({ error: `No se pudo actualizar la liquidación: ${detalle}` }) };
    }

    const resViajes = await fetch(
      `${SUPABASE_URL}/rest/v1/viajes_detalle?liquidacion_id=eq.${liquidacion_id}&select=codigo,fecha_carga,origen,destino,mercaderia,km,tn&order=fecha_carga.asc`,
      { headers: headersSupabase() },
    );
    const viajes = resViajes.ok ? await resViajes.json() : [];

    const partes = [
      `<p><strong>Liquidación ${codigo} aceptada</strong></p>`,
      `<p>Ya podés facturar los siguientes viajes — citá el código <strong>${codigo}</strong> en la leyenda de la factura:</p>`,
      '<ul>',
      ...viajes.map((v) => `<li>${describirViaje(v)}</li>`),
      '</ul>',
      `<p>Total: ${liquidacion.cantidad_viajes} viaje(s), ${liquidacion.total_tn} tn, ${liquidacion.total_km} km.</p>`,
    ];

    const remitente = process.env.RESEND_FROM || 'AGROSALADO <onboarding@resend.dev>';
    const resMail = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: remitente,
        to: [liquidacion.transportista_email],
        subject: `LOGÍSTICA: liquidación ${codigo} aprobada — ya podés facturar`,
        html: partes.join(''),
      }),
    });
    if (!resMail.ok) {
      const detalle = await resMail.text();
      // La liquidación ya quedó aceptada con su código — el mail es best
      // effort, no se revierte nada si Resend falla (evita duplicar
      // códigos por un reintento).
      console.error('Liquidación aceptada, pero el mail falló:', detalle);
      return { statusCode: 200, headers: headersJson(), body: JSON.stringify({ ok: true, codigo, mail_error: detalle }) };
    }

    return { statusCode: 200, headers: headersJson(), body: JSON.stringify({ ok: true, codigo }) };
  } catch (error) {
    return { statusCode: 500, headers: headersJson(), body: JSON.stringify({ error: error.message }) };
  }
};
