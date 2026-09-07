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

  // El precio de cada grano se busca DENTRO de su propia fila <tr>...</tr>,
  // nunca más allá — si un grano no cotiza ese día la pizarra pone "S/C" en
  // vez de un precio, y sin este límite el regex seguía buscando y terminaba
  // agarrando el precio del grano siguiente en la tabla (bug real: Girasol
  // "S/C" devolvía el precio de Trigo).
  for (const [nombre, clave] of Object.entries(filas)) {
    const filaRegex = new RegExp(`<tr>\\s*<td>${nombre}<\\/td>[\\s\\S]*?<\\/tr>`, 'i');
    const fila = html.match(filaRegex);
    if (!fila) continue;
    const precio = fila[0].match(/\$\s*([\d.,]+)/);
    if (precio) {
      granos[clave] = precio[1].replace(/\./g, '').replace(',', '.');
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
