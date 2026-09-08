-- Milestone 10: Trabajo de Manga — Reproducción.
-- Catálogo de toros con alta on-the-fly + tabla 1-a-1
-- trabajo_manga_reproduccion (estado corporal, inseminación, tacto,
-- raspaje, ecografía, resincronización) + tabla de unión para los toros
-- usados en la inseminación.
-- Requiere haber corrido 003 a 009 antes.

create table catalogo_toros (id text primary key, nombre text not null, activo boolean not null default true);

create table trabajo_manga_reproduccion (
  trabajo_manga_id uuid primary key references trabajos_manga(id) on delete cascade,
  estado_corporal numeric(3,2) check (estado_corporal between 1 and 5),
  inseminacion boolean not null default false,
  tacto boolean not null default false,
  raspaje boolean not null default false,
  ecografia boolean not null default false,
  resincronizacion boolean not null default false
);

create table trabajo_manga_inseminacion_toros (
  trabajo_manga_id uuid references trabajos_manga(id) on delete cascade,
  toro_id text references catalogo_toros(id),
  primary key (trabajo_manga_id, toro_id)
);

alter table catalogo_toros enable row level security;
alter table trabajo_manga_reproduccion enable row level security;
alter table trabajo_manga_inseminacion_toros enable row level security;

create policy catalogo_toros_select on catalogo_toros for select to authenticated using (true);
create policy catalogo_toros_insert on catalogo_toros for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy trabajo_manga_reproduccion_select on trabajo_manga_reproduccion for select to authenticated using (true);
create policy trabajo_manga_reproduccion_insert on trabajo_manga_reproduccion for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy trabajo_manga_inseminacion_toros_select on trabajo_manga_inseminacion_toros for select to authenticated using (true);
create policy trabajo_manga_inseminacion_toros_insert on trabajo_manga_inseminacion_toros for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- Verificación
select 'catalogo_toros' as tabla, count(*) from catalogo_toros
union all select 'trabajo_manga_reproduccion', count(*) from trabajo_manga_reproduccion
union all select 'trabajo_manga_inseminacion_toros', count(*) from trabajo_manga_inseminacion_toros;
