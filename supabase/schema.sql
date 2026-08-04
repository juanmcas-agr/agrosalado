-- AGROSALADO Stock — esquema inicial
-- Ejecutar completo en el SQL Editor de Supabase (proyecto nuevo).

-- ─── Catálogos ──────────────────────────────────────────────────────────

create table establecimientos (
  id text primary key,
  nombre text not null,
  orden int not null,
  activo boolean not null default true
);

insert into establecimientos (id, nombre, orden) values
  ('san_miguel', 'San Miguel', 1),
  ('san_juan', 'San Juan (Las Marianitas)', 2),
  ('feed_lot', 'Feed Lot', 3),
  ('el_tara', 'El Tara', 4);

create table categorias (
  id text primary key,
  nombre text not null,
  orden int not null,
  activo boolean not null default true
);

insert into categorias (id, nombre, orden) values
  ('macho', 'Macho', 1),
  ('hembra', 'Hembra', 2),
  ('vaquillona_reposicion', 'Vaquillona reposición', 3),
  ('vaca_servicio_primavera', 'Vaca servicio de primavera', 4),
  ('vaca_servicio_invierno', 'Vaca servicio de invierno', 5),
  ('toro', 'Toro', 6);

create table tipos_movimiento (
  id text primary key,
  nombre text not null,
  clase text not null check (clase in ('entrada', 'salida', 'interna')),
  requiere_establecimiento_origen boolean not null default false,
  requiere_establecimiento_destino boolean not null default false,
  requiere_categoria_origen boolean not null default false,
  requiere_categoria_destino boolean not null default false,
  orden int not null
);

insert into tipos_movimiento
  (id, nombre, clase, requiere_establecimiento_origen, requiere_establecimiento_destino, requiere_categoria_origen, requiere_categoria_destino, orden) values
  ('apertura_stock',      'Apertura de stock',                  'entrada', false, true,  false, true,  1),
  ('compra_invernada',    'Compra de invernada',                'entrada', false, true,  false, true,  2),
  ('paricion',            'Parición',                           'entrada', false, true,  false, true,  3),
  ('venta_gordo',         'Venta de gordo',                     'salida',  true,  false, true,  false, 4),
  ('venta_vaca_prenada',  'Venta de vaca preñada',               'salida',  true,  false, true,  false, 5),
  ('venta_invernada',     'Venta de invernada',                 'salida',  true,  false, true,  false, 6),
  ('faena_conserva',      'Vaca faena / conserva',              'salida',  true,  false, true,  false, 7),
  ('mortandad',           'Mortandad',                          'salida',  true,  false, true,  false, 8),
  ('traslado',            'Traslado entre establecimientos',    'interna', true,  true,  true,  true,  9),
  ('cambio_categoria',    'Cambio de categoría',                'interna', true,  true,  true,  true,  10);

-- ─── Perfiles (roles de usuario) ────────────────────────────────────────

create table perfiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text not null,
  rol text not null check (rol in ('encargado', 'administrativo', 'owner')),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─── Movimientos ────────────────────────────────────────────────────────

create table movimientos (
  id uuid primary key,
  tipo_movimiento text not null references tipos_movimiento(id),
  fecha date not null,
  establecimiento_origen text references establecimientos(id),
  establecimiento_destino text references establecimientos(id),
  categoria_origen text references categorias(id),
  categoria_destino text references categorias(id),
  cantidad_cabezas integer not null check (cantidad_cabezas > 0),
  kilos_promedio numeric(6,2) not null check (kilos_promedio > 0),
  usuario_id uuid not null references auth.users(id),
  observaciones text,
  created_at timestamptz not null default now(),
  anulado boolean not null default false,
  anulado_por uuid references auth.users(id),
  anulado_at timestamptz,
  anulado_motivo text
);
-- Nota: "id" no tiene default — lo genera el cliente (crypto.randomUUID())
-- para que los reintentos de sincronización offline sean idempotentes.

create index on movimientos (fecha);
create index on movimientos (usuario_id);
create index on movimientos (anulado) where anulado = false;

-- ─── Validación server-side ─────────────────────────────────────────────

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

  if new.tipo_movimiento = 'traslado' then
    if new.establecimiento_origen = new.establecimiento_destino then
      raise exception 'En un traslado, establecimiento_origen y destino deben ser distintos';
    end if;
    if new.categoria_origen <> new.categoria_destino then
      raise exception 'En un traslado, la categoría no cambia';
    end if;
  end if;

  if new.tipo_movimiento = 'cambio_categoria' then
    if new.establecimiento_origen <> new.establecimiento_destino then
      raise exception 'En un cambio de categoría, el establecimiento no cambia';
    end if;
    if new.categoria_origen = new.categoria_destino then
      raise exception 'En un cambio de categoría, la categoría origen y destino deben ser distintas';
    end if;
  end if;

  if new.fecha > current_date then
    raise exception 'La fecha no puede ser futura';
  end if;

  return new;
