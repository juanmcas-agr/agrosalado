-- 035: Logística — el alta de transportistas pasa a preguntar primero
-- "Chofer" (categoria='propio') o "Transportista" (categoria='externo')
-- en vez de "Propio"/"Externo", y en ambos casos pasa a pedir CUIT (antes
-- solo se pedía para externos). El login sigue siendo por email real,
-- como siempre — el CUIT es un dato guardado, no reemplaza al email.

-- No puede haber dos transportistas con el mismo CUIT. Permite null para
-- no romper filas viejas que todavía no lo tengan cargado.
create unique index transportistas_cuit_unique on transportistas (cuit) where cuit is not null;
