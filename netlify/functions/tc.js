const https = require('https');

exports.handler = async function() {
  const url = 'https://dolarapi.com/v1/ar/dolares';

  const data = await new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });

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
