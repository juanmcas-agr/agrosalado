-- 025: Nuevo rol "puestero" en Hacienda.
--
-- Un puestero es un caso más acotado de "encargado": carga movimientos y
-- trabajo de manga (los mismos permisos de escritura que encargado en
-- esas tablas), pero en la app NO ve Stock, Historial ni Reportes (eso
-- se resuelve del lado cliente, en stock/js/router.js — acá solo se
-- habilita lo que necesita para poder cargar datos sin tropezar con la
-- RLS).
--
-- 1) perfiles.rol admite el valor nuevo.
alter table perfiles drop constraint if exists perfiles_rol_check;
alter table perfiles add constraint perfiles_rol_check
  check (rol in ('encargado', 'administrativo', 'owner', 'puestero'));

-- 2) Mismas políticas de escritura que ya tiene "encargado" en las tablas
-- que hacen falta para "Cargar movimiento" y "Trabajo de Manga" (no se
-- toca nada de Reportes, como indices_valores, ni de $Rel/Granos/
-- Logística, que puestero no usa).
alter policy rodeos_insert on rodeos
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero') and creado_por = auth.uid());
alter policy rodeos_update on rodeos
  using (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));

alter policy feed_lot_ciclos_insert on feed_lot_ciclos
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));
alter policy feed_lot_ciclos_update on feed_lot_ciclos
  using (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));

alter policy trabajos_manga_insert on trabajos_manga
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero') and usuario_id = auth.uid());
alter policy trabajos_manga_update on trabajos_manga
  using (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));

alter policy trabajo_manga_propietarios_insert on trabajo_manga_propietarios
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));

alter policy rectificaciones_pendientes_insert on rectificaciones_pendientes
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero') and propuesto_por = auth.uid());

alter policy catalogo_drogas_insert on catalogo_drogas
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));
alter policy catalogo_vacunas_reproductivas_insert on catalogo_vacunas_reproductivas
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));
alter policy catalogo_otras_sanidades_insert on catalogo_otras_sanidades
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));
alter policy trabajo_manga_sanidad_insert on trabajo_manga_sanidad
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));
alter policy trabajo_manga_vacunas_insert on trabajo_manga_vacunas
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));
alter policy trabajo_manga_otras_sanidades_insert on trabajo_manga_otras_sanidades
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));

alter policy catalogo_toros_insert on catalogo_toros
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));
alter policy trabajo_manga_reproduccion_insert on trabajo_manga_reproduccion
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));
alter policy trabajo_manga_inseminacion_toros_insert on trabajo_manga_inseminacion_toros
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));

alter policy trabajo_manga_manejo_insert on trabajo_manga_manejo
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));
alter policy rodeo_pesadas_historial_insert on rodeo_pesadas_historial
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));

alter policy titulares_insert on titulares
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));

alter policy movimientos_insert on movimientos
  with check (usuario_id = auth.uid() and rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));

-- Nota: movimientos_anular no se toca — ya permite anular al creador
-- dentro de las 48hs sin importar el rol (usuario_id = auth.uid()), así
-- que un puestero ya puede corregir lo suyo reciente igual que un
-- encargado.
