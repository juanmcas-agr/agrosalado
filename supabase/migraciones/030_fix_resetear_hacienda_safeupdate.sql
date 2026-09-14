-- 030: arregla el error "DELETE requires a WHERE clause" de
-- resetear_hacienda() (029). Supabase corre con la extensión
-- pg-safeupdate por default, que rechaza cualquier delete/update sin
-- WHERE — incluso adentro de una función. Cada delete de acá abajo es
-- justamente un borrado de TODO, así que el "where true" es un no-op a
-- propósito, no una condición real.
create or replace function resetear_hacienda() returns void
language plpgsql security definer as $$
begin
  if rol_actual() <> 'owner' then
    raise exception 'Solo un owner puede resetear Hacienda';
  end if;

  delete from rodeo_pesadas_historial where true;
  delete from rectificaciones_pendientes where true;
  delete from trabajos_manga where true;
  delete from movimientos where true;
  delete from feed_lot_ciclos where true;
  delete from rodeos where true;
end;
$$;
