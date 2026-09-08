-- 017: Índices reproductivos de Hacienda (M8 del plan de Reportes/Índices)
--
-- Tabla genérica para todos los índices reproductivos (vacas en servicio,
-- preñadas, parición, y los que se agreguen a futuro vía config del
-- cliente, sin migración nueva). "corroborado" es lo que hace reaparecer
-- el cartel de recordatorio el día del gatillo aunque el índice ya tenga
-- un valor cargado de antes.

create table indices_valores (
  id uuid primary key default gen_random_uuid(),
  tipo_indice text not null,
  anio int not null,
  fecha_gatillo date not null,
  valor_principal numeric not null,
  valor_secundario numeric,
  unidad_secundaria text,
  observaciones text,
  cargado_por uuid not null references auth.users(id),
  cargado_at timestamptz not null default now(),
  corroborado boolean not null default false,
  corroborado_por uuid references auth.users(id),
  corroborado_at timestamptz,
  unique (tipo_indice, anio)
);

alter table indices_valores enable row level security;

create policy indices_valores_select on indices_valores for select to authenticated using (true);
create policy indices_valores_insert on indices_valores for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner') and cargado_por = auth.uid());
create policy indices_valores_update on indices_valores for update to authenticated
  using (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- Verificación
select count(*) as tabla_indices_valores_creada from indices_valores;
