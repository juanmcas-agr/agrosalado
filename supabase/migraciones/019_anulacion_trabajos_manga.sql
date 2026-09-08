-- 019: Anulación de Trabajo de Manga (mismo criterio que movimientos: se
-- marca, no se borra, para no perder trazabilidad de códigos). Reutiliza
-- la política trabajos_manga_update ya existente (encargado/
-- administrativo/owner) — la app solo muestra el botón "Anular" a owner.

alter table trabajos_manga add column anulado boolean not null default false;
alter table trabajos_manga add column anulado_por uuid references auth.users(id);
alter table trabajos_manga add column anulado_at timestamptz;
alter table trabajos_manga add column anulado_motivo text;

create or replace view historial_trabajos_manga as
  select
    t.id, t.codigo, t.fecha,
    t.rodeo_id, r.codigo as rodeo,
    t.categoria_id, c.nombre as categoria_nombre,
    t.cantidad_trabajada, t.stock_al_momento, t.diferencia_pendiente,
    t.usuario_id, p.nombre_completo as usuario_nombre,
    t.observaciones, t.creado_at,
    t.resuelto_por_movimiento_id, mv.codigo as resuelto_por_movimiento_codigo, t.resuelto_at,
    t.anulado, t.anulado_por, t.anulado_at, t.anulado_motivo
  from trabajos_manga t
  left join rodeos r on r.id = t.rodeo_id
  left join categorias c on c.id = t.categoria_id
  left join perfiles p on p.user_id = t.usuario_id
  left join movimientos mv on mv.id = t.resuelto_por_movimiento_id
  order by t.fecha desc, t.creado_at desc;

-- Verificación
select codigo, anulado, anulado_motivo from historial_trabajos_manga limit 5;
