-- 039: Feed Lot deja de organizarse por "rodeo por categoría" y pasa a
-- organizarse por 4 CORRALES FIJOS ("Corral n°1".."Corral n°4"), que
-- siempre existen y pueden tener stock de varias categorías y titulares
-- a la vez (incluida Hotelería, que deja de tener un rodeo propio por
-- lote). Es el rediseño de fondo acordado con Juan tras varios bugs en
-- cadena del modelo anterior (corral sin categoría correcta, rodeo
-- creado de más, corral sin guardar por una falla de red puntual).
--
-- ⚠️ ESTE ARCHIVO BORRA DATOS DE FORMA IRREVERSIBLE (paso 3) — revisalo
-- antes de correrlo. Borra TODO lo de Feed Lot: movimientos, rodeos,
-- trabajos de manga que los referencien, y sus dependencias. El resto de
-- Hacienda (San Miguel, San Juan, El Tara) no se toca.

-- 1) rodeos.categoria_id deja de ser obligatoria: los 4 corrales fijos de
-- Feed Lot no tienen UNA categoría (pueden tener varias a la vez), así
-- que van a vivir con categoria_id = null para siempre. El resto de los
-- rodeos (San Miguel/San Juan/El Tara) la siguen usando normalmente.
alter table rodeos alter column categoria_id drop not null;

-- 2) El trigger que mantiene rodeos.categoria_id al día en un Cambio de
-- categoría deja de tocar los corrales de Feed Lot (para ellos,
-- categoria_id se queda en null para siempre — la categoría real vive en
-- stock_actual, agregada por rodeo+categoría+titular).
create or replace function actualizar_rodeo_tras_movimiento() returns trigger
language plpgsql as $$
begin
  if new.tipo_movimiento = 'traslado' and new.rodeo_destino_id is null then
    update rodeos set establecimiento_id = new.establecimiento_destino where id = new.rodeo_id;
  elsif new.tipo_movimiento = 'cambio_categoria' and new.rodeo_destino_id is null and new.establecimiento_origen <> 'feed_lot' then
    update rodeos set categoria_id = new.categoria_destino where id = new.rodeo_id;
  end if;
  return new;
end;
$$;

-- 3) Borrado de TODO lo de Feed Lot, en el mismo orden que usa
-- resetear_hacienda() (respeta las foreign keys): pesadas de control →
-- rectificaciones pendientes → trabajos de manga → movimientos → ciclos
-- de feed lot → rodeos. Los hijos de trabajos_manga (sanidad/vacunas/
-- reproducción/manejo) se limpian solos vía "on delete cascade".
delete from rodeo_pesadas_historial
  where rodeo_id in (select id from rodeos where establecimiento_id = 'feed_lot');

delete from rectificaciones_pendientes
  where trabajo_manga_id in (
    select id from trabajos_manga
    where rodeo_id in (select id from rodeos where establecimiento_id = 'feed_lot')
  );

delete from trabajos_manga
  where rodeo_id in (select id from rodeos where establecimiento_id = 'feed_lot');

delete from movimientos
  where establecimiento_origen = 'feed_lot' or establecimiento_destino = 'feed_lot';

delete from feed_lot_ciclos
  where rodeo_id in (select id from rodeos where establecimiento_id = 'feed_lot');

delete from rodeos
  where establecimiento_id = 'feed_lot';

-- 4) Los 4 corrales fijos — de acá en más son los ÚNICOS rodeos válidos
-- para cualquier movimiento que toque Feed Lot (de cualquier lado, o
-- Compra/Apertura/Hotelería). El código cliente ya no crea rodeos de
-- Feed Lot nunca, siempre resuelve por corral (ver stock/js/rodeos.js,
-- rodeoDelCorral).
insert into rodeos (nombre, anio, secuencia, codigo, categoria_id, establecimiento_id, corral, creado_por)
select
  'Corral n°' || n,
  extract(year from current_date)::int,
  0,
  'Corral n°' || n,
  null,
  'feed_lot',
  n::text,
  (select user_id from perfiles where rol = 'owner' limit 1)
from generate_series(1, 4) as n;
