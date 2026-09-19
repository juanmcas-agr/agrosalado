-- 043: permite EDITAR un trabajo de manga ya cargado (Reportes > Trabajo
-- de Manga, solo owner).
--
-- La fila de trabajos_manga ya se podía actualizar (trabajos_manga_update),
-- pero sus tablas hijas solo tenían permiso de lectura e inserción. Editar
-- implica reemplazar esas filas (sacar las vacunas que ya no van, cambiar
-- los propietarios, etc.), y sin permiso de borrado el DELETE no falla:
-- simplemente no borra nada, y el trabajo quedaría con los datos viejos y
-- los nuevos mezclados.
--
-- Se limita a owner a propósito, igual que anular: editar permite cambiar
-- la cantidad trabajada, que para los demás roles tiene que pasar sí o sí
-- por el circuito de "rectificación pendiente de aprobación".
--
-- No borra ni cambia datos: solo agrega permisos y dos columnas nuevas.

-- Rastro de la corrección: el resto de la app siempre deja constancia de
-- quién tocó qué (anulado_por, reemplazado_por...), y una edición no
-- debería ser la excepción. usuario_id se mantiene: es quien hizo el
-- trabajo en la manga, no quien lo corrigió después.
alter table trabajos_manga add column if not exists editado_por uuid references auth.users(id);
alter table trabajos_manga add column if not exists editado_at timestamptz;

create policy trabajo_manga_propietarios_delete on trabajo_manga_propietarios
  for delete to authenticated using (rol_actual() = 'owner');

create policy trabajo_manga_sanidad_delete on trabajo_manga_sanidad
  for delete to authenticated using (rol_actual() = 'owner');

create policy trabajo_manga_vacunas_delete on trabajo_manga_vacunas
  for delete to authenticated using (rol_actual() = 'owner');

create policy trabajo_manga_otras_sanidades_delete on trabajo_manga_otras_sanidades
  for delete to authenticated using (rol_actual() = 'owner');

create policy trabajo_manga_reproduccion_delete on trabajo_manga_reproduccion
  for delete to authenticated using (rol_actual() = 'owner');

create policy trabajo_manga_inseminacion_toros_delete on trabajo_manga_inseminacion_toros
  for delete to authenticated using (rol_actual() = 'owner');

create policy trabajo_manga_manejo_delete on trabajo_manga_manejo
  for delete to authenticated using (rol_actual() = 'owner');

-- La pesada de control se carga desde el trabajo de manga y apunta a él,
-- así que al corregir el trabajo hay que poder rehacerla.
create policy rodeo_pesadas_historial_delete on rodeo_pesadas_historial
  for delete to authenticated using (rol_actual() = 'owner');

-- La vista del listado suma las dos columnas nuevas (y el nombre de quien
-- corrigió), para poder mostrar "editado" en Historial y en Reportes.
create or replace view historial_trabajos_manga with (security_invoker = true) as
  select
    t.id, t.codigo, t.fecha,
    t.rodeo_id, r.codigo as rodeo,
    t.categoria_id, c.nombre as categoria_nombre,
    t.cantidad_trabajada, t.stock_al_momento, t.diferencia_pendiente,
    t.usuario_id, p.nombre_completo as usuario_nombre,
    t.observaciones, t.creado_at,
    t.resuelto_por_movimiento_id, mv.codigo as resuelto_por_movimiento_codigo, t.resuelto_at,
    t.anulado, t.anulado_por, t.anulado_at, t.anulado_motivo,
    t.editado_por, t.editado_at, pe.nombre_completo as editado_por_nombre
  from trabajos_manga t
  left join rodeos r on r.id = t.rodeo_id
  left join categorias c on c.id = t.categoria_id
  left join perfiles p on p.user_id = t.usuario_id
  left join perfiles pe on pe.user_id = t.editado_por
  left join movimientos mv on mv.id = t.resuelto_por_movimiento_id
  order by t.fecha desc, t.creado_at desc;
