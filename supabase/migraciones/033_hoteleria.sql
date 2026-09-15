-- 033: Hotelería en Feed Lot — clientes externos que alojan/engordan sus
-- propios animales (no son socios de Agro Salado, cero participación en
-- el stock propio; distinto de un "capitalizador"). Cada lote de
-- hotelería crea automáticamente su propio rodeo (el cliente/data-entry
-- no elige ni nombra un rodeo a mano) y ese rodeo queda flageado con
-- es_hoteleria=true para que los demás tipos de movimiento (Venta,
-- Traslado, Cambio de categoría, etc.) no lo ofrezcan como si fuera stock
-- propio de Agro Salado — solo aparece en el selector de "Salida de
-- hotelería".

alter table titulares drop constraint titulares_tipo_check;
alter table titulares add constraint titulares_tipo_check check (tipo in ('propio', 'capitalizador', 'cliente'));

alter table rodeos add column es_hoteleria boolean not null default false;

insert into tipos_movimiento
  (id, nombre, clase, requiere_establecimiento_origen, requiere_establecimiento_destino, requiere_categoria_origen, requiere_categoria_destino, requiere_titular_origen, requiere_titular_destino, orden) values
  ('hoteleria',        'Hotelería',            'entrada', false, true,  false, true,  false, true,  14),
  ('salida_hoteleria', 'Salida de hotelería',  'salida',  true,  false, true,  false, true,  false, 15);
