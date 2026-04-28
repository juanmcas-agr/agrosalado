const https = require('https');

exports.handler = async function() {
  const url = 'https://www.bcr.com.ar/es/mercados/mercado-de-granos/cotizaciones/cotizaciones-locales-0';

  const html = await new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });

  const granos = {};
  const filas = { Soja: 'soja', 'Maíz': 'maiz', Trigo: 'trigo', Girasol: 'girasol', Sorgo: 'sorgo' };

  for (const [nombre, clave] of Object.entries(filas)) {
    const regex = new RegExp(`${nombre}[^$]*\\$\\s*([\\d.,]+)`, 'i');
    const match = html.match(regex);
    if (match) {
      granos[clave] = match[1].replace(/\./g, '').replace(',', '.');
    }
  }

  const fechaMatch = html.match(/(\d{2}\/\d{2}\/\d{4})/);
  const fecha = fechaMatch ? fechaMatch[1] : '';

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ granos, fecha, fuente: 'BCR Cámara Arbitral' })
  };
};
