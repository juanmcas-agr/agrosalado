-- 037: corrige el error "Tipo de movimiento inválido: venta" al cargar
-- una Venta. La migración 026 (que agrega 'venta' a tipos_movimiento)
-- parece no haberse llegado a correr en producción — el trigger
-- validar_movimiento() rechaza cualquier movimiento cuyo tipo no esté en
-- esa tabla. Este insert es idempotente (on conflict do nothing), así
-- que no rompe nada si 026 sí se corrió después de todo.

insert into tipos_movimiento
  (id, nombre, clase, requiere_establecimiento_origen, requiere_establecimiento_destino, requiere_categoria_origen, requiere_categoria_destino, requiere_titular_origen, requiere_titular_destino, orden)
values
  ('venta', 'Venta', 'salida', true, false, true, false, true, false, 13)
on conflict (id) do nothing;
