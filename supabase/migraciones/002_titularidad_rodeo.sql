-- Migración: titularidad (Agro Salado / Doña Julia / Capitalizador) + rodeo
-- Correr completo en el SQL Editor de Supabase, en una pestaña nueva.

-- 1. Tabla de titulares
create table titulares (
  id text primary key,
  nombre text not null,
  tipo text not null check (tipo in ('propio', 'capitalizador')),
  orden int not null default 0,
  activo boolean not null default true
);

insert into titulares (id, nombre, tipo, orden) values
  ('agro_salado', 'Agro Salado', 'propio', 1),
  ('dona_julia', 'Doña Julia', 'propio', 2),
  ('sgro', 'SGRO', 'capitalizador', 3),
  ('cym', 'CYM', 'capitalizador', 4);

alter table titulares enable row level security;
create policy titulares_select on titulares for select to authenticated using (true);
create policy titulares_insert on titulares for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- 2. tipos_movimiento: nuevas columnas + cambio_titular + reordenar apertura al final
alter table tipos_movimiento add column requiere_titular_origen boolean not null default false;
alter table tipos_movimiento add column requiere_titular_destino boolean not null default false;

update tipos_movimiento set requiere_titular_destino = true
  where id in ('apertura_stock', 'compra_invernada', 'paricion');
update tipos_movimiento set requiere_titular_origen = true
  where id in ('venta_gordo', 'venta_vaca_prenada', 'venta_invernada', 'faena_conserva', 'mortandad');
update tipos_movimiento set requiere_titular_origen = true, requiere_titular_destino = true
  where id in ('traslado', 'cambio_categoria');

insert into tipos_movimiento
  (id, nombre, clase, requiere_establecimiento_origen, requiere_establecimiento_destino, requiere_categoria_origen, requiere_categoria_destino, requiere_titular_origen, requiere_titular_destino, orden)
values
  ('cambio_titular', 'Cambio de titularidad', 'interna', true, true, true, true, true, true, 10);

update tipos_movimiento set orden = 11 where id = 'apertura_stock';

-- 3. movimientos: nuevas columnas
alter table movimientos add column titular_origen text references titulares(id);
alter table movimientos add column titular_destino text references titulares(id);
alter table movimientos add column rodeo text;

-- 4. Reemplazar la función de validación (agrega chequeos de titular,
--    cambio_titular, y que apertura_stock sea solo de un owner)
create or replace function validar_movimiento() returns trigger
language plpgsql as $$
declare
  t tipos_movimiento;
