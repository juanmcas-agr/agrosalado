-- 034: Venta ahora pide "Destino de venta" (Faena / Invernada / Conserva)
-- y "Comprador" (lista editable de compradores) — sub-campos del mismo
-- tipo 'venta' unificado, no tipos de movimiento nuevos. Se validan solo
-- del lado cliente (mismo criterio que "Observaciones obligatorio para
-- Mortandad"), no hace falta tocar validar_movimiento().

create table compradores (
  id text primary key,
  nombre text not null,
  orden int not null default 0,
  activo boolean not null default true
);

insert into compradores (id, nombre, orden) values
  ('brosa', 'Brosa', 1),
  ('hiriart', 'Hiriart', 2),
  ('coto', 'Coto', 3),
  ('mag', 'MAG', 4),
  ('feigelstock', 'Feigelstock', 5);

alter table compradores enable row level security;
create policy compradores_select on compradores for select to authenticated using (rol_actual() is not null);
create policy compradores_insert on compradores for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));

alter table movimientos add column destino_venta text check (destino_venta in ('faena', 'invernada', 'conserva'));
alter table movimientos add column comprador_id text references compradores(id);

-- historial_movimientos: agrega destino_venta/comprador para que se vean
-- en el Historial. CREATE OR REPLACE VIEW no permite insertar columnas
-- en el medio (solo agregar al final) — por eso destino_venta/comprador_id/
-- comprador_nombre van al final del select, no junto a observaciones como
-- en schema.sql (ahí sí se puede, es un create nuevo).
create or replace view historial_movimientos with (security_invoker = true) as
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
    m.reemplazado_por, m.editado_de,
    m.codigo, mr.codigo as reemplazado_por_codigo, me.codigo as editado_de_codigo,
    m.destino_venta, m.comprador_id, cp.nombre as comprador_nombre
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
  left join compradores cp on cp.id = m.comprador_id
  left join perfiles p on p.user_id = m.usuario_id
  left join movimientos mr on mr.id = m.reemplazado_por
  left join movimientos me on me.id = m.editado_de
  order by m.fecha desc, m.created_at desc;
