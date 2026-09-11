// Crea un transportista nuevo (Auth + fila en transportistas) desde el
// panel de Logística. Mismo esquema de seguridad que admin-crear-
// usuario.js: quien llama tiene que ser owner, verificado server-side con
// su token de sesión — transportistas no tiene policy de insert para
// clientes normales, a propósito (mismo criterio que perfiles: el alta
// siempre es una operación manual).
//
// Requiere en Netlify: SUPABASE_SERVICE_ROLE_KEY (la misma que usan las
// otras funciones admin-*.js).

const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';
const CATEGORIAS_VALIDAS = ['propio', 'externo'];

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
    return { statusCode: 403, headers: headersJson(), body: JSON.stringify({ error: 'Solo un owner puede crear transportistas.' }) };
  }

  try {
    const { email, password, nombre_completo, telefono, empresa, cuit, categoria } = JSON.parse(event.body);
    if (!email || !password || !nombre_completo || !categoria) {
      return { statusCode: 400, headers: headersJson(), body: JSON.stringify({ error: 'Faltan datos: email, contraseña, nombre y categoría son obligatorios.' }) };
    }
    if (!CATEGORIAS_VALIDAS.includes(categoria)) {
      return { statusCode: 400, headers: headersJson(), body: JSON.stringify({ error: 'Categoría inválida.' }) };
    }

    const resCrear = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: headersSupabase(),
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

    const resTransportista = await fetch(`${SUPABASE_URL}/rest/v1/transportistas`, {
      method: 'POST',
      headers: headersSupabase({ Prefer: 'return=minimal' }),
      body: JSON.stringify({
        user_id: datosCrear.id,
        nombre_completo,
        email,
        telefono: telefono || null,
        empresa: empresa || null,
        cuit: cuit || null,
        categoria,
      }),
    });
    if (!resTransportista.ok) {
      const detalle = await resTransportista.text();
      return {
        statusCode: 500,
        headers: headersJson(),
        body: JSON.stringify({ error: `El usuario se creó pero no se pudo guardar el transportista: ${detalle}` }),
      };
    }

    return { statusCode: 200, headers: headersJson(), body: JSON.stringify({ ok: true, user_id: datosCrear.id }) };
  } catch (error) {
    return { statusCode: 500, headers: headersJson(), body: JSON.stringify({ error: error.message }) };
  }
};
