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

create table tipos_movimiento (
  id text primary key,
  nombre text not null,
  clase text not null check (clase in ('entrada', 'salida', 'interna')),
  requiere_establecimiento_origen boolean not null default false,
  requiere_establecimiento_destino boolean not null default false,
  requiere_categoria_origen boolean not null default false,
  requiere_categoria_destino boolean not null default false,
  requiere_titular_origen boolean not null default false,
  requiere_titular_destino boolean not null default false,
  orden int not null
);

insert into tipos_movimiento
  (id, nombre, clase, requiere_establecimiento_origen, requiere_establecimiento_destino, requiere_categoria_origen, requiere_categoria_destino, requiere_titular_origen, requiere_titular_destino, orden) values
  ('compra_invernada',    'Compra de invernada',                'entrada', false, true,  false, true,  false, true,  1),
  ('paricion',            'Parición',                           'entrada', false, true,  false, true,  false, true,  2),
  ('venta_gordo',         'Venta de gordo',                     'salida',  true,  false, true,  false, true,  false, 3),
  ('venta_vaca_prenada',  'Venta de vaca preñada',               'salida',  true,  false, true,  false, true,  false, 4),
  ('venta_invernada',     'Venta de invernada',                 'salida',  true,  false, true,  false, true,  false, 5),
  ('faena_conserva',      'Vaca faena / conserva',              'salida',  true,  false, true,  false, true,  false, 6),
  ('mortandad',           'Mortandad',                          'salida',  true,  false, true,  false, true,  false, 7),
  ('traslado',            'Traslado entre establecimientos',    'interna', true,  true,  true,  true,  true,  true,  8),
  ('cambio_categoria',    'Cambio de categoría',                'interna', true,  true,  true,  true,  true,  true,  9),
  ('cambio_titular',      'Cambio de titularidad',              'interna', true,  true,  true,  true,  true,  true,  10),
  ('apertura_stock',      'Apertura de stock',                  'entrada', false, true,  false, true,  false, true,  11);

-- ─── Perfiles (roles de usuario) ────────────────────────────────────────

create table perfiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text not null,
  email text,
  rol text not null check (rol in ('encargado', 'administrativo', 'owner')),
  -- Un owner siempre tiene acceso total (ver el gate de cada app); estas
  -- casillas solo importan para encargado/administrativo.
  acceso_hacienda boolean not null default true,
  acceso_granos boolean not null default false,
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
  titular_origen text references titulares(id),
  titular_destino text references titulares(id),
  cantidad_cabezas integer not null check (cantidad_cabezas > 0),
  kilos_promedio numeric(6,2) not null check (kilos_promedio > 0),
  usuario_id uuid not null references auth.users(id),
  rodeo text,
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
-- Nota: los movimientos previos a la funcionalidad de titularidad no tienen
-- titular cargado; se asumen de Agro Salado (coalesce) para no perder stock
-- en los totales. Si corresponde, se pueden corregir cargando un
-- "Cambio de titularidad" para pasarlos al titular real.

create view stock_actual as
  select establecimiento, categoria, titular, sum(delta_cabezas) as cabezas
  from movimiento_lineas
  group by establecimiento, categoria, titular;

-- ─── Vista de historial (con etiquetas legibles para la UI) ─────────────

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

-- ─── RLS ────────────────────────────────────────────────────────────────

alter table perfiles enable row level security;
alter table establecimientos enable row level security;
alter table categorias enable row level security;
alter table titulares enable row level security;
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

create policy titulares_select on titulares for select to authenticated using (true);
create policy titulares_insert on titulares for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

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

-- ─── Negocios (app Granos) ───────────────────────────────────────────────
-- Comparte el mismo proyecto/usuarios que Hacienda. Solo owners.

create table negocios_guardados (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  cliente text not null,
  datos jsonb not null,
  creado_at timestamptz not null default now(),
  expira_at timestamptz not null default (now() + interval '40 days')
);

create table negocios_historial (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  cliente text not null,
  numero_orden text,
  fecha_cierre date not null,
  datos jsonb not null,
  created_at timestamptz not null default now()
);

alter table negocios_guardados enable row level security;
alter table negocios_historial enable row level security;

