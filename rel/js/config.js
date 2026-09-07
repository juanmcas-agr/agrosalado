// La versión mostrada en pantalla es compartida con Granos/Hacienda vía
// /version.json en la raíz del sitio (ver app.js).

// Mismo proyecto Supabase que Granos y Hacienda (backend compartido).
export const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_I9x0D8vsS_XvDW0lrUy5fQ_DEIJpDK6';

// Espejo de precios_relativos_productos (permite que la app renderice sin
// depender de la red al abrir). orden/fuente son solo para UI/documentación.
export const PRODUCTOS = [
  { id: 'dolar_bna', nombre: 'Dólar Banco Nación', monedaNativa: 'ARS', unidad: '$/USD', origen: 'automatico', orden: 1 },
  { id: 'dolar_blue', nombre: 'Dólar Blue', monedaNativa: 'ARS', unidad: '$/USD', origen: 'automatico', orden: 2 },
  { id: 'soja_ros', nombre: 'Soja Rosario', monedaNativa: 'ARS', unidad: '$/tn', origen: 'automatico', orden: 10 },
  { id: 'maiz_ros', nombre: 'Maíz Rosario', monedaNativa: 'ARS', unidad: '$/tn', origen: 'automatico', orden: 11 },
  { id: 'trigo_ros', nombre: 'Trigo Rosario', monedaNativa: 'ARS', unidad: '$/tn', origen: 'automatico', orden: 12 },
  { id: 'girasol_ros', nombre: 'Girasol Rosario', monedaNativa: 'ARS', unidad: '$/tn', origen: 'automatico', orden: 13 },
  { id: 'gasoil_g2', nombre: 'Gas oil Grado 2', monedaNativa: 'ARS', unidad: '$/litro', origen: 'automatico', orden: 20 },
  { id: 'novillo', nombre: 'Novillo', monedaNativa: 'ARS', unidad: '$/kg vivo', origen: 'automatico', orden: 30 },
  { id: 'ternero', nombre: 'Ternero', monedaNativa: 'ARS', unidad: '$/kg + IVA', origen: 'automatico', orden: 31 },
  { id: 'vaca_prenada', nombre: 'Vaca preñada', monedaNativa: 'ARS', unidad: '$/cabeza + IVA', origen: 'automatico', orden: 32 },
  { id: 'map', nombre: 'MAP', monedaNativa: 'USD', unidad: 'USD/tn', origen: 'manual', orden: 40 },
  { id: 'urea', nombre: 'UREA', monedaNativa: 'USD', unidad: 'USD/tn', origen: 'manual', orden: 41 },
  { id: 'glifosato_48', nombre: 'Glifosato liq. 48%', monedaNativa: 'USD', unidad: 'USD/litro', origen: 'manual', orden: 42 },
];
