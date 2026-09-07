-- Migración: Editar movimiento con auditoría (Hacienda M6)
-- Correr completo en el SQL Editor de Supabase.

alter table movimientos add column reemplazado_por uuid references movimientos(id);
alter table movimientos add column editado_de uuid references movimientos(id);

-- reemplazado_por se actualiza con un UPDATE normal sobre movimientos, así
-- que ya queda cubierto por la policy movimientos_anular existente (mismas
-- reglas que anular: administrativo/owner sin límite, o el propio usuario
-- dentro de 48hs) — no hace falta una policy nueva.

drop view historial_movimientos;

create view historial_movimientos as
  select
    m.id, m.tipo_movimiento, tm.nombre as tipo_movimiento_nombre, tm.clase,
    m.fecha,
    m.establecimiento_origen, eo.nombre as establecimiento_origen_nombre,
    m.establecimiento_destino, ed.nombre as establecimiento_destino_nombre,
    m.categoria_origen, co.nombre as categoria_origen_nombre,
    m.categoria_destino, cd.nombre as categoria_destino_nombre,
    m.titular_origen, tio.nombre as titular_origen_nombre,
    m.titular_destino, tid.nombre as titular_destino_nombre,
    m.cantidad_cabezas, m.kilos_promedio,
    m.rodeo_id, r.codigo as rodeo,
    m.rodeo_destino_id, rd.codigo as rodeo_destino,
    m.observaciones,
    m.usuario_id, p.nombre_completo as usuario_nombre,
    m.created_at, m.anulado, m.anulado_por, m.anulado_at, m.anulado_motivo,
    m.reemplazado_por, m.editado_de
  from movimientos m
  join tipos_movimiento tm on tm.id = m.tipo_movimiento
  left join establecimientos eo on eo.id = m.establecimiento_origen
  left join establecimientos ed on ed.id = m.establecimiento_destino
  left join categorias co on co.id = m.categoria_origen
  left join categorias cd on cd.id = m.categoria_destino
  left join titulares tio on tio.id = m.titular_origen
  left join titulares tid on tid.id = m.titular_destino
  left join rodeos r on r.id = m.rodeo_id
  left join rodeos rd on rd.id = m.rodeo_destino_id
  left join perfiles p on p.user_id = m.usuario_id
  order by m.fecha desc, m.created_at desc;

-- Verificación
select count(*) from historial_movimientos;
