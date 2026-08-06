// Cambia la contraseña de un usuario existente desde el panel de
// Configuración de Granos. Mismo esquema de seguridad que
// admin-crear-usuario.js: quien llama tiene que ser owner, verificado
// server-side con su token de sesión, no con el gate del cliente.
//
// Requiere en Netlify: SUPABASE_SERVICE_ROLE_KEY (la misma que usa
// resumen-diario-hacienda.js y admin-crear-usuario.js).

const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';

function headersJson() {
  return { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
}

async function usuarioDelToken(token) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function esOwner(userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/perfiles?user_id=eq.${userId}&select=rol`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
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
    return { statusCode: 403, headers: headersJson(), body: JSON.stringify({ error: 'Solo un owner puede cambiar contraseñas.' }) };
  }

  try {
    const { user_id, password } = JSON.parse(event.body);
    if (!user_id || !password) {
      return { statusCode: 400, headers: headersJson(), body: JSON.stringify({ error: 'Faltan datos: usuario y contraseña nueva son obligatorios.' }) };
    }

    const resCambiar = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
      method: 'PUT',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });
    if (!resCambiar.ok) {
      const detalle = await resCambiar.json().catch(() => ({}));
      return {
        statusCode: 400,
        headers: headersJson(),
        body: JSON.stringify({ error: detalle.msg || detalle.error_description || detalle.error || 'No se pudo cambiar la contraseña.' }),
      };
    }

    return { statusCode: 200, headers: headersJson(), body: JSON.stringify({ ok: true }) };
  } catch (error) {
    return { statusCode: 500, headers: headersJson(), body: JSON.stringify({ error: error.message }) };
  }
};
