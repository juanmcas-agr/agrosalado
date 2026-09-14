-- 029: función para resetear TODA la información de Hacienda (Panel de
-- Configuración > Zona de peligro, owner-only). Irreversible.
--
-- Se hace como función RPC (security definer) en vez de RLS de delete
-- por tabla: es atómica (todo o nada, una sola llamada) y no hace falta
-- abrir una policy de delete en 6 tablas distintas — el único gate real
-- es el chequeo de rol_actual() = 'owner' de acá adentro (la clave fija
-- que pide el botón del lado cliente es solo un freno contra un click
-- accidental, no una protección real — cualquiera que la vea en el
-- código no gana nada si no es owner: esta función la sigue rechazando).
--
-- Orden de borrado — respeta las foreign keys que NO tienen "on delete
-- cascade" (los hijos de trabajos_manga sí la tienen, se limpian solos):
--   rodeo_pesadas_historial, rectificaciones_pendientes  (hijos sueltos)
--   -> trabajos_manga        (referencia rodeos y movimientos)
--   -> movimientos           (referencia rodeos y a sí misma)
--   -> feed_lot_ciclos       (referencia rodeos)
--   -> rodeos                (ya nada la referencia)
create or replace function resetear_hacienda() returns void
language plpgsql security definer as $$
begin
  if rol_actual() <> 'owner' then
    raise exception 'Solo un owner puede resetear Hacienda';
  end if;

  delete from rodeo_pesadas_historial;
  delete from rectificaciones_pendientes;
  delete from trabajos_manga;
  delete from movimientos;
  delete from feed_lot_ciclos;
  delete from rodeos;
end;
$$;

grant execute on function resetear_hacienda() to authenticated;
