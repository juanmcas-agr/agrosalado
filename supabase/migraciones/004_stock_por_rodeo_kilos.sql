-- Migración: stock desagregado por rodeo + kilos promedio ponderado (Hacienda M3)
-- Correr completo en el SQL Editor de Supabase, en una pestaña nueva.

drop view stock_actual;
drop view movimiento_lineas;

create view movimiento_lineas as
  select id, fecha, establecimiento_destino as establecimiento, categoria_destino as categoria,
         coalesce(titular_destino, 'agro_salado') as titular, rodeo_id,
         cantidad_cabezas as delta_cabezas, kilos_promedio, usuario_id
  from movimientos
  where not anulado and establecimiento_destino is not null
  union all
  select id, fecha, establecimiento_origen as establecimiento, categoria_origen as categoria,
         coalesce(titular_origen, 'agro_salado') as titular, rodeo_id,
         -cantidad_cabezas as delta_cabezas, kilos_promedio, usuario_id
  from movimientos
  where not anulado and establecimiento_origen is not null;

create view stock_actual as
  select
    ml.establecimiento, ml.categoria, ml.titular, ml.rodeo_id, r.codigo as rodeo,
    sum(ml.delta_cabezas) as cabezas,
    case when sum(ml.delta_cabezas) > 0
      then round(sum(ml.delta_cabezas * ml.kilos_promedio) / sum(ml.delta_cabezas), 2)
      else null end as kilos_promedio_ponderado
  from movimiento_lineas ml
  left join rodeos r on r.id = ml.rodeo_id
  group by ml.establecimiento, ml.categoria, ml.titular, ml.rodeo_id, r.codigo;

-- Verificación: debería devolver filas (una por establecimiento/categoría/
-- titular/rodeo) con cabezas y kilos_promedio_ponderado.
select * from stock_actual order by establecimiento, categoria limit 20;
