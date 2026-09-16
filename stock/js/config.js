// La versión mostrada en pantalla ya no vive acá: es compartida con Granos
// vía /version.json en la raíz del sitio (ver app.js).

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

// Opciones de "Destino de venta" (solo para el tipo 'venta').
export const DESTINO_VENTA = [
  { id: 'faena', nombre: 'Faena' },
  { id: 'invernada', nombre: 'Invernada' },
  { id: 'conserva', nombre: 'Conserva' },
];

// Espejo de la tabla categorias.
export const CATEGORIAS = [
  { id: 'ternero_al_pie', nombre: 'Ternero al pie' },
  { id: 'ternera_al_pie', nombre: 'Ternera al pie' },
  { id: 'ternero', nombre: 'Ternero' },
  { id: 'ternera', nombre: 'Ternera' },
  { id: 'vaquillona', nombre: 'Vaquillona' },
  { id: 'novillito', nombre: 'Novillito' },
  { id: 'novillo', nombre: 'Novillo' },
  { id: 'torito', nombre: 'Torito' },
  { id: 'toro', nombre: 'Toro' },
  { id: 'vaca', nombre: 'Vaca' },
];

// Cambio de categoría: a qué categoría única puede pasar cada una (para
// minimizar error de carga, no se puede "saltar" un paso ni elegir
// cualquier categoría al voleo). Las que no están acá (novillo/toro/vaca)
// son categorías terminales — no tienen un siguiente paso, así que
// tampoco se pueden elegir como ORIGEN de un cambio de categoría (ver
// opcionesCategoriaOrigen() en movimientos.js).
export const SIGUIENTE_CATEGORIA = {
  ternera_al_pie: 'ternera',
  ternera: 'vaquillona',
  vaquillona: 'vaca',
  ternero_al_pie: 'ternero',
  ternero: 'novillito',
  novillito: 'novillo',
  torito: 'toro',
};