create policy negocios_guardados_select on negocios_guardados for select to authenticated
  using (rol_actual() = 'owner');
create policy negocios_guardados_insert on negocios_guardados for insert to authenticated
  with check (rol_actual() = 'owner' and usuario_id = auth.uid());
create policy negocios_guardados_delete on negocios_guardados for delete to authenticated
  using (rol_actual() = 'owner');

create policy negocios_historial_select on negocios_historial for select to authenticated
  using (rol_actual() = 'owner');
create policy negocios_historial_insert on negocios_historial for insert to authenticated
  with check (rol_actual() = 'owner' and usuario_id = auth.uid());
create policy negocios_historial_delete on negocios_historial for delete to authenticated
  using (rol_actual() = 'owner');

-- Contador global y siempre creciente para el N° de orden de cada
-- alternativa (formato DDDLLLAAHHMM armado en el cliente: DDD+LLL sale
-- de esta secuencia, AA/HH/MM del momento de creación).
create sequence if not exists orden_secuencia_seq;
grant usage on sequence orden_secuencia_seq to authenticated;

create or replace function siguiente_numero_orden() returns bigint
language sql security definer as
  $$ select nextval('orden_secuencia_seq') $$;

grant execute on function siguiente_numero_orden() to authenticated;

-- Clientes: nombre + mail opcional, para autocompletar el campo "Cliente"
-- del formulario y poder mandarles por mail la liquidación cuando se
-- cierra un negocio a su nombre.
create table clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  email text,
  creado_at timestamptz not null default now()
);
create unique index clientes_nombre_lower_idx on clientes (lower(nombre));

alter table clientes enable row level security;

create policy clientes_select on clientes for select to authenticated
  using (rol_actual() = 'owner');
create policy clientes_insert on clientes for insert to authenticated
  with check (rol_actual() = 'owner');
create policy clientes_update on clientes for update to authenticated
  using (rol_actual() = 'owner');
create policy clientes_delete on clientes for delete to authenticated
  using (rol_actual() = 'owner');

-- Destinatarios internos que reciben los avisos de negocio (NUEVA ORDEN /
-- ANULACION). Antes era una lista fija en el código; ahora se administra
-- desde Configuración > Destinatarios de avisos.
create table destinatarios_negocio (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  nombre text,
  -- Qué tipo de avisos recibe cada uno: liquidaciones/anulaciones (Granos)
  -- y/o el resumen diario de movimientos de Hacienda, independientes.
  recibe_liquidaciones boolean not null default true,
  recibe_hacienda boolean not null default false,
  creado_at timestamptz not null default now()
);
create unique index destinatarios_negocio_email_lower_idx on destinatarios_negocio (lower(email));

alter table destinatarios_negocio enable row level security;

create policy destinatarios_negocio_select on destinatarios_negocio for select to authenticated
  using (rol_actual() = 'owner');
create policy destinatarios_negocio_insert on destinatarios_negocio for insert to authenticated
  with check (rol_actual() = 'owner');
create policy destinatarios_negocio_update on destinatarios_negocio for update to authenticated
  using (rol_actual() = 'owner');
create policy destinatarios_negocio_delete on destinatarios_negocio for delete to authenticated
  using (rol_actual() = 'owner');

insert into destinatarios_negocio (email, nombre, recibe_liquidaciones, recibe_hacienda) values
  ('braian.papastabru@agrosalado.com', 'Braian', true, false),
  ('facturacion@agrosalado.com', 'Facturación', true, false),
  ('juan.uranga@agrosalado.com', 'Juan Uranga', true, false),
  ('juanmanueluranga@gmail.com', 'Juan Manuel (personal)', false, true)
on conflict do nothing;

-- ─── Después de correr este script ──────────────────────────────────────
-- 1. Crear los usuarios reales en Authentication > Users (email + password).
-- 2. Por cada uno, insertar su fila en perfiles, por ejemplo:
--    insert into perfiles (user_id, nombre_completo, rol) values
--      ('<uuid-del-usuario>', 'Juan Uranga', 'owner');
-- 3. Cargar el stock físico actual como movimientos "apertura_stock" desde la app.
