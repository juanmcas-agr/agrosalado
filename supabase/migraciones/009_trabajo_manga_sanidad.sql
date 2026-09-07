-- Milestone 9: Trabajo de Manga — Sanidad.
-- Catálogos con alta on-the-fly (droga, vacunas reproductivas, otras
-- sanidades) + tabla 1-a-1 trabajo_manga_sanidad (desparasitada/droga,
-- cobre, aftosa, brucelosis, carbunclo) + tablas de unión para selección
-- múltiple de vacunas/otras sanidades.
-- Requiere haber corrido 003 a 008 antes.

create table catalogo_drogas (id text primary key, nombre text not null, activo boolean not null default true);
create table catalogo_vacunas_reproductivas (id text primary key, nombre text not null, activo boolean not null default true);
create table catalogo_otras_sanidades (id text primary key, nombre text not null, activo boolean not null default true);

create table trabajo_manga_sanidad (
  trabajo_manga_id uuid primary key references trabajos_manga(id) on delete cascade,
  desparasitada boolean not null default false,
  droga_id text references catalogo_drogas(id),
  cobre boolean not null default false,
  aftosa boolean not null default false,
  brucelosis boolean not null default false,
  carbunclo boolean not null default false
);

create table trabajo_manga_vacunas (
  trabajo_manga_id uuid references trabajos_manga(id) on delete cascade,
  vacuna_id text references catalogo_vacunas_reproductivas(id),
  primary key (trabajo_manga_id, vacuna_id)
);
create table trabajo_manga_otras_sanidades (
  trabajo_manga_id uuid references trabajos_manga(id) on delete cascade,
  sanidad_id text references catalogo_otras_sanidades(id),
  primary key (trabajo_manga_id, sanidad_id)
);

alter table catalogo_drogas enable row level security;
alter table catalogo_vacunas_reproductivas enable row level security;
alter table catalogo_otras_sanidades enable row level security;
alter table trabajo_manga_sanidad enable row level security;
alter table trabajo_manga_vacunas enable row level security;
alter table trabajo_manga_otras_sanidades enable row level security;

create policy catalogo_drogas_select on catalogo_drogas for select to authenticated using (true);
create policy catalogo_drogas_insert on catalogo_drogas for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy catalogo_vacunas_reproductivas_select on catalogo_vacunas_reproductivas for select to authenticated using (true);
create policy catalogo_vacunas_reproductivas_insert on catalogo_vacunas_reproductivas for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy catalogo_otras_sanidades_select on catalogo_otras_sanidades for select to authenticated using (true);
create policy catalogo_otras_sanidades_insert on catalogo_otras_sanidades for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy trabajo_manga_sanidad_select on trabajo_manga_sanidad for select to authenticated using (true);
create policy trabajo_manga_sanidad_insert on trabajo_manga_sanidad for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy trabajo_manga_vacunas_select on trabajo_manga_vacunas for select to authenticated using (true);
create policy trabajo_manga_vacunas_insert on trabajo_manga_vacunas for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy trabajo_manga_otras_sanidades_select on trabajo_manga_otras_sanidades for select to authenticated using (true);
create policy trabajo_manga_otras_sanidades_insert on trabajo_manga_otras_sanidades for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- Verificación
select 'catalogo_drogas' as tabla, count(*) from catalogo_drogas
union all select 'catalogo_vacunas_reproductivas', count(*) from catalogo_vacunas_reproductivas
union all select 'catalogo_otras_sanidades', count(*) from catalogo_otras_sanidades
union all select 'trabajo_manga_sanidad', count(*) from trabajo_manga_sanidad;
