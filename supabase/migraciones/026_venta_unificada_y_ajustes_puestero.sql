-- 026: dos ajustes independientes.
--
-- 1) Unificar "Venta de gordo" / "Venta de vaca preñada" / "Venta de
-- invernada" en un solo tipo de movimiento "Venta" — las 3 pedían
-- exactamente los mismos campos, la categoría elegida ya distingue de
-- qué se trata. Los 3 tipos viejos NO se borran (son la referencia de
-- movimientos.tipo_movimiento para todo lo ya cargado, y el trigger
-- validar_movimiento() los necesita para no romper la trazabilidad
-- histórica) — el cliente deja de ofrecerlos como opción nueva, eso es
-- todo.
insert into tipos_movimiento
  (id, nombre, clase, requiere_establecimiento_origen, requiere_establecimiento_destino, requiere_categoria_origen, requiere_categoria_destino, requiere_titular_origen, requiere_titular_destino, orden)
values
  ('venta', 'Venta', 'salida', true, false, true, false, true, false, 13)
on conflict (id) do nothing;

-- 2) Un puestero ya no puede dar de alta rodeos (rodeos_update se deja
-- como está: sigue pudiendo renombrar, eso no se pidió restringir).
alter policy rodeos_insert on rodeos
  with check (rol_actual() in ('encargado', 'administrativo', 'owner') and creado_por = auth.uid());
