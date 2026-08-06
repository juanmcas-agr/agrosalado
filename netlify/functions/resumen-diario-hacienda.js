// Resumen diario de novedades de Hacienda (movimientos cargados y
// anulados en el día): corre solo, una vez por día a las 23:30 hora
// Argentina, vía Netlify Scheduled Functions (ver el cron en netlify.toml).
// No se dispara por cada carga/anulación individual — junta todo el día
// en un solo mail para no saturar de avisos.
//
// Requiere en Netlify (Site settings > Environment variables):
//   RESEND_API_KEY            — igual que enviar-liquidacion.js
//   SUPABASE_SERVICE_ROLE_KEY — Project Settings > API > service_role key
//                                en Supabase (NO la anon key: acá hace
//                                falta saltear RLS porque no hay un
//                                usuario logueado, es un job de servidor).
// Opcional:
//   RESEND_FROM        — remitente; por defecto onboarding@resend.dev
//   RESEND_TO_HACIENDA — override manual, separados por coma, para pruebas;
//                        si no está seteada, los destinatarios salen de
//                        destinatarios_negocio (tabla compartida con Granos,
//                        administrada desde Configuración > Destinatarios
//                        de avisos > tildar "Movimientos de Hacienda").

// Pública (la misma que stock/js/config.js): no es un secreto, es la URL
// del proyecto de Supabase, no la clave.
const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';

const DESTINATARIOS_DEFAULT = ['juanmanueluranga@gmail.com'];

async function obtenerDestinatarios() {
  if (process.env.RESEND_TO_HACIENDA) {
    return process.env.RESEND_TO_HACIENDA.split(',').map((m) => m.trim()).filter(Boolean);
  }
  try {
    const filas = await consultarSupabase('destinatarios_negocio?recibe_hacienda=eq.true&select=email');
    const emails = filas.map((f) => f.email).filter(Boolean);
    if (emails.length) return emails;
  } catch (error) {
    console.error('No se pudo leer destinatarios_negocio, uso la lista de respaldo:', error);
  }
  return DESTINATARIOS_DEFAULT;
}

function rangoDeHoyArt() {
  // Corre ~23:30 ART = ~02:30 UTC del día siguiente; restamos 3hs para
  // saber a qué fecha ART corresponde el momento en que se dispara.
  const ahoraArt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const fecha = ahoraArt.toISOString().slice(0, 10);
  return {
    fecha,
    desde: `${fecha}T00:00:00-03:00`,
    hasta: `${fecha}T23:59:59.999-03:00`,
  };
}

async function consultarSupabase(path) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase respondió ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function describirMovimiento(m) {
  const origen = m.establecimiento_origen_nombre
    ? `${m.establecimiento_origen_nombre} (${m.categoria_origen_nombre})`
    : null;
  const destino = m.establecimiento_destino_nombre
    ? `${m.establecimiento_destino_nombre} (${m.categoria_destino_nombre})`
    : null;
  const recorrido = [origen, destino].filter(Boolean).join(' → ');
  const titular = m.titular_origen_nombre || m.titular_destino_nombre;
  return [
    `${m.tipo_movimiento_nombre} — ${recorrido}`,
    `${m.cantidad_cabezas} cab. (${m.kilos_promedio} kg prom.)`,
    titular ? `titular: ${titular}` : null,
    m.rodeo ? `rodeo: ${m.rodeo}` : null,
  ].filter(Boolean).join(' — ');
}

exports.handler = async function () {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltan variables de entorno para el resumen diario de Hacienda.');
    return { statusCode: 500, body: 'Faltan variables de entorno.' };
  }

  const { fecha, desde, hasta } = rangoDeHoyArt();
  const d = encodeURIComponent(desde);
  const h = encodeURIComponent(hasta);

  const [cargados, anulados] = await Promise.all([
    consultarSupabase(`historial_movimientos?created_at=gte.${d}&created_at=lte.${h}&order=created_at.asc`),
    consultarSupabase(`historial_movimientos?anulado=eq.true&anulado_at=gte.${d}&anulado_at=lte.${h}&order=anulado_at.asc`),
  ]);

  if (!cargados.length && !anulados.length) {
    return { statusCode: 200, body: 'Sin novedades hoy, no se manda mail.' };
  }

  // anulado_por es un uuid en la vista (no viene con el nombre resuelto);
  // lo buscamos aparte para poder mostrar quién anuló cada uno.
  let nombresPorId = {};
  const idsAnuladores = [...new Set(anulados.map((m) => m.anulado_por).filter(Boolean))];
  if (idsAnuladores.length) {
    const filtro = idsAnuladores.map((id) => `"${id}"`).join(',');
    const perfiles = await consultarSupabase(`perfiles?user_id=in.(${filtro})&select=user_id,nombre_completo`);
    nombresPorId = Object.fromEntries(perfiles.map((p) => [p.user_id, p.nombre_completo]));
  }

  const partes = [`<p><strong>Novedades de Hacienda — ${fecha}</strong></p>`];

  if (cargados.length) {
    partes.push(`<p><strong>Movimientos cargados (${cargados.length}):</strong></p><ul>`);
    for (const m of cargados) {
      partes.push(`<li>${describirMovimiento(m)} — cargado por ${m.usuario_nombre || '-'}</li>`);
    }
    partes.push('</ul>');
  }

  if (anulados.length) {
    partes.push(`<p><strong>Movimientos anulados (${anulados.length}):</strong></p><ul>`);
    for (const m of anulados) {
      const anuladoPor = nombresPorId[m.anulado_por] || '-';
      partes.push(`<li>${describirMovimiento(m)} — anulado por ${anuladoPor} (motivo: ${m.anulado_motivo || 'sin motivo'})</li>`);
    }
    partes.push('</ul>');
  }

  const remitente = process.env.RESEND_FROM || 'AGROSALADO <onboarding@resend.dev>';
  const destinatarios = await obtenerDestinatarios();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: remitente,
      to: destinatarios,
      subject: `Novedades de Hacienda — ${fecha}`,
      html: partes.join(''),
    }),
  });

  if (!res.ok) {
    const detalle = await res.text();
    console.error('Resend rechazó el resumen diario de Hacienda:', detalle);
    return { statusCode: 502, body: detalle };
  }

  return { statusCode: 200, body: 'ok' };
};
