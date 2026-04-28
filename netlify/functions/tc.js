exports.handler = async function(event) {
  const fecha = event.queryStringParameters && event.queryStringParameters.fecha;
  
  let url = 'https://api.argentinadatos.com/v1/cotizaciones/dolares';
  if (fecha) url += `/${fecha}`; // formato YYYY-MM-DD

  const res = await fetch(url);
  const data = await res.json();

  const casas = ['oficial', 'blue', 'bolsa', 'mayorista'];
  const resultado = {};
  const lista = Array.isArray(data) ? data : [data];

  for (const casa of casas) {
    const registros = lista.filter(x => x.casa === casa);
    const d = registros[registros.length - 1];
    if (d) resultado[casa] = { compra: d.compra, venta: d.venta, fecha: d.fecha };
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(resultado)
  };
};
