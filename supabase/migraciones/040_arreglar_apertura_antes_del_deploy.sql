-- 040: arregla UN movimiento cargado por error entre que se corrió la
-- migración 039 y que el navegador terminó de bajar el código nuevo del
-- rediseño de Feed Lot (la pestaña ya abierta siguió corriendo el JS
-- viejo, que todavía creaba un rodeo por corral+categoría, hasta que se
-- recargó la página) — no es un problema de la migración 039 en sí.
--
-- Efecto: la "Apertura de stock" que creó el rodeo "Corral 3 Novillito
-- 202608" (en vez de usar el Corral n°3 fijo) queda borrada, junto con
-- ese rodeo. Después de correr esto, hay que volver a cargar esa
-- Apertura de stock desde la app (ya actualizada) para que el stock
-- quede en el Corral n°3 real.
--
-- ⚠️ Revisá los datos de más abajo (cabezas, kilos, titular) antes de
-- correrlo — si no coinciden con lo que ves en Historial, avisá en vez
-- de correrlo.

delete from rodeo_pesadas_historial
  where rodeo_id in (select id from rodeos where codigo = 'Corral 3 Novillito 202608');

delete from rectificaciones_pendientes
  where trabajo_manga_id in (
    select id from trabajos_manga
    where rodeo_id in (select id from rodeos where codigo = 'Corral 3 Novillito 202608')
  );

delete from trabajos_manga
  where rodeo_id in (select id from rodeos where codigo = 'Corral 3 Novillito 202608');

-- El código viejo (antes del rediseño) también daba de alta un "ciclo" de
-- Feed Lot (fecha estimada de salida / kilos objetivo) al hacer la
-- Apertura — el rediseño nuevo ya no usa esta tabla para nada, pero el
-- rodeo mal creado sigue teniendo su fila acá, hay que borrarla también.
delete from feed_lot_ciclos
  where rodeo_id in (select id from rodeos where codigo = 'Corral 3 Novillito 202608');

delete from movimientos
  where rodeo_id in (select id from rodeos where codigo = 'Corral 3 Novillito 202608')
     or rodeo_destino_id in (select id from rodeos where codigo = 'Corral 3 Novillito 202608');

delete from rodeos where codigo = 'Corral 3 Novillito 202608';
