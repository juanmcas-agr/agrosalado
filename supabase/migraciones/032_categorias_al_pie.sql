-- 032: dos categorías nuevas para terneros que todavía están con la
-- madre (recién nacidos, antes del destete) — Parición ahora solo da de
-- alta en una de estas dos (ver stock/js/config.js), no directo en
-- "Ternero"/"Ternera".
insert into categorias (id, nombre, orden) values
  ('ternero_al_pie', 'Ternero al pie', 0),
  ('ternera_al_pie', 'Ternera al pie', 0)
on conflict (id) do nothing;
