-- 021: Retrofit de seguridad (Milestone 0 del plan de Logística) — cierra
-- un agujero real antes de dar de alta cualquier cuenta de transportista.
--
-- Hasta ahora, casi todas las políticas de lectura de este esquema dicen
-- "for select to authenticated using (true)" — cualquier usuario
-- autenticado puede leer la fila. Funcionaba porque la única forma de
-- crear una cuenta autenticada era admin-crear-usuario.js (owner-only,
-- siempre gente de la empresa). Con Logística se empiezan a dar de alta
-- cuentas de transportistas (una tabla aparte, no perfiles) que comparten
-- el mismo proyecto de Supabase — sin este cambio, cualquiera de ellos
-- podría leer directo, con las herramientas del navegador, datos de
-- Hacienda/Granos/$Rel que no le corresponden (el gate de cada app hoy es
-- solo de UI, no de datos).
--
-- El cambio es puramente mecánico: using (true) -> using (rol_actual() is
-- not null). Para el personal interno no cambia nada (siempre tiene una
-- fila en perfiles con un rol). Para cualquier autenticado SIN fila en
-- perfiles (como serán los transportistas), rol_actual() da null y la
-- lectura queda bloqueada.

alter policy rodeos_select on rodeos using (rol_actual() is not null);
alter policy feed_lot_ciclos_select on feed_lot_ciclos using (rol_actual() is not null);
alter policy trabajos_manga_select on trabajos_manga using (rol_actual() is not null);
alter policy trabajo_manga_propietarios_select on trabajo_manga_propietarios using (rol_actual() is not null);
alter policy rectificaciones_pendientes_select on rectificaciones_pendientes using (rol_actual() is not null);
alter policy catalogo_drogas_select on catalogo_drogas using (rol_actual() is not null);
alter policy catalogo_vacunas_reproductivas_select on catalogo_vacunas_reproductivas using (rol_actual() is not null);
alter policy catalogo_otras_sanidades_select on catalogo_otras_sanidades using (rol_actual() is not null);
alter policy trabajo_manga_sanidad_select on trabajo_manga_sanidad using (rol_actual() is not null);
alter policy trabajo_manga_vacunas_select on trabajo_manga_vacunas using (rol_actual() is not null);
alter policy trabajo_manga_otras_sanidades_select on trabajo_manga_otras_sanidades using (rol_actual() is not null);
alter policy catalogo_toros_select on catalogo_toros using (rol_actual() is not null);
alter policy trabajo_manga_reproduccion_select on trabajo_manga_reproduccion using (rol_actual() is not null);
alter policy trabajo_manga_inseminacion_toros_select on trabajo_manga_inseminacion_toros using (rol_actual() is not null);
alter policy trabajo_manga_manejo_select on trabajo_manga_manejo using (rol_actual() is not null);
alter policy rodeo_pesadas_historial_select on rodeo_pesadas_historial using (rol_actual() is not null);
alter policy perfiles_select on perfiles using (rol_actual() is not null);
alter policy lookup_select_establecimientos on establecimientos using (rol_actual() is not null);
alter policy lookup_select_categorias on categorias using (rol_actual() is not null);
alter policy lookup_select_tipos_movimiento on tipos_movimiento using (rol_actual() is not null);
alter policy titulares_select on titulares using (rol_actual() is not null);
alter policy movimientos_select on movimientos using (rol_actual() is not null);
alter policy indices_valores_select on indices_valores using (rol_actual() is not null);
alter policy precios_relativos_productos_select on precios_relativos_productos using (rol_actual() is not null);
alter policy precios_relativos_historial_select on precios_relativos_historial using (rol_actual() is not null);
alter policy precios_relativos_indices_select on precios_relativos_indices using (rol_actual() is not null);
alter policy precios_relativos_ratios_config_select on precios_relativos_ratios_config using (rol_actual() is not null);

-- Verificación: 27 políticas deberían quedar con esta condición.
select count(*) as politicas_retrofitadas
from pg_policies
where schemaname = 'public'
  and cmd = 'r'
  and qual = '(rol_actual() IS NOT NULL)';
