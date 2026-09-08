-- 018: Agrega la categoría "Vaca" (faltaba la hembra adulta — ya estaban
-- Ternero/a, Vaquillona, Novillito/o y Torito/Toro, pero no Vaca).

insert into categorias (id, nombre, orden) values ('vaca', 'Vaca', 8);

-- Verificación
select * from categorias order by orden;