// Espejo de tipos_movimiento: qué campos pedir por cada tipo.
// clase: 'entrada' (alta), 'salida' (baja), 'interna' (mueve sin cambiar el total).
// El orden de las claves acá ES el orden de los botones "Tipo de
// movimiento" en pantalla (crearGrupoBotones recorre Object.entries en
// orden de inserción) — Apertura de stock va al final a propósito (uso
// excepcional, solo owner).
export const TIPOS_MOVIMIENTO = {
  venta: {
    nombre: 'Venta', clase: 'salida',
    // destino_venta va primero (antes que establecimiento/categoría) y
    // comprador al final — ver orden real de los campos en el HTML
    // (stock/index.html), esta lista solo controla mostrar/ocultar.
    campos: ['destino_venta', 'establecimiento_origen', 'categoria_origen', 'titular_origen', 'comprador'],
  },
  // Unificadas en "venta" de arriba — la categoría elegida ya distingue
  // de qué venta se trataba. Se dejan acá con oculto:true (no aparecen
  // como botón nuevo) solo para que editar un movimiento viejo cargado
  // con alguno de estos 3 tipos siga funcionando.
  venta_gordo: {
    nombre: 'Venta de gordo', clase: 'salida', oculto: true,
    campos: ['establecimiento_origen', 'categoria_origen', 'titular_origen'],
  },
  venta_vaca_prenada: {
    nombre: 'Venta de vaca preñada', clase: 'salida', oculto: true,
    campos: ['establecimiento_origen', 'categoria_origen', 'titular_origen'],
  },
  venta_invernada: {
    nombre: 'Venta de invernada', clase: 'salida', oculto: true,
    campos: ['establecimiento_origen', 'categoria_origen', 'titular_origen'],
  },
  // Redundante con "Venta" de arriba (la categoría elegida ya cubre vaca
  // de faena/conserva) — mismo criterio que venta_gordo/venta_vaca_prenada/
  // venta_invernada: oculto:true solo para que editar un movimiento viejo
  // cargado con este tipo siga funcionando.
  faena_conserva: {
    nombre: 'Vaca faena / conserva', clase: 'salida', oculto: true,
    campos: ['establecimiento_origen', 'categoria_origen', 'titular_origen'],
  },
  compra_invernada: {
    nombre: 'Compra de invernada', clase: 'entrada',
    campos: ['establecimiento_destino', 'categoria_destino', 'titular_destino'],
  },
  traslado: {
    nombre: 'Traslado entre establecimientos', clase: 'interna',
    // rodeo_destino es obligatorio acá: un rodeo queda atado para siempre
    // al establecimiento donde se creó (rodeos.establecimiento_id), así
    // que mover animales a otro establecimiento significa sumarlos a un
    // rodeo (existente o nuevo) DE ESE establecimiento, no arrastrar el
    // rodeo de origen.
    campos: ['establecimiento_origen', 'establecimiento_destino', 'categoria_origen', 'titular_origen', 'rodeo_destino'],
    duplicarCategoriaEnDestino: true,
    duplicarTitularEnDestino: true,
  },
  cambio_categoria: {
    nombre: 'Cambio de categoría', clase: 'interna',
    campos: ['establecimiento_origen', 'categoria_origen', 'categoria_destino', 'titular_origen'],
    duplicarEstablecimientoEnDestino: true,
    duplicarTitularEnDestino: true,
  },
  cambio_rodeo: {
    nombre: 'Cambio de rodeo', clase: 'interna',
    // El establecimiento de destino es un campo real (no se duplica del
    // origen): el rodeo destino puede estar en otro establecimiento.
    campos: ['establecimiento_origen', 'establecimiento_destino', 'categoria_origen', 'titular_origen', 'rodeo_destino'],
    duplicarCategoriaEnDestino: true,
    duplicarTitularEnDestino: true,
  },
  paricion: {
    nombre: 'Parición', clase: 'entrada',
    campos: ['establecimiento_destino', 'categoria_destino', 'titular_destino'],
    categoriasPermitidas: ['ternero_al_pie', 'ternera_al_pie'],
  },
  mortandad: {
    nombre: 'Mortandad', clase: 'salida',
    campos: ['establecimiento_origen', 'categoria_origen', 'titular_origen'],
  },
  cambio_titular: {
    nombre: 'Cambio de titularidad', clase: 'interna',
    campos: ['establecimiento_origen', 'categoria_origen', 'titular_origen', 'titular_destino'],
    duplicarEstablecimientoEnDestino: true,
    duplicarCategoriaEnDestino: true,
  },
  // Hotelería: animales de un cliente externo que se alojan/engordan en
  // Feed Lot — no son de Agro Salado ni de un capitalizador (socio), así
  // que usan su propio campo "Cliente" (titulares.tipo='cliente') en vez
  // de Titularidad de destino. establecimientoDestinoFijo reemplaza al
  // selector de establecimiento (siempre Feed Lot); sinRodeo esconde el
  // selector de Rodeo — el rodeo se crea solo por lote, ver onSubmit() en
  // movimientos.js.
  hoteleria: {
    nombre: 'Hotelería', clase: 'entrada',
    campos: ['categoria_destino', 'cliente'],
    establecimientoDestinoFijo: 'feed_lot',
    sinRodeo: true,
  },
  // Retiro del cliente: cierra el lote (libera el corral, cierra el ciclo
  // de feed lot) — ver rodeosDe(soloHoteleria) en rodeos.js, que filtra el
  // selector de Rodeo para mostrar solo lotes de hotelería.
  salida_hoteleria: {
    nombre: 'Salida de hotelería', clase: 'salida',
    campos: ['categoria_origen', 'cliente'],
    establecimientoOrigenFijo: 'feed_lot',
    soloRodeosHoteleria: true,
  },
  // Al final del grupo de botones a propósito (uso excepcional, solo owner).
  apertura_stock: {
    nombre: 'Apertura de stock', clase: 'entrada',
    campos: ['establecimiento_destino', 'categoria_destino', 'titular_destino'],
    soloOwner: true,
  },
};

// Rango de sanidad para kilos promedio por cabeza (solo advierte, no bloquea).
export const KILOS_MIN_SANIDAD = 20;
export const KILOS_MAX_SANIDAD = 800;
