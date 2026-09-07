-- Migración: Trabajo de Manga — base (Hacienda M8)
-- Correr completo en el SQL Editor de Supabase.

create table trabajos_manga (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  rodeo_id uuid not null references rodeos(id),
  categoria_id text not null references categorias(id),
  cantidad_trabajada int not null check (cantidad_trabajada > 0),
  stock_al_momento int not null,
  diferencia_pendiente boolean not null default false,
  usuario_id uuid not null references auth.users(id),
  observaciones text,
  creado_at timestamptz not null default now()
);

create index on trabajos_manga (rodeo_id);
create index on trabajos_manga (diferencia_pendiente) where diferencia_pendiente = true;

create table trabajo_manga_propietarios (
  trabajo_manga_id uuid references trabajos_manga(id) on delete cascade,
  titular_id text references titulares(id),
  primary key (trabajo_manga_id, titular_id)
);

alter table trabajos_manga enable row level security;
alter table trabajo_manga_propietarios enable row level security;

create policy trabajos_manga_select on trabajos_manga for select to authenticated using (true);
create policy trabajos_manga_insert on trabajos_manga for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner') and usuario_id = auth.uid());

create policy trabajo_manga_propietarios_select on trabajo_manga_propietarios for select to authenticated using (true);
create policy trabajo_manga_propietarios_insert on trabajo_manga_propietarios for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create or replace function resolver_diferencia_manga() returns trigger
language plpgsql as $$
declare
  v_rodeo_id uuid;
  v_stock int;
begin
  for v_rodeo_id in
    select distinct rid from (values (new.rodeo_id), (new.rodeo_destino_id)) as t(rid) where rid is not null
  loop
    select coalesce(sum(cabezas), 0) into v_stock from stock_actual where rodeo_id = v_rodeo_id;
    update trabajos_manga
      set diferencia_pendiente = false
      where rodeo_id = v_rodeo_id and diferencia_pendiente = true and cantidad_trabajada = v_stock;
  end loop;
  return new;
end;
$$;

create trigger trg_resolver_diferencia_manga
  after insert on movimientos
  for each row execute function resolver_diferencia_manga();

-- Verificación
select count(*) from trabajos_manga;
