-- 045 · Hacienda: los rodeos dejan de tener categoría, y el Trabajo de
-- Manga pasa a anotar cuántas se encerraron y cuántas se trabajaron.
--
-- POR QUÉ
--
-- 1) Un rodeo dejaba de servir apenas tenía dos categorías. Meter los
--    terneros al pie en el rodeo de las vacas era imposible: había que
--    crear un rodeo por categoría, y de ahí salieron los códigos largos
--    ("Vaquillona San Miguel 202601"). El stock real (vista stock_actual)
--    siempre estuvo agrupado por establecimiento + categoría + titular +
--    rodeo, así que la categoría del rodeo nunca hizo falta: era una
--    etiqueta que se quedaba vieja sola. Los 4 corrales de Feed Lot ya
--    viven así desde la migración 039 y no dieron ningún problema.
--
-- 2) Se van las alertas de "diferencia pendiente". Existían porque el
--    trabajo anotaba UNA cantidad trabajada y se la comparaba contra el
--    stock del rodeo: si no coincidía, quedaba una alerta que después
--    alguien tenía que ir a resolver (y si el ingreso se cargaba después
--    del trabajo, saltaban todas juntas). Ahora la diferencia deja de ser
--    una alerta y pasa a ser un dato del propio trabajo: cuántas se
--    encerraron y, de esas, cuántas se trabajaron, por categoría.
--
-- NO BORRA NADA. Los trabajos, movimientos y rodeos que ya existen quedan
-- donde están. Lo único que se pisa es rodeos.categoria_id (paso 1), que
-- a partir de acá no se usa más: la categoría se lee siempre del stock.
--
-- Las tablas rectificaciones_pendientes / rectificaciones_pendientes_detalle
-- quedan en la base tal como están, con lo que tengan adentro — la app
-- deja de usarlas, pero no se borra el historial de aprobaciones.

-- ─── 1) El rodeo ya no tiene categoría ──────────────────────────────────

update rodeos set categoria_id = null where categoria_id is not null;

comment on column rodeos.categoria_id is
  'Sin uso desde la migración 045: un rodeo puede tener varias categorías a la vez. La categoría se lee de stock_actual. La columna queda por compatibilidad.';

-- El código del rodeo pasa a ser el nombre y nada más. Los que ya existen
-- conservan el suyo (se renombran a mano desde Configuración, cuando se
-- quiera); los nuevos nacen sin año ni número correlativo pegado atrás,
-- así que estas dos columnas dejan de completarse.
alter table rodeos alter column anio drop not null;
alter table rodeos alter column secuencia drop not null;

-- El trigger ya no tiene que mantener al día una categoría que no existe.
-- Queda solo la rama de traslado (un rodeo que se muda de establecimiento).
create or replace function actualizar_rodeo_tras_movimiento() returns trigger
language plpgsql as $$
begin
  if new.tipo_movimiento = 'traslado' and new.rodeo_destino_id is null then
    update rodeos set establecimiento_id = new.establecimiento_destino where id = new.rodeo_id;
  end if;
  return new;
end;
$$;

-- ─── 2) Se van las alertas de diferencia ────────────────────────────────

drop trigger if exists trg_resolver_diferencia_manga on movimientos;
drop function if exists resolver_diferencia_manga();

comment on column trabajos_manga.diferencia_pendiente is
  'Sin uso desde la migración 045 (se fueron las alertas de diferencia). Queda en false para los trabajos nuevos; los viejos conservan lo que tenían.';

-- ─── 3) Encerradas y trabajadas, por categoría ──────────────────────────

-- Un trabajo ya no es de UNA categoría: se encierra el rodeo y adentro
-- puede haber vacas y terneros al pie a la vez. El detalle va a la tabla
-- de abajo; en trabajos_manga quedan los totales, para que el historial,
-- los reportes y el Excel sigan leyendo de donde leían.
alter table trabajos_manga alter column categoria_id drop not null;
alter table trabajos_manga alter column cantidad_trabajada drop not null;
alter table trabajos_manga alter column stock_al_momento drop not null;
alter table trabajos_manga add column if not exists cantidad_encerrada int;

comment on column trabajos_manga.cantidad_trabajada is
  'Total trabajadas: suma de trabajo_manga_categorias.trabajadas. El detalle por categoría vive en esa tabla.';
comment on column trabajos_manga.cantidad_encerrada is
  'Total encerradas: suma de trabajo_manga_categorias.encerradas.';

create table if not exists trabajo_manga_categorias (
  trabajo_manga_id uuid not null references trabajos_manga(id) on delete cascade,
  categoria_id text not null references categorias(id),
  encerradas int not null check (encerradas >= 0),
  trabajadas int not null check (trabajadas >= 0),
  primary key (trabajo_manga_id, categoria_id),
  -- No se pueden trabajar más de las que se encerraron.
  constraint trabajadas_no_superan_encerradas check (trabajadas <= encerradas)
);

alter table trabajo_manga_categorias enable row level security;

-- Mismos permisos que trabajo_manga_propietarios (la otra tabla hija):
-- la lee cualquier rol, la carga quien carga trabajos, y solo el owner
-- puede borrar filas (hace falta para reemplazarlas al corregir un
-- trabajo, ver migración 043).
drop policy if exists trabajo_manga_categorias_select on trabajo_manga_categorias;
create policy trabajo_manga_categorias_select on trabajo_manga_categorias for select to authenticated
  using (rol_actual() is not null);
drop policy if exists trabajo_manga_categorias_insert on trabajo_manga_categorias;
create policy trabajo_manga_categorias_insert on trabajo_manga_categorias for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner', 'puestero'));
drop policy if exists trabajo_manga_categorias_delete on trabajo_manga_categorias;
create policy trabajo_manga_categorias_delete on trabajo_manga_categorias for delete to authenticated
  using (rol_actual() = 'owner');

-- ─── 4) La vista, con el dato nuevo ─────────────────────────────────────

-- Estas dos columnas las agrega la migración 043 (editar un trabajo de
-- manga). Si la 043 todavía no se corrió, la vista de abajo no podría
-- crearse — así que se agregan acá también. Si ya existen, no pasa nada.
-- (Ojo: la 043 sigue haciendo falta igual para que ande el botón Editar;
-- esto solo destraba la vista.)
alter table trabajos_manga add column if not exists editado_por uuid references auth.users(id);
alter table trabajos_manga add column if not exists editado_at timestamptz;

drop view if exists historial_trabajos_manga;
create view historial_trabajos_manga with (security_invoker = true) as
  select
    t.id, t.codigo, t.fecha,
    t.rodeo_id, r.codigo as rodeo, r.establecimiento_id,
    t.categoria_id, c.nombre as categoria_nombre,
    t.cantidad_encerrada, t.cantidad_trabajada, t.stock_al_momento, t.diferencia_pendiente,
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
