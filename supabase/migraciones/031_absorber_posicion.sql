-- 031: "Absorber posición" en Granos > Posición — el owner puede marcar
-- que una parte (o todo) del saldo libre de una compra cerrada queda
-- absorbida por la empresa, sin necesidad de asignarla a una venta real.
-- A diferencia de asignaciones_compra_venta, esto NO toca el lado de
-- ventas: el total "comprado" del resumen por cereal sigue contando esa
-- compra entera (la posición sigue "a favor" de la empresa), solo deja
-- de figurar como saldo pendiente/libre esperando una venta.
create table absorciones_posicion (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references negocios_historial(id) on delete cascade,
  toneladas numeric not null check (toneladas > 0),
  usuario_id uuid not null references auth.users(id),
  creado_at timestamptz not null default now()
);

alter table absorciones_posicion enable row level security;

create policy absorciones_posicion_select on absorciones_posicion for select to authenticated
  using (rol_actual() = 'owner');
create policy absorciones_posicion_insert on absorciones_posicion for insert to authenticated
  with check (rol_actual() = 'owner' and usuario_id = auth.uid());
create policy absorciones_posicion_delete on absorciones_posicion for delete to authenticated
  using (rol_actual() = 'owner');
