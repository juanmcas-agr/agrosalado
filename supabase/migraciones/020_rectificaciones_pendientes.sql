-- 020: Aprobación de owner para rectificar la cantidad trabajada cuando
-- lo propone otro rol. El owner sigue pudiendo rectificar directo (no se
-- aprueba a sí mismo) — ver stock/js/trabajoManga.js.

create table rectificaciones_pendientes (
  id uuid primary key default gen_random_uuid(),
  trabajo_manga_id uuid not null references trabajos_manga(id),
  cantidad_anterior int not null,
  cantidad_propuesta int not null,
  propuesto_por uuid not null references auth.users(id),
  propuesto_at timestamptz not null default now(),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  resuelto_por uuid references auth.users(id),
  resuelto_at timestamptz,
  motivo_rechazo text
);

create unique index rectificaciones_pendientes_una_activa
  on rectificaciones_pendientes (trabajo_manga_id) where estado = 'pendiente';

alter table rectificaciones_pendientes enable row level security;

create policy rectificaciones_pendientes_select on rectificaciones_pendientes for select to authenticated using (true);
create policy rectificaciones_pendientes_insert on rectificaciones_pendientes for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner') and propuesto_por = auth.uid());
create policy rectificaciones_pendientes_update on rectificaciones_pendientes for update to authenticated
  using (rol_actual() = 'owner');

create view rectificaciones_pendientes_detalle as
  select
    rp.id, rp.trabajo_manga_id, t.codigo, t.rodeo_id, r.codigo as rodeo,
    rp.cantidad_anterior, rp.cantidad_propuesta,
    rp.propuesto_por, p.nombre_completo as propuesto_nombre, rp.propuesto_at,
    rp.estado, rp.resuelto_por, rp.resuelto_at, rp.motivo_rechazo
  from rectificaciones_pendientes rp
  join trabajos_manga t on t.id = rp.trabajo_manga_id
  left join rodeos r on r.id = t.rodeo_id
  left join perfiles p on p.user_id = rp.propuesto_por
  order by rp.propuesto_at desc;

-- Verificación
select count(*) as tabla_rectificaciones_pendientes_creada from rectificaciones_pendientes;