begin
  select * into t from tipos_movimiento where id = new.tipo_movimiento;
  if t is null then
    raise exception 'Tipo de movimiento inválido: %', new.tipo_movimiento;
  end if;

  if t.requiere_establecimiento_origen and new.establecimiento_origen is null then
    raise exception 'Falta establecimiento_origen para %', new.tipo_movimiento;
  end if;
  if not t.requiere_establecimiento_origen and new.establecimiento_origen is not null then
    raise exception 'establecimiento_origen no corresponde para %', new.tipo_movimiento;
  end if;

  if t.requiere_establecimiento_destino and new.establecimiento_destino is null then
    raise exception 'Falta establecimiento_destino para %', new.tipo_movimiento;
  end if;
  if not t.requiere_establecimiento_destino and new.establecimiento_destino is not null then
    raise exception 'establecimiento_destino no corresponde para %', new.tipo_movimiento;
  end if;

  if t.requiere_categoria_origen and new.categoria_origen is null then
    raise exception 'Falta categoria_origen para %', new.tipo_movimiento;
  end if;
  if not t.requiere_categoria_origen and new.categoria_origen is not null then
    raise exception 'categoria_origen no corresponde para %', new.tipo_movimiento;
  end if;

  if t.requiere_categoria_destino and new.categoria_destino is null then
    raise exception 'Falta categoria_destino para %', new.tipo_movimiento;
  end if;
  if not t.requiere_categoria_destino and new.categoria_destino is not null then
    raise exception 'categoria_destino no corresponde para %', new.tipo_movimiento;
  end if;

  if t.requiere_titular_origen and new.titular_origen is null then
    raise exception 'Falta titular_origen para %', new.tipo_movimiento;
  end if;
  if not t.requiere_titular_origen and new.titular_origen is not null then
    raise exception 'titular_origen no corresponde para %', new.tipo_movimiento;
  end if;

  if t.requiere_titular_destino and new.titular_destino is null then
    raise exception 'Falta titular_destino para %', new.tipo_movimiento;
  end if;
  if not t.requiere_titular_destino and new.titular_destino is not null then
    raise exception 'titular_destino no corresponde para %', new.tipo_movimiento;
  end if;

  if new.tipo_movimiento = 'traslado' then
    if new.establecimiento_origen = new.establecimiento_destino then
      raise exception 'En un traslado, establecimiento_origen y destino deben ser distintos';
    end if;
    if new.categoria_origen <> new.categoria_destino then
      raise exception 'En un traslado, la categoría no cambia';
    end if;
    if new.titular_origen <> new.titular_destino then
      raise exception 'En un traslado, la titularidad no cambia (usá "Cambio de titularidad" para eso)';
    end if;
  end if;

  if new.tipo_movimiento = 'cambio_categoria' then
    if new.establecimiento_origen <> new.establecimiento_destino then
      raise exception 'En un cambio de categoría, el establecimiento no cambia';
    end if;
    if new.categoria_origen = new.categoria_destino then
      raise exception 'En un cambio de categoría, la categoría origen y destino deben ser distintas';
    end if;
    if new.titular_origen <> new.titular_destino then
      raise exception 'En un cambio de categoría, la titularidad no cambia';
    end if;
  end if;

  if new.tipo_movimiento = 'cambio_titular' then
    if new.establecimiento_origen <> new.establecimiento_destino then
      raise exception 'En un cambio de titularidad, el establecimiento no cambia';
    end if;
    if new.categoria_origen <> new.categoria_destino then
      raise exception 'En un cambio de titularidad, la categoría no cambia';
    end if;
    if new.titular_origen = new.titular_destino then
      raise exception 'En un cambio de titularidad, la titularidad origen y destino deben ser distintas';
    end if;
  end if;

  if new.tipo_movimiento = 'apertura_stock' and rol_actual() <> 'owner' then
    raise exception 'Solo un owner puede cargar una apertura de stock';
  end if;

  if new.fecha > current_date then
    raise exception 'La fecha no puede ser futura';
  end if;

  return new;
end;
$$;

-- 5. Vistas: hay que recrearlas (no "or replace") porque cambia el orden de columnas
drop view if exists stock_actual;
drop view if exists movimiento_lineas;
drop view if exists historial_movimientos;

create view movimiento_lineas as
  select id, fecha, establecimiento_destino as establecimiento, categoria_destino as categoria,
         coalesce(titular_destino, 'agro_salado') as titular,
         cantidad_cabezas as delta_cabezas, kilos_promedio, usuario_id
  from movimientos
  where not anulado and establecimiento_destino is not null
  union all
  select id, fecha, establecimiento_origen as establecimiento, categoria_origen as categoria,
         coalesce(titular_origen, 'agro_salado') as titular,
         -cantidad_cabezas as delta_cabezas, kilos_promedio, usuario_id
  from movimientos
  where not anulado and establecimiento_origen is not null;

create view stock_actual as
  select establecimiento, categoria, titular, sum(delta_cabezas) as cabezas
  from movimiento_lineas
  group by establecimiento, categoria, titular;

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
    m.cantidad_cabezas, m.kilos_promedio, m.rodeo, m.observaciones,
    m.usuario_id, p.nombre_completo as usuario_nombre,
    m.created_at, m.anulado, m.anulado_por, m.anulado_at, m.anulado_motivo
  from movimientos m
  join tipos_movimiento tm on tm.id = m.tipo_movimiento
  left join establecimientos eo on eo.id = m.establecimiento_origen
  left join establecimientos ed on ed.id = m.establecimiento_destino
  left join categorias co on co.id = m.categoria_origen
  left join categorias cd on cd.id = m.categoria_destino
  left join titulares tio on tio.id = m.titular_origen
  left join titulares tid on tid.id = m.titular_destino
  left join perfiles p on p.user_id = m.usuario_id
  order by m.fecha desc, m.created_at desc;

-- Nota: los movimientos que ya cargaste no tienen titular — las vistas de
-- arriba los cuentan como "Agro Salado" (coalesce) para no perder cabezas
-- del total. Si en realidad eran de otro titular, corregilo cargando un
-- "Cambio de titularidad".