end;
$$;

create trigger trg_validar_movimiento
  before insert on movimientos
  for each row execute function validar_movimiento();

-- "Fecha de registro" (created_at) inamovible: ni una actualización
-- (por ejemplo al anular un movimiento) puede cambiarla.
create or replace function bloquear_cambio_created_at() returns trigger
language plpgsql as $$
begin
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger trg_bloquear_created_at
  before update on movimientos
  for each row execute function bloquear_cambio_created_at();

-- ─── Vistas de stock ────────────────────────────────────────────────────

create view movimiento_lineas as
  select id, fecha, establecimiento_destino as establecimiento, categoria_destino as categoria,
         cantidad_cabezas as delta_cabezas, kilos_promedio, usuario_id
  from movimientos
  where not anulado and establecimiento_destino is not null
  union all
  select id, fecha, establecimiento_origen as establecimiento, categoria_origen as categoria,
         -cantidad_cabezas as delta_cabezas, kilos_promedio, usuario_id
  from movimientos
  where not anulado and establecimiento_origen is not null;

create view stock_actual as
  select establecimiento, categoria, sum(delta_cabezas) as cabezas
  from movimiento_lineas
  group by establecimiento, categoria;

-- ─── Vista de historial (con etiquetas legibles para la UI) ─────────────

create view historial_movimientos as
  select
    m.id, m.tipo_movimiento, tm.nombre as tipo_movimiento_nombre, tm.clase,
    m.fecha,
    m.establecimiento_origen, eo.nombre as establecimiento_origen_nombre,
    m.establecimiento_destino, ed.nombre as establecimiento_destino_nombre,
    m.categoria_origen, co.nombre as categoria_origen_nombre,
    m.categoria_destino, cd.nombre as categoria_destino_nombre,
    m.cantidad_cabezas, m.kilos_promedio, m.observaciones,
    m.usuario_id, p.nombre_completo as usuario_nombre,
    m.created_at, m.anulado, m.anulado_por, m.anulado_at, m.anulado_motivo
  from movimientos m
  join tipos_movimiento tm on tm.id = m.tipo_movimiento
  left join establecimientos eo on eo.id = m.establecimiento_origen
  left join establecimientos ed on ed.id = m.establecimiento_destino
  left join categorias co on co.id = m.categoria_origen
  left join categorias cd on cd.id = m.categoria_destino
  left join perfiles p on p.user_id = m.usuario_id
  order by m.fecha desc, m.created_at desc;

-- ─── RLS ────────────────────────────────────────────────────────────────

alter table perfiles enable row level security;
alter table establecimientos enable row level security;
alter table categorias enable row level security;
alter table tipos_movimiento enable row level security;
alter table movimientos enable row level security;

create or replace function rol_actual() returns text
language sql security definer stable as
  $$ select rol from perfiles where user_id = auth.uid() $$;

create policy perfiles_select on perfiles for select to authenticated using (true);
create policy perfiles_update_self on perfiles for update to authenticated using (user_id = auth.uid());

create policy lookup_select_establecimientos on establecimientos for select to authenticated using (true);
create policy lookup_select_categorias on categorias for select to authenticated using (true);
create policy lookup_select_tipos_movimiento on tipos_movimiento for select to authenticated using (true);

create policy movimientos_select on movimientos for select to authenticated using (true);

create policy movimientos_insert on movimientos for insert to authenticated
  with check (
    usuario_id = auth.uid()
    and rol_actual() in ('encargado', 'administrativo', 'owner')
  );

create policy movimientos_anular on movimientos for update to authenticated
  using (
    rol_actual() in ('administrativo', 'owner')
    or (usuario_id = auth.uid() and created_at > now() - interval '48 hours')
  )
  with check (true);

-- ─── Después de correr este script ──────────────────────────────────────
-- 1. Crear los usuarios reales en Authentication > Users (email + password).
-- 2. Por cada uno, insertar su fila en perfiles, por ejemplo:
--    insert into perfiles (user_id, nombre_completo, rol) values
--      ('<uuid-del-usuario>', 'Juan Uranga', 'owner');
-- 3. Cargar el stock físico actual como movimientos "apertura_stock" desde la app.
