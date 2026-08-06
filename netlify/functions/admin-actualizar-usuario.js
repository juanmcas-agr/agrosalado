// Actualiza rol, accesos (Hacienda/Granos) y avisos de un usuario ya
// existente, desde el panel de Configuración de Granos ("Administrar
// usuarios"). Mismo esquema de seguridad que admin-crear-usuario.js:
// quien llama tiene que ser owner, verificado server-side con su token
// de sesión — perfiles solo se puede editar a uno mismo por RLS, así que
// para editar a OTRO usuario hace falta el service role.
//
// Además mantiene sincronizada la tabla destinatarios_negocio (upsert
// por mail) con las casillas de avisos, para que enviar-liquidacion.js
// y resumen-diario-hacienda.js sigan funcionando sin cambios.
//
// Requiere en Netlify: SUPABASE_SERVICE_ROLE_KEY (la misma que las
// otras funciones admin-*.js).

const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';
const ROLES_VALIDOS = ['encargado', 'administrativo', 'owner'];

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

async function esOwner(userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/perfiles?user_id=eq.${userId}&select=rol`, {
    headers: headersSupabase(),
  });
  if (!res.ok) return false;
  const filas = await res.json();
  return filas[0]?.rol === 'owner';
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, headers: headersJson(), body: JSON.stringify({ error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Netlify.' }) };
  }

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /i, '');
  if (!token) {
    return { statusCode: 401, headers: headersJson(), body: JSON.stringify({ error: 'Falta autenticación.' }) };
  }

  const usuario = await usuarioDelToken(token);
  if (!usuario || !usuario.id) {
    return { statusCode: 401, headers: headersJson(), body: JSON.stringify({ error: 'Sesión inválida o vencida.' }) };
  }
  if (!(await esOwner(usuario.id))) {
    return { statusCode: 403, headers: headersJson(), body: JSON.stringify({ error: 'Solo un owner puede editar usuarios.' }) };
  }

  try {
    const {
      user_id, nombre_completo, email, rol,
      acceso_hacienda, acceso_granos, recibe_liquidaciones, recibe_hacienda,
    } = JSON.parse(event.body);

    if (!user_id || !nombre_completo || !email || !rol) {
      return { statusCode: 400, headers: headersJson(), body: JSON.stringify({ error: 'Faltan datos: usuario, nombre, email y rol son obligatorios.' }) };
    }
    if (!ROLES_VALIDOS.includes(rol)) {
      return { statusCode: 400, headers: headersJson(), body: JSON.stringify({ error: 'Rol inválido.' }) };
    }

    const resUpdate = await fetch(`${SUPABASE_URL}/rest/v1/perfiles?user_id=eq.${user_id}`, {
      method: 'PATCH',
      headers: headersSupabase({ Prefer: 'return=representation' }),
      body: JSON.stringify({
        nombre_completo,
        email,
        rol,
        acceso_hacienda: !!acceso_hacienda,
        acceso_granos: !!acceso_granos,
      }),
    });
    if (!resUpdate.ok) {
      const detalle = await resUpdate.text();
      return { statusCode: 500, headers: headersJson(), body: JSON.stringify({ error: `No se pudo actualizar el perfil: ${detalle}` }) };
    }
    const filasPerfil = await resUpdate.json();
    if (!filasPerfil.length) {
      return { statusCode: 404, headers: headersJson(), body: JSON.stringify({ error: 'No se encontró ese usuario.' }) };
    }

    // Upsert manual en destinatarios_negocio (el índice único es por
    // lower(email), una expresión — el upsert nativo de PostgREST no lo
    // soporta, así que se busca primero y se decide insert/update).
    const buscarRes = await fetch(
      `${SUPABASE_URL}/rest/v1/destinatarios_negocio?email=ilike.${encodeURIComponent(email)}&select=id`,
      { headers: headersSupabase() }
    );
    const existentes = buscarRes.ok ? await buscarRes.json() : [];

    if (existentes.length) {
      await fetch(`${SUPABASE_URL}/rest/v1/destinatarios_negocio?id=eq.${existentes[0].id}`, {
        method: 'PATCH',
        headers: headersSupabase(),
        body: JSON.stringify({
          nombre: nombre_completo,
          recibe_liquidaciones: !!recibe_liquidaciones,
          recibe_hacienda: !!recibe_hacienda,
        }),
      });
    } else if (recibe_liquidaciones || recibe_hacienda) {
      await fetch(`${SUPABASE_URL}/rest/v1/destinatarios_negocio`, {
        method: 'POST',
        headers: headersSupabase(),
        body: JSON.stringify({
          email,
          nombre: nombre_completo,
          recibe_liquidaciones: !!recibe_liquidaciones,
          recibe_hacienda: !!recibe_hacienda,
        }),
      });
    }

    return { statusCode: 200, headers: headersJson(), body: JSON.stringify({ ok: true, perfil: filasPerfil[0] }) };
  } catch (error) {
    return { statusCode: 500, headers: headersJson(), body: JSON.stringify({ error: error.message }) };
  }
};
