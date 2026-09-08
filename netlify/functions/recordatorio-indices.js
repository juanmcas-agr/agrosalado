// Recordatorio de Índices reproductivos pendientes (M11 del plan de
// Reportes/Índices): corre solo, una vez por día a las 08:00 hora
// Argentina, vía Netlify Scheduled Functions (ver el cron en
// netlify.toml). Separado del resumen de las 23:30 (resumen-diario-
// hacienda.js) a propósito: ese es un cierre del día, este tiene que
// avisar temprano el día del gatillo para que haya tiempo de actuar.
// Solo manda mail si hay algo pendiente — no es un digest diario.
//
// Misma lógica de "doble condición" y "año relevante" que
// stock/js/indices.js (el cartel en la app) — duplicada acá a propósito,
// mismo criterio que rangoDeHoyArt() en resumen-diario-hacienda.js: cada
// runtime tiene su propio módulo, se copia tal cual en vez de compartir
// import, para que cliente y servidor nunca puedan discrepar por un
// import roto o una versión vieja cacheada.
//
// Requiere en Netlify (Site settings > Environment variables):
//   RESEND_API_KEY            — igual que resumen-diario-hacienda.js
//   SUPABASE_SERVICE_ROLE_KEY — idem
// Opcional:
//   RESEND_FROM        — remitente; por defecto onboarding@resend.dev
//   RESEND_TO_HACIENDA — override manual, separados por coma, para pruebas;
//                        si no está seteada, los destinatarios salen de
//                        destinatarios_negocio (recibe_hacienda=true),
//                        mismo criterio que el resumen diario.

const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';

const DESTINATARIOS_DEFAULT = ['juanmanueluranga@gmail.com'];

// Espejo de stock/js/indicesConfig.js (solo lo que hace falta acá: id,
// nombre y fecha gatillo anual).
const INDICES = [
  { tipo: 'vacas_servicio', nombre: 'Vacas en servicio', mes: 10, dia: 1 },
  { tipo: 'vacas_prenadas', nombre: 'Vacas preñadas (tacto)', mes: 3, dia: 1 },
  { tipo: 'paricion_control_1', nombre: 'Parición — primer control (1/8)', mes: 8, dia: 1 },
  { tipo: 'paricion_control_2', nombre: 'Parición — segundo control (1/9)', mes: 9, dia: 1 },
  { tipo: 'paricion_control_3', nombre: 'Parición — cierre (1/10)', mes: 10, dia: 1 },
  { tipo: 'destete', nombre: 'Destete', mes: 3, dia: 1 },
];

function fechaGatilloDelAnio(indice, anio) {
  return `${anio}-${String(indice.mes).padStart(2, '0')}-${String(indice.dia).padStart(2, '0')}`;
}

// Mismo cálculo de "hoy" ART que rangoDeHoyArt() — copiado tal cual (ver
// nota arriba).
function hoyArtISO() {
  const ahoraArt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return ahoraArt.toISOString().slice(0, 10);
}

// Antes del gatillo de este año se evalúa contra el del año pasado (ya
// resuelto de su propio ciclo, no molesta antes de tiempo); desde el
// gatillo de este año (inclusive) pasa a evaluarse contra el de este año.
function anioRelevante(indice, hoyIso) {
  const anioActual = Number(hoyIso.slice(0, 4));
  return hoyIso >= fechaGatilloDelAnio(indice, anioActual) ? anioActual : anioActual - 1;
}

// Pendiente si no está corroborado, o si hoy es justo el día del gatillo
// y la corroboración que tiene es de antes de hoy (fuerza reconfirmar el
// mismo día aunque ya se hubiera cargado de antemano).
function estaPendiente(indice, anio, hoyIso, fila) {
  const gatillo = fechaGatilloDelAnio(indice, anio);
  if (!fila || !fila.corroborado) return true;
  if (hoyIso !== gatillo) return false;
  const corroboradoIso = fila.corroborado_at ? fila.corroborado_at.slice(0, 10) : null;
  return !corroboradoIso || corroboradoIso < gatillo;
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

exports.handler = async function () {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltan variables de entorno para el recordatorio de índices.');
    return { statusCode: 500, body: 'Faltan variables de entorno.' };
  }

  const hoyIso = hoyArtISO();
  const anios = INDICES.map((indice) => anioRelevante(indice, hoyIso));
  const anioMin = Math.min(...anios);
  const anioMax = Math.max(...anios);

  const filas = await consultarSupabase(
    `indices_valores?anio=gte.${anioMin}&anio=lte.${anioMax}&select=tipo_indice,anio,corroborado,corroborado_at`,
  );
  const porTipoAnio = {};
  for (const fila of filas) porTipoAnio[`${fila.tipo_indice}_${fila.anio}`] = fila;

  const pendientes = INDICES
    .map((indice) => ({ indice, anio: anioRelevante(indice, hoyIso) }))
    .filter(({ indice, anio }) => estaPendiente(indice, anio, hoyIso, porTipoAnio[`${indice.tipo}_${anio}`]));

  if (!pendientes.length) {
    return { statusCode: 200, body: 'Sin índices pendientes hoy, no se manda mail.' };
  }

  const partes = [
    `<p><strong>Hacienda — índices reproductivos pendientes (${hoyIso}):</strong></p>`,
    '<ul>',
    ...pendientes.map(({ indice, anio }) => `<li>${indice.nombre} — temporada ${anio}</li>`),
    '</ul>',
    '<p>Cargalos o corroboralos desde Reportes &gt; Índices en la app de Hacienda.</p>',
  ];

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
      subject: 'HACIENDA: ÍNDICES PENDIENTES',
      html: partes.join(''),
    }),
  });

  if (!res.ok) {
    const detalle = await res.text();
    console.error('Resend rechazó el recordatorio de índices:', detalle);
    return { statusCode: 502, body: detalle };
  }

  return { statusCode: 200, body: 'ok' };
};
