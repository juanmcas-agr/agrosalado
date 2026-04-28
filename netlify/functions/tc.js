exports.handler = async function() {
  const res = await fetch('https://dolarapi.com/v1/ar/dolares');
  const data = await res.json();

  const casas = ['oficial', 'blue', 'bolsa', 'mayorista'];
  const resultado = {};
  for (const casa of casas) {
    const d = data.find(x => x.casa === casa);
    if (d) resultado[casa] = { compra: d.compra, venta: d.venta, fecha: d.fechaActualizacion };
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(resultado)
  };
};
