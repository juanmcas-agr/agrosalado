-- 023: esquema de Logística (Milestone 1 del plan) — transportistas
-- (propios y externos), catálogo de camiones, viajes, liquidaciones de
-- externos y cierre mensual de propios.
--
-- Nota de nombres: no se usa el prefijo "flete_" a propósito — ya lo usa
-- el simulador de costos de Granos (flete_simulaciones), sin relación con
-- esto. transportistas NO es parte de perfiles/rol_actual(): es gente
-- externa a la empresa, con su propia función espejo (transportista_actual()).

alter table perfiles add column if not exists acceso_logistica boolean not null default false;
alter table perfiles add column if not exists acceso_logistica_sueldos boolean not null default false;

create table transportistas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text not null,
  email text not null,
  telefono text,
  empresa text,
  cuit text,
  categoria text not null check (categoria in ('propio', 'externo')),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table transportistas enable row level security;

create policy transportistas_select on transportistas for select to authenticated using (
  rol_actual() is not null or user_id = auth.uid()
);

create or replace function transportista_actual() returns uuid
language sql security definer stable as
  $$ select user_id from transportistas where user_id = auth.uid() $$;

create or replace function staff_puede_gestionar_transportista(p_transportista_id uuid) returns boolean
language sql security definer stable as $$
  select
    rol_actual() = 'owner'
    or (rol_actual() is not null and (
      (select categoria from transportistas where user_id = p_transportista_id) = 'externo'
      or (select acceso_logistica_sueldos from perfiles where user_id = auth.uid()) = true
    ));
$$;

create table camiones (
  id uuid primary key default gen_random_uuid(),
  patente text not null unique,
  descripcion text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table camiones enable row level security;

create policy camiones_select on camiones for select to authenticated using (
  rol_actual() is not null or transportista_actual() is not null
);
create policy camiones_insert on camiones for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));
create policy camiones_update on camiones for update to authenticated
  using (rol_actual() in ('encargado', 'administrativo', 'owner'));

create table liquidaciones_transporte (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  transportista_id uuid not null references transportistas(user_id),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'rechazada')),
  enviado_por uuid not null references auth.users(id),
  enviado_at timestamptz not null default now(),
  resuelto_por uuid references auth.users(id),
  resuelto_at timestamptz,
  motivo_rechazo text
);

alter table liquidaciones_transporte enable row level security;

create policy liquidaciones_transporte_select on liquidaciones_transporte for select to authenticated using (
  rol_actual() is not null or transportista_id = transportista_actual()
);
create policy liquidaciones_transporte_insert on liquidaciones_transporte for insert to authenticated
  with check (transportista_id = transportista_actual() and enviado_por = auth.uid());
create policy liquidaciones_transporte_update on liquidaciones_transporte for update to authenticated
  using (rol_actual() in ('administrativo', 'owner'));

create table viajes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default siguiente_codigo('viaje', 'V'),
  transportista_id uuid not null references transportistas(user_id),
  camion_id uuid not null references camiones(id),
  fecha_carga date not null,
  origen text not null,
  destino text not null,
  mercaderia text not null,
  km numeric,
  tn numeric,
  observaciones text,
  carta_porte_path text,
  ticket_pesada_path text,
  liquidacion_id uuid references liquidaciones_transporte(id),
  cargado_por uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index on viajes (transportista_id);
create index on viajes (liquidacion_id);

alter table viajes enable row level security;

create table cierres_periodo_propio (
  id uuid primary key default gen_random_uuid(),
  transportista_id uuid not null references transportistas(user_id),
  anio int not null,
  mes int not null check (mes between 1 and 12),
  cerrado_por uuid not null references auth.users(id),
  cerrado_at timestamptz not null default now(),
  unique (transportista_id, anio, mes)
);

alter table cierres_periodo_propio enable row level security;

create policy cierres_periodo_propio_select on cierres_periodo_propio for select to authenticated using (
  rol_actual() = 'owner'
  or (select acceso_logistica_sueldos from perfiles where user_id = auth.uid()) = true
  or transportista_id = transportista_actual()
);
create policy cierres_periodo_propio_insert on cierres_periodo_propio for insert to authenticated
  with check (
    transportista_id = transportista_actual()
    or rol_actual() = 'owner'
    or (select acceso_logistica_sueldos from perfiles where user_id = auth.uid()) = true
  );
