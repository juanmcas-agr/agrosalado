-- 022: cierra otra parte del mismo agujero que 021 — por default, en
-- Postgres una vista corre con los permisos de quien la CREÓ (en Supabase,
-- un rol que salta la seguridad de fila), no de quien la consulta. Eso
-- significa que, sin esta migración, cualquier autenticado podría seguir
-- leyendo TODO a través de una vista (ej. historial_movimientos) aunque la
-- tabla de base (movimientos) ya esté protegida por la migración 021 — le
-- alcanza con consultar la vista en vez de la tabla.
--
-- El arreglo: marcar cada vista existente para que respete los permisos de
-- quien la consulta (security_invoker). No cambia nada para el personal
-- interno (su RLS ya los deja pasar); cierra el paso para cualquier
-- autenticado sin fila en perfiles.

alter view rectificaciones_pendientes_detalle set (security_invoker = true);
alter view movimiento_lineas set (security_invoker = true);
alter view stock_actual set (security_invoker = true);
alter view historial_movimientos set (security_invoker = true);
alter view historial_trabajos_manga set (security_invoker = true);

-- Verificación: las 5 vistas deberían figurar acá.
select relname, reloptions
from pg_class
where relkind = 'v'
  and relnamespace = 'public'::regnamespace
  and reloptions::text like '%security_invoker=true%';
