// Actualiza nombre/contacto/categoría/activo de un transportista ya
// existente, desde el panel de Logística. Mismo esquema de seguridad que
// admin-actualizar-usuario.js: quien llama tiene que ser owner, verificado
// server-side — transportistas no tiene policy de update para clientes
// normales, así que editar a otro requiere el service role.
//
// Requiere en Netlify: SUPABASE_SERVICE_ROLE_KEY (la misma que las otras
// funciones admin-*.js).

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
    return { statusCode: 403, headers: headersJson(), body: JSON.stringify({ error: 'Solo un owner puede editar transportistas.' }) };
  }

  try {
    const { user_id, nombre_completo, email, telefono, empresa, cuit, categoria, activo } = JSON.parse(event.body);

    if (!user_id || !nombre_completo || !email || !categoria) {
      return { statusCode: 400, headers: headersJson(), body: JSON.stringify({ error: 'Faltan datos: usuario, nombre, email y categoría son obligatorios.' }) };
    }
    if (!CATEGORIAS_VALIDAS.includes(categoria)) {
      return { statusCode: 400, headers: headersJson(), body: JSON.stringify({ error: 'Categoría inválida.' }) };
    }

    const resUpdate = await fetch(`${SUPABASE_URL}/rest/v1/transportistas?user_id=eq.${user_id}`, {
      method: 'PATCH',
      headers: headersSupabase({ Prefer: 'return=representation' }),
      body: JSON.stringify({
        nombre_completo,
        email,
        telefono: telefono || null,
        empresa: empresa || null,
        cuit: cuit || null,
        categoria,
        activo: activo !== false,
      }),
    });
    if (!resUpdate.ok) {
      const detalle = await resUpdate.text();
      return { statusCode: 500, headers: headersJson(), body: JSON.stringify({ error: `No se pudo actualizar el transportista: ${detalle}` }) };
    }
    const filas = await resUpdate.json();
    if (!filas.length) {
      return { statusCode: 404, headers: headersJson(), body: JSON.stringify({ error: 'No se encontró ese transportista.' }) };
    }

    return { statusCode: 200, headers: headersJson(), body: JSON.stringify({ ok: true, transportista: filas[0] }) };
  } catch (error) {
    return { statusCode: 500, headers: headersJson(), body: JSON.stringify({ error: error.message }) };
  }
};