create policy cierres_periodo_propio_delete on cierres_periodo_propio for delete to authenticated
  using (
    rol_actual() = 'owner'
    or (select acceso_logistica_sueldos from perfiles where user_id = auth.uid()) = true
  );

create policy viajes_select_staff on viajes for select to authenticated using (
  staff_puede_gestionar_transportista(transportista_id)
);
create policy viajes_select_dueno on viajes for select to authenticated using (
  transportista_id = transportista_actual()
  and not exists (
    select 1 from cierres_periodo_propio c
    where c.transportista_id = viajes.transportista_id
      and c.anio = extract(year from viajes.fecha_carga)::int
      and c.mes = extract(month from viajes.fecha_carga)::int
  )
);
create policy viajes_insert on viajes for insert to authenticated with check (
  staff_puede_gestionar_transportista(transportista_id)
  or (
    transportista_id = transportista_actual()
    and not exists (
      select 1 from cierres_periodo_propio c
      where c.transportista_id = viajes.transportista_id
        and c.anio = extract(year from viajes.fecha_carga)::int
        and c.mes = extract(month from viajes.fecha_carga)::int
    )
  )
);
create policy viajes_update on viajes for update to authenticated using (
  staff_puede_gestionar_transportista(transportista_id)
  or (
    transportista_id = transportista_actual()
    and (liquidacion_id is null or (select estado from liquidaciones_transporte l where l.id = viajes.liquidacion_id) <> 'aceptada')
    and not exists (
      select 1 from cierres_periodo_propio c
      where c.transportista_id = viajes.transportista_id
        and c.anio = extract(year from viajes.fecha_carga)::int
        and c.mes = extract(month from viajes.fecha_carga)::int
    )
  )
);
create policy viajes_delete on viajes for delete to authenticated using (
  staff_puede_gestionar_transportista(transportista_id)
  or (
    transportista_id = transportista_actual()
    and (liquidacion_id is null or (select estado from liquidaciones_transporte l where l.id = viajes.liquidacion_id) <> 'aceptada')
    and not exists (
      select 1 from cierres_periodo_propio c
      where c.transportista_id = viajes.transportista_id
        and c.anio = extract(year from viajes.fecha_carga)::int
        and c.mes = extract(month from viajes.fecha_carga)::int
    )
  )
);

create view viajes_detalle with (security_invoker = true) as
  select
    v.id, v.codigo, v.fecha_carga, v.origen, v.destino, v.mercaderia, v.km, v.tn, v.observaciones,
    v.transportista_id, t.nombre_completo as transportista_nombre, t.categoria as transportista_categoria,
    v.camion_id, c.patente as camion_patente,
    v.carta_porte_path, v.ticket_pesada_path,
    v.liquidacion_id, lt.codigo as liquidacion_codigo, lt.estado as liquidacion_estado,
    v.cargado_por, p.nombre_completo as cargado_por_nombre,
    v.created_at
  from viajes v
  join transportistas t on t.user_id = v.transportista_id
  join camiones c on c.id = v.camion_id
  left join liquidaciones_transporte lt on lt.id = v.liquidacion_id
  left join perfiles p on p.user_id = v.cargado_por
  order by v.fecha_carga desc, v.created_at desc;

create view liquidaciones_transporte_detalle with (security_invoker = true) as
  select
    lt.id, lt.codigo, lt.estado, lt.transportista_id, t.nombre_completo as transportista_nombre,
    t.email as transportista_email,
    lt.enviado_por, lt.enviado_at, lt.resuelto_por, lt.resuelto_at, lt.motivo_rechazo,
    (select count(*) from viajes v where v.liquidacion_id = lt.id) as cantidad_viajes,
    (select coalesce(sum(v.tn), 0) from viajes v where v.liquidacion_id = lt.id) as total_tn,
    (select coalesce(sum(v.km), 0) from viajes v where v.liquidacion_id = lt.id) as total_km
  from liquidaciones_transporte lt
  join transportistas t on t.user_id = lt.transportista_id
  order by lt.enviado_at desc;

-- Verificación
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename in
    ('transportistas', 'camiones', 'liquidaciones_transporte', 'viajes', 'cierres_periodo_propio')) as tablas_creadas,
  (select count(*) from pg_views where schemaname = 'public' and viewname in
    ('viajes_detalle', 'liquidaciones_transporte_detalle')) as vistas_creadas;
