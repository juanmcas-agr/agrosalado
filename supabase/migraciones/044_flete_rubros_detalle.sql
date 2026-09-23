-- 044 · Granos > FLETE: guardar CÓMO se calculó el $/km de cada rubro
--
-- Hasta ahora, cada rubro del simulador de flete (neumáticos, combustible,
-- seguros, ...) se cargaba con el $/km ya hecho a mano — que es justo la
-- cuenta que uno no tiene ganas de hacer. Ahora se pueden cargar los datos
-- reales (el precio de la cubierta y cada cuántos km se cambia; el precio
-- del litro y el rendimiento; el gasto de un período y los km de ese
-- período) y la app calcula el $/km sola.
--
-- Las columnas de cada rubro (neumaticos, combustibles, ...) siguen
-- guardando exactamente lo mismo que antes: el $/km final. Esta columna
-- nueva guarda SOLO los datos de la cuenta, para poder reabrirla y
-- corregir un número en vez de rehacerla entera.
--
-- Es una migración aditiva: no borra ni modifica nada de lo ya guardado.
-- Los registros viejos quedan con '{}' y se muestran como estaban, en
-- modo "escribir $/km directo".
--
-- Forma del jsonb, una entrada por rubro:
--   {"neumaticos": {"modo": "unidad", "cantidad": 12, "precio": 850000, "vida_km": 80000},
--    "combustibles": {"modo": "consumo", "precio_litro": 1300, "km_litro": 2.5},
--    "seguros": {"modo": "periodo", "monto": 4000000, "km_periodo": 120000},
--    "mano_obra": {"modo": "pct"}}

alter table flete_costos_rubro_historial
  add column if not exists detalle jsonb not null default '{}'::jsonb;

comment on column flete_costos_rubro_historial.detalle is
  'Cómo se calculó el $/km de cada rubro (modo + datos de la cuenta). El $/km resultante vive en la columna del rubro; esto es solo para poder reabrir y corregir la cuenta.';
