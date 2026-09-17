-- 038: corrige un rodeo puntual que quedó sin el dato de "corral" — muy
-- probablemente por una falla de red puntual al cargarlo (ver
-- registrarEntradaFeedLot en stock/js/rodeos.js, es un update best-effort
-- separado del movimiento en sí). Sin este dato, Venta (y cualquier otra
-- salida) desde Feed Lot no puede encontrar el rodeo por corral.
--
-- Update puntual por código, no un fix genérico: si aparecen más rodeos
-- de Feed Lot sin corral en el futuro, es mejor revisarlos uno por uno
-- (para no pisar un corral real con un valor equivocado) que correr un
-- update masivo a ciegas.

update rodeos
set corral = '3'
where codigo = 'Corral 3 Novillito 202606'
  and establecimiento_id = 'feed_lot'
  and corral is null;
