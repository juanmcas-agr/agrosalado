exports.handler = async function() {
  const res = await fetch('https://api.argentinadatos.com/v1/cotizaciones/dolares');
  const data = await res.json();

  const casas = ['oficial', 'blue', 'bolsa', 'mayorista'];
  const resultado = {};
  for (const casa of casas) {
    const registros = data.filter(x => x.casa === casa);
    const d = registros[registros.length - 1]; // el más reciente
    if (d) resultado[casa] = { compra: d.compra, venta: d.venta, fecha: d.fecha };
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(resultado)
  };
};
