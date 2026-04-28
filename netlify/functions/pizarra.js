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

// Buscar todas las fechas y tomar la más reciente (año 2024+)
const todasFechas = [...html.matchAll(/(\d{2}\/\d{2}\/20\d{2})/g)].map(m => m[1]);
const fecha = todasFechas.find(f => parseInt(f.split('/')[2]) >= 2024) || '';

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ granos, fecha, fuente: 'Bolsa de Comercio de Rosario' })
  };
};
