-- Migración: Feed Lot — corrales + ciclo (Hacienda M5)
-- Correr completo en el SQL Editor de Supabase.

-- rodeos ya tenía la columna "corral" desde M2, pero nunca se agregó el
-- permiso para actualizarla (el corral se asigna/limpia al entrar/salir
-- de feed lot).
create policy rodeos_update on rodeos for update to authenticated
  using (rol_actual() in ('encargado', 'administrativo', 'owner'));

create table feed_lot_ciclos (
  id uuid primary key default gen_random_uuid(),
  rodeo_id uuid not null references rodeos(id),
  fecha_ingreso date not null,
  kilos_ingreso numeric,
  fecha_estimada_salida date,
  kilos_salida_objetivo numeric,
  fecha_salida_real date,
  kilos_salida_real numeric,
  activo boolean not null default true,
  creado_at timestamptz not null default now()
);

create index on feed_lot_ciclos (rodeo_id);
create index on feed_lot_ciclos (activo) where activo = true;

alter table feed_lot_ciclos enable row level security;

create policy feed_lot_ciclos_select on feed_lot_ciclos for select to authenticated using (true);
create policy feed_lot_ciclos_insert on feed_lot_ciclos for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));
create policy feed_lot_ciclos_update on feed_lot_ciclos for update to authenticated
  using (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- Verificación
select count(*) from feed_lot_ciclos;
