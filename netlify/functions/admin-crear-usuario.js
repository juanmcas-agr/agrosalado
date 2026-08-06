// Crea un usuario nuevo (Auth + fila en perfiles) desde el panel de
// Configuración de Granos. Quien llama tiene que ser owner — se verifica
// acá, server-side, con su token de sesión; el gate del cliente no
// alcanza porque este endpoint queda expuesto igual. Usa el service role
// (bypassa RLS) porque perfiles no tiene policy de insert para clientes
// normales, a propósito: crear usuarios siempre fue una operación manual.
//
// Requiere en Netlify: SUPABASE_SERVICE_ROLE_KEY (la misma que usa
// resumen-diario-hacienda.js).

const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';
const ROLES_VALIDOS = ['encargado', 'administrativo', 'owner'];

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
    return { statusCode: 403, headers: headersJson(), body: JSON.stringify({ error: 'Solo un owner puede crear usuarios.' }) };
  }

  try {
    const { email, password, nombre_completo, rol } = JSON.parse(event.body);
    if (!email || !password || !nombre_completo || !rol) {
      return { statusCode: 400, headers: headersJson(), body: JSON.stringify({ error: 'Faltan datos: email, contraseña, nombre y rol son obligatorios.' }) };
    }
    if (!ROLES_VALIDOS.includes(rol)) {
      return { statusCode: 400, headers: headersJson(), body: JSON.stringify({ error: 'Rol inválido.' }) };
    }

    const resCrear = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const datosCrear = await resCrear.json();
    if (!resCrear.ok) {
      return {
        statusCode: 400,
        headers: headersJson(),
        body: JSON.stringify({ error: datosCrear.msg || datosCrear.error_description || datosCrear.error || 'No se pudo crear el usuario.' }),
      };
    }

    const resPerfil = await fetch(`${SUPABASE_URL}/rest/v1/perfiles`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ user_id: datosCrear.id, nombre_completo, rol }),
    });
    if (!resPerfil.ok) {
      const detalle = await resPerfil.text();
      return {
        statusCode: 500,
        headers: headersJson(),
        body: JSON.stringify({ error: `El usuario se creó pero no se pudo guardar su perfil: ${detalle}` }),
      };
    }

    return { statusCode: 200, headers: headersJson(), body: JSON.stringify({ ok: true, user_id: datosCrear.id }) };
  } catch (error) {
    return { statusCode: 500, headers: headersJson(), body: JSON.stringify({ error: error.message }) };
  }
};
