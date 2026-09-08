-- Auditoría de "cómo se resolvió" una diferencia pendiente de Trabajo de
-- Manga (adelanta el M2 del plan de Reportes/Índices, hace falta ya para
-- poder editar la cantidad trabajada) + política UPDATE que faltaba en
-- trabajos_manga (hoy solo tiene select/insert).
--
-- Dos caminos para resolver una diferencia:
--   1) Se carga el movimiento real que la explica -> resolver_diferencia_manga()
--      (trigger existente) la resuelve sola y ahora además deja
--      resuelto_por_movimiento_id apuntando a ese movimiento.
--   2) Se corrige la cantidad_trabajada a mano (típicamente un error de
--      tipeo) -> el cliente hace el UPDATE directo y deja resuelto_at
--      seteado con resuelto_por_movimiento_id en null, para distinguir
--      "se resolvió con un movimiento real" de "se corrigió el número".
--
-- Requiere haber corrido 003 a 014 antes.

alter table trabajos_manga add column resuelto_por_movimiento_id uuid references movimientos(id);
alter table trabajos_manga add column resuelto_at timestamptz;

create policy trabajos_manga_update on trabajos_manga for update to authenticated
  using (rol_actual() in ('encargado', 'administrativo', 'owner'));

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
      set diferencia_pendiente = false,
          resuelto_por_movimiento_id = new.id,
          resuelto_at = now()
      where rodeo_id = v_rodeo_id and diferencia_pendiente = true and cantidad_trabajada = v_stock;
  end loop;
  return new;
end;
$$;

-- Verificación
select column_name from information_schema.columns
  where table_name = 'trabajos_manga' and column_name in ('resuelto_por_movimiento_id', 'resuelto_at');
