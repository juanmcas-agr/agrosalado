-- 041: al editar/corregir un movimiento, el original quedaba con
-- reemplazado_por seteado pero seguía sumando al stock igual que antes —
-- la corrección se sumaba aparte, duplicando cabezas y kilos. No es un
-- problema de la migración 039 ni del rediseño de Feed Lot, es un bug
-- viejo de la vista movimiento_lineas (la base de todo el stock).
--
-- No borra ni cambia ningún dato — solo redefine la vista para que un
-- movimiento reemplazado (reemplazado_por is not null) deje de sumar,
-- igual que ya pasa con uno anulado. Sigue apareciendo en Historial para
-- auditoría, simplemente no cuenta más para el stock.
create or replace view movimiento_lineas with (security_invoker = true) as
  select id, fecha, establecimiento_destino as establecimiento, categoria_destino as categoria,
         coalesce(titular_destino, 'agro_salado') as titular,
         coalesce(rodeo_destino_id, rodeo_id) as rodeo_id,
         cantidad_cabezas as delta_cabezas, kilos_promedio, usuario_id
  from movimientos
  where not anulado and reemplazado_por is null and establecimiento_destino is not null
  union all
  select id, fecha, establecimiento_origen as establecimiento, categoria_origen as categoria,
         coalesce(titular_origen, 'agro_salado') as titular, rodeo_id,
         -cantidad_cabezas as delta_cabezas, kilos_promedio, usuario_id
  from movimientos
  where not anulado and reemplazado_por is null and establecimiento_origen is not null;
