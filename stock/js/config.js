// Fase preliminar: v.0.1, v.0.1.1, v.0.1.2... (el tercer número sube con cada
// modificación). Cuando pasemos a algo definitivo, arranca v.1.x.x.
export const VERSION = '0.1.8';

// Completar con los datos del proyecto de Supabase (Project Settings > API).
// La "anon key" es pública y segura para exponer en el cliente.
export const SUPABASE_URL = 'https://uiummeoayxwayxntjjsv.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_I9x0D8vsS_XvDW0lrUy5fQ_DEIJpDK6';

// Espejo de la tabla establecimientos (permite que la app renderice el
// formulario sin depender de la red al abrir).
export const ESTABLECIMIENTOS = [
  { id: 'san_miguel', nombre: 'San Miguel' },
  { id: 'san_juan', nombre: 'San Juan (Las Marianitas)' },
  { id: 'feed_lot', nombre: 'Feed Lot' },
  { id: 'el_tara', nombre: 'El Tara' },
];

// Espejo de la tabla categorias.
export const CATEGORIAS = [
  { id: 'macho', nombre: 'Macho' },
  { id: 'hembra', nombre: 'Hembra' },
  { id: 'vaquillona_reposicion', nombre: 'Vaquillona reposición' },
  { id: 'vaca_servicio_primavera', nombre: 'Vaca servicio de primavera' },
  { id: 'vaca_servicio_invierno', nombre: 'Vaca servicio de invierno' },
  { id: 'toro', nombre: 'Toro' },
];

// Espejo de tipos_movimiento: qué campos pedir por cada tipo.
// clase: 'entrada' (alta), 'salida' (baja), 'interna' (mueve sin cambiar el total).
export const TIPOS_MOVIMIENTO = {
  apertura_stock: {
    nombre: 'Apertura de stock', clase: 'entrada',
    campos: ['establecimiento_destino', 'categoria_destino'],
  },
  compra_invernada: {
    nombre: 'Compra de invernada', clase: 'entrada',
    campos: ['establecimiento_destino', 'categoria_destino'],
  },
  paricion: {
    nombre: 'Parición', clase: 'entrada',
    campos: ['establecimiento_destino', 'categoria_destino'],
    categoriasPermitidas: ['macho', 'hembra'],
  },
  venta_gordo: {
    nombre: 'Venta de gordo', clase: 'salida',
    campos: ['establecimiento_origen', 'categoria_origen'],
  },
  venta_vaca_prenada: {
    nombre: 'Venta de vaca preñada', clase: 'salida',
    campos: ['establecimiento_origen', 'categoria_origen'],
  },
  venta_invernada: {
    nombre: 'Venta de invernada', clase: 'salida',
    campos: ['establecimiento_origen', 'categoria_origen'],
  },
  faena_conserva: {
    nombre: 'Vaca faena / conserva', clase: 'salida',
    campos: ['establecimiento_origen', 'categoria_origen'],
  },
  mortandad: {
    nombre: 'Mortandad', clase: 'salida',
    campos: ['establecimiento_origen', 'categoria_origen'],
  },
  traslado: {
    nombre: 'Traslado entre establecimientos', clase: 'interna',
    campos: ['establecimiento_origen', 'establecimiento_destino', 'categoria_origen'],
    duplicarCategoriaEnDestino: true,
  },
  cambio_categoria: {
    nombre: 'Cambio de categoría', clase: 'interna',
    campos: ['establecimiento_origen', 'categoria_origen', 'categoria_destino'],
    duplicarEstablecimientoEnDestino: true,
  },
};

// Rango de sanidad para kilos promedio por cabeza (solo advierte, no bloquea).
export const KILOS_MIN_SANIDAD = 20;
export const KILOS_MAX_SANIDAD = 800;
