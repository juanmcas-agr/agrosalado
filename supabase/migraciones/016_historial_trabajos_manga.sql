-- Milestone 3 (parte 1): vista liviana de Trabajo de Manga con nombres
-- resueltos (rodeo, categoría, usuario, y el código del movimiento que
-- resolvió una diferencia pendiente, si corresponde). La usa el mail
-- diario unificado y, más adelante, Reportes > Trabajo de Manga.
--
-- Requiere haber corrido 003 a 015 antes.

create view historial_trabajos_manga as
  select
    t.id, t.codigo, t.fecha,
    t.rodeo_id, r.codigo as rodeo,
    t.categoria_id, c.nombre as categoria_nombre,
    t.cantidad_trabajada, t.stock_al_momento, t.diferencia_pendiente,
    t.usuario_id, p.nombre_completo as usuario_nombre,
    t.observaciones, t.creado_at,
    t.resuelto_por_movimiento_id, mv.codigo as resuelto_por_movimiento_codigo, t.resuelto_at
  from trabajos_manga t
  left join rodeos r on r.id = t.rodeo_id
  left join categorias c on c.id = t.categoria_id
  left join perfiles p on p.user_id = t.usuario_id
  left join movimientos mv on mv.id = t.resuelto_por_movimiento_id
  order by t.fecha desc, t.creado_at desc;

-- Verificación
select count(*) from historial_trabajos_manga;
