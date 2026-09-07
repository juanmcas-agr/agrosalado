-- AGROSALADO Stock — esquema inicial
-- Ejecutar completo en el SQL Editor de Supabase (proyecto nuevo).

-- ─── Catálogos ──────────────────────────────────────────────────────────

create table establecimientos (
  id text primary key,
  nombre text not null,
  orden int not null,
  activo boolean not null default true
);

insert into establecimientos (id, nombre, orden) values
  ('san_miguel', 'San Miguel', 1),
  ('san_juan', 'San Juan (Las Marianitas)', 2),
  ('feed_lot', 'Feed Lot', 3),
  ('el_tara', 'El Tara', 4);

create table categorias (
  id text primary key,
  nombre text not null,
  orden int not null,
  activo boolean not null default true
);

insert into categorias (id, nombre, orden) values
  ('ternero', 'Ternero', 1),
  ('ternera', 'Ternera', 2),
  ('vaquillona', 'Vaquillona', 3),
  ('novillito', 'Novillito', 4),
  ('novillo', 'Novillo', 5),
  ('torito', 'Torito', 6),
  ('toro', 'Toro', 7);

create table titulares (
  id text primary key,
  nombre text not null,
  tipo text not null check (tipo in ('propio', 'capitalizador')),
  orden int not null default 0,
  activo boolean not null default true
);

insert into titulares (id, nombre, tipo, orden) values
  ('agro_salado', 'Agro Salado', 'propio', 1),
  ('dona_julia', 'Doña Julia', 'propio', 2),
  ('sgro', 'SGRO', 'capitalizador', 3),
  ('cym', 'CYM', 'capitalizador', 4);

create table tipos_movimiento (
  id text primary key,
  nombre text not null,
  clase text not null check (clase in ('entrada', 'salida', 'interna')),
  requiere_establecimiento_origen boolean not null default false,
  requiere_establecimiento_destino boolean not null default false,
  requiere_categoria_origen boolean not null default false,
  requiere_categoria_destino boolean not null default false,
  requiere_titular_origen boolean not null default false,
  requiere_titular_destino boolean not null default false,
  orden int not null
);

insert into tipos_movimiento
  (id, nombre, clase, requiere_establecimiento_origen, requiere_establecimiento_destino, requiere_categoria_origen, requiere_categoria_destino, requiere_titular_origen, requiere_titular_destino, orden) values
  ('compra_invernada',    'Compra de invernada',                'entrada', false, true,  false, true,  false, true,  1),
  ('paricion',            'Parición',                           'entrada', false, true,  false, true,  false, true,  2),
  ('venta_gordo',         'Venta de gordo',                     'salida',  true,  false, true,  false, true,  false, 3),
  ('venta_vaca_prenada',  'Venta de vaca preñada',               'salida',  true,  false, true,  false, true,  false, 4),
  ('venta_invernada',     'Venta de invernada',                 'salida',  true,  false, true,  false, true,  false, 5),
  ('faena_conserva',      'Vaca faena / conserva',              'salida',  true,  false, true,  false, true,  false, 6),
  ('mortandad',           'Mortandad',                          'salida',  true,  false, true,  false, true,  false, 7),
  ('traslado',            'Traslado entre establecimientos',    'interna', true,  true,  true,  true,  true,  true,  8),
  ('cambio_categoria',    'Cambio de categoría',                'interna', true,  true,  true,  true,  true,  true,  9),
  ('cambio_titular',      'Cambio de titularidad',              'interna', true,  true,  true,  true,  true,  true,  10),
  ('apertura_stock',      'Apertura de stock',                  'entrada', false, true,  false, true,  false, true,  11),
  ('cambio_rodeo',        'Cambio de rodeo',                    'interna', true,  true,  true,  true,  true,  true,  12);

-- ─── Rodeos ─────────────────────────────────────────────────────────────
-- Un rodeo es el grupo real de animales que se trackea como unidad (nace,
-- engorda, se mueve de establecimiento, va a feed lot, se vende). Toda la
-- reforma de Hacienda (rodeos/feed lot/trabajo de manga) gira en torno a
-- esto — a partir de ahora todo movimiento de stock exige un rodeo_id.

-- Secuencia del código del rodeo, POR AÑO (reinicia a 01 cada año nuevo).
-- Función atómica (security definer) para que dos altas simultáneas no
-- puedan pisarse el mismo número — mismo criterio que
-- siguiente_numero_orden() de Granos, pero parametrizada por año en vez
-- de una sequence global.
create table rodeo_secuencias (
  anio int primary key,
  ultimo int not null default 0
);

create or replace function siguiente_secuencia_rodeo(p_anio int) returns int
language plpgsql security definer as $$
declare
  v_valor int;
begin
  insert into rodeo_secuencias (anio, ultimo) values (p_anio, 1)
  on conflict (anio) do update set ultimo = rodeo_secuencias.ultimo + 1
  returning ultimo into v_valor;
  return v_valor;
end;
$$;

grant execute on function siguiente_secuencia_rodeo(int) to authenticated;

create table rodeos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  anio int not null,
  secuencia int not null,
  codigo text not null unique,           -- ej. "Vaquillona San Miguel 202601"
  categoria_id text not null references categorias(id),
  establecimiento_id text not null references establecimientos(id),
  corral text check (corral in ('1', '2', '3', '4')),  -- solo aplica en feed_lot
  fecha_creacion date not null default current_date,
  activo boolean not null default true,  -- false cuando el rodeo se vació del todo
  creado_por uuid not null references auth.users(id),
  creado_at timestamptz not null default now()
);

alter table rodeos enable row level security;

create policy rodeos_select on rodeos for select to authenticated using (true);
create policy rodeos_insert on rodeos for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner') and creado_por = auth.uid());
create policy rodeos_update on rodeos for update to authenticated
  using (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- ─── Feed lot ───────────────────────────────────────────────────────────
-- Ciclo de feed lot de un rodeo: se abre cuando el rodeo entra a feed_lot
-- (fecha/kilos de entrada salen del propio movimiento de traslado, fecha
-- estimada de salida y kilos objetivo se cargan a mano en ese momento) y
-- se cierra cuando sale (fecha/kilos reales salen del movimiento que lo
-- saca de feed_lot). rodeos.corral (1-4, ver tabla rodeos) indica dónde
-- está DENTRO de feed lot mientras el ciclo sigue activo.
create table feed_lot_ciclos (
  id uuid primary key default gen_random_uuid(),
  rodeo_id uuid not null references rodeos(id),
  fecha_ingreso date not null,
  kilos_ingreso numeric,
  fecha_estimada_salida date,
  kilos_salida_objetivo numeric,
  fecha_salida_real date,
  kilos_salida_real numeric,
  activo boolean not null default true,
  creado_at timestamptz not null default now()
);

create index on feed_lot_ciclos (rodeo_id);
create index on feed_lot_ciclos (activo) where activo = true;

alter table feed_lot_ciclos enable row level security;

create policy feed_lot_ciclos_select on feed_lot_ciclos for select to authenticated using (true);
create policy feed_lot_ciclos_insert on feed_lot_ciclos for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));
create policy feed_lot_ciclos_update on feed_lot_ciclos for update to authenticated
  using (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- ─── Trabajo de Manga ───────────────────────────────────────────────────
-- Bitácora de trabajo sobre un rodeo — NO es un movimiento de stock (no
-- mueve cabezas), salvo Destete (M11), que sí dispara movimientos reales
-- de cambio_categoria además de guardar acá. cantidad_trabajada se compara
-- contra el stock real del rodeo al cargarlo; si no coincide se guarda
-- diferencia_pendiente=true (alerta, no bloquea) — se resuelve sola
-- cuando el stock de ese rodeo vuelve a coincidir tras un movimiento real
-- (ver trigger resolver_diferencia_manga más abajo), no a mano.
create table trabajos_manga (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  rodeo_id uuid not null references rodeos(id),
  categoria_id text not null references categorias(id),
  cantidad_trabajada int not null check (cantidad_trabajada > 0),
  stock_al_momento int not null,
  diferencia_pendiente boolean not null default false,
  usuario_id uuid not null references auth.users(id),
  observaciones text,
  creado_at timestamptz not null default now()
);

create index on trabajos_manga (rodeo_id);
create index on trabajos_manga (diferencia_pendiente) where diferencia_pendiente = true;

create table trabajo_manga_propietarios (
  trabajo_manga_id uuid references trabajos_manga(id) on delete cascade,
  titular_id text references titulares(id),
  primary key (trabajo_manga_id, titular_id)
);

alter table trabajos_manga enable row level security;
alter table trabajo_manga_propietarios enable row level security;

create policy trabajos_manga_select on trabajos_manga for select to authenticated using (true);
create policy trabajos_manga_insert on trabajos_manga for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner') and usuario_id = auth.uid());

create policy trabajo_manga_propietarios_select on trabajo_manga_propietarios for select to authenticated using (true);
create policy trabajo_manga_propietarios_insert on trabajo_manga_propietarios for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- Tras cualquier movimiento, si el rodeo involucrado (origen y/o destino)
-- tiene un trabajo de manga con diferencia pendiente cuya cantidad ya
-- coincide con el stock real, se marca resuelta sola.
create or replace function resolver_diferencia_manga() returns trigger
language plpgsql as $$
declare
  v_rodeo_id uuid;
  v_stock int;
begin
  for v_rodeo_id in
    select distinct rid from (values (new.rodeo_id), (new.rodeo_destino_id)) as t(rid) where rid is not null
  loop
    select coalesce(sum(cabezas), 0) into v_stock from stock_actual where rodeo_id = v_rodeo_id;
    update trabajos_manga
      set diferencia_pendiente = false
      where rodeo_id = v_rodeo_id and diferencia_pendiente = true and cantidad_trabajada = v_stock;
  end loop;
  return new;
end;
$$;

create trigger trg_resolver_diferencia_manga
  after insert on movimientos
  for each row execute function resolver_diferencia_manga();

-- ─── Trabajo de Manga: Sanidad ──────────────────────────────────────────
-- Catálogos con alta on-the-fly (mismo patrón que titulares): id text
-- slug, nombre, activo. catalogo_toros es de M10 (Reproducción), no acá.
create table catalogo_drogas (id text primary key, nombre text not null, activo boolean not null default true);
create table catalogo_vacunas_reproductivas (id text primary key, nombre text not null, activo boolean not null default true);
create table catalogo_otras_sanidades (id text primary key, nombre text not null, activo boolean not null default true);

-- 1-a-1 con trabajos_manga: solo existe si el checkbox "Sanidad" se tildó.
create table trabajo_manga_sanidad (
  trabajo_manga_id uuid primary key references trabajos_manga(id) on delete cascade,
  desparasitada boolean not null default false,
  droga_id text references catalogo_drogas(id),
  cobre boolean not null default false,
  aftosa boolean not null default false,
  brucelosis boolean not null default false,
  carbunclo boolean not null default false
);

-- Selección múltiple (varias vacunas/otras sanidades a la vez).
create table trabajo_manga_vacunas (
  trabajo_manga_id uuid references trabajos_manga(id) on delete cascade,
  vacuna_id text references catalogo_vacunas_reproductivas(id),
  primary key (trabajo_manga_id, vacuna_id)
);
create table trabajo_manga_otras_sanidades (
  trabajo_manga_id uuid references trabajos_manga(id) on delete cascade,
  sanidad_id text references catalogo_otras_sanidades(id),
  primary key (trabajo_manga_id, sanidad_id)
);

alter table catalogo_drogas enable row level security;
alter table catalogo_vacunas_reproductivas enable row level security;
alter table catalogo_otras_sanidades enable row level security;
alter table trabajo_manga_sanidad enable row level security;
alter table trabajo_manga_vacunas enable row level security;
alter table trabajo_manga_otras_sanidades enable row level security;

create policy catalogo_drogas_select on catalogo_drogas for select to authenticated using (true);
create policy catalogo_drogas_insert on catalogo_drogas for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy catalogo_vacunas_reproductivas_select on catalogo_vacunas_reproductivas for select to authenticated using (true);
create policy catalogo_vacunas_reproductivas_insert on catalogo_vacunas_reproductivas for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy catalogo_otras_sanidades_select on catalogo_otras_sanidades for select to authenticated using (true);
create policy catalogo_otras_sanidades_insert on catalogo_otras_sanidades for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy trabajo_manga_sanidad_select on trabajo_manga_sanidad for select to authenticated using (true);
create policy trabajo_manga_sanidad_insert on trabajo_manga_sanidad for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy trabajo_manga_vacunas_select on trabajo_manga_vacunas for select to authenticated using (true);
create policy trabajo_manga_vacunas_insert on trabajo_manga_vacunas for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy trabajo_manga_otras_sanidades_select on trabajo_manga_otras_sanidades for select to authenticated using (true);
create policy trabajo_manga_otras_sanidades_insert on trabajo_manga_otras_sanidades for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- ─── Perfiles (roles de usuario) ────────────────────────────────────────

create table perfiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text not null,
  email text,
  rol text not null check (rol in ('encargado', 'administrativo', 'owner')),
  -- Un owner siempre tiene acceso total (ver el gate de cada app); estas
  -- casillas solo importan para encargado/administrativo.
  acceso_hacienda boolean not null default true,
  acceso_granos boolean not null default false,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─── Movimientos ────────────────────────────────────────────────────────

create table movimientos (
  id uuid primary key,
  tipo_movimiento text not null references tipos_movimiento(id),
  fecha date not null,
  establecimiento_origen text references establecimientos(id),
  establecimiento_destino text references establecimientos(id),
  categoria_origen text references categorias(id),
  categoria_destino text references categorias(id),
  titular_origen text references titulares(id),
  titular_destino text references titulares(id),
  cantidad_cabezas integer not null check (cantidad_cabezas > 0),
  kilos_promedio numeric(6,2) not null check (kilos_promedio > 0),
  usuario_id uuid not null references auth.users(id),
  rodeo_id uuid not null references rodeos(id),
  -- Solo se usa en 'cambio_rodeo': mover animales de un rodeo a otro sin
  -- cambiar establecimiento/categoría/titular (ej. separar un lote para
  -- curarlo aparte). Para el resto de los tipos queda null.
  rodeo_destino_id uuid references rodeos(id),
  observaciones text,
  created_at timestamptz not null default now(),
  anulado boolean not null default false,
  anulado_por uuid references auth.users(id),
  anulado_at timestamptz,
  anulado_motivo text,
  -- Editar ≠ anular: "Editar" en el historial crea un movimiento nuevo con
  -- los datos corregidos y deja ESTE marcado como reemplazado (tachado en
  -- el historial, no confundir con "Anulado" — el movimiento sí existió y
  -- afectó el stock hasta que se corrigió). reemplazado_por/editado_de son
  -- inversos entre sí: el viejo apunta al nuevo, el nuevo apunta al viejo.
  reemplazado_por uuid references movimientos(id),
  editado_de uuid references movimientos(id)
);
-- Nota: "id" no tiene default — lo genera el cliente (crypto.randomUUID())
-- para que los reintentos de sincronización offline sean idempotentes.

create index on movimientos (fecha);
create index on movimientos (usuario_id);
create index on movimientos (anulado) where anulado = false;

-- ─── Validación server-side ─────────────────────────────────────────────

create or replace function validar_movimiento() returns trigger
language plpgsql as $$
declare
  t tipos_movimiento;
begin
  select * into t from tipos_movimiento where id = new.tipo_movimiento;
  if t is null then
    raise exception 'Tipo de movimiento inválido: %', new.tipo_movimiento;
  end if;

  if t.requiere_establecimiento_origen and new.establecimiento_origen is null then
    raise exception 'Falta establecimiento_origen para %', new.tipo_movimiento;
  end if;
  if not t.requiere_establecimiento_origen and new.establecimiento_origen is not null then
    raise exception 'establecimiento_origen no corresponde para %', new.tipo_movimiento;
  end if;

  if t.requiere_establecimiento_destino and new.establecimiento_destino is null then
    raise exception 'Falta establecimiento_destino para %', new.tipo_movimiento;
  end if;
  if not t.requiere_establecimiento_destino and new.establecimiento_destino is not null then
    raise exception 'establecimiento_destino no corresponde para %', new.tipo_movimiento;
  end if;

  if t.requiere_categoria_origen and new.categoria_origen is null then
    raise exception 'Falta categoria_origen para %', new.tipo_movimiento;
  end if;
  if not t.requiere_categoria_origen and new.categoria_origen is not null then
    raise exception 'categoria_origen no corresponde para %', new.tipo_movimiento;
  end if;

  if t.requiere_categoria_destino and new.categoria_destino is null then
    raise exception 'Falta categoria_destino para %', new.tipo_movimiento;
  end if;
  if not t.requiere_categoria_destino and new.categoria_destino is not null then
    raise exception 'categoria_destino no corresponde para %', new.tipo_movimiento;
  end if;

  if t.requiere_titular_origen and new.titular_origen is null then
    raise exception 'Falta titular_origen para %', new.tipo_movimiento;
  end if;
  if not t.requiere_titular_origen and new.titular_origen is not null then
    raise exception 'titular_origen no corresponde para %', new.tipo_movimiento;
  end if;

  if t.requiere_titular_destino and new.titular_destino is null then
    raise exception 'Falta titular_destino para %', new.tipo_movimiento;
  end if;
  if not t.requiere_titular_destino and new.titular_destino is not null then
    raise exception 'titular_destino no corresponde para %', new.tipo_movimiento;
  end if;

  if new.tipo_movimiento = 'traslado' then
    if new.establecimiento_origen = new.establecimiento_destino then
      raise exception 'En un traslado, establecimiento_origen y destino deben ser distintos';
    end if;
    if new.categoria_origen <> new.categoria_destino then
      raise exception 'En un traslado, la categoría no cambia';
    end if;
    if new.titular_origen <> new.titular_destino then
      raise exception 'En un traslado, la titularidad no cambia (usá "Cambio de titularidad" para eso)';
    end if;
  end if;

  if new.tipo_movimiento = 'cambio_categoria' then
    if new.establecimiento_origen <> new.establecimiento_destino then
      raise exception 'En un cambio de categoría, el establecimiento no cambia';
    end if;
    if new.categoria_origen = new.categoria_destino then
      raise exception 'En un cambio de categoría, la categoría origen y destino deben ser distintas';
    end if;
    if new.titular_origen <> new.titular_destino then
      raise exception 'En un cambio de categoría, la titularidad no cambia';
    end if;
  end if;

  if new.tipo_movimiento = 'cambio_titular' then
    if new.establecimiento_origen <> new.establecimiento_destino then
      raise exception 'En un cambio de titularidad, el establecimiento no cambia';
    end if;
    if new.categoria_origen <> new.categoria_destino then
      raise exception 'En un cambio de titularidad, la categoría no cambia';
    end if;
    if new.titular_origen = new.titular_destino then
      raise exception 'En un cambio de titularidad, la titularidad origen y destino deben ser distintas';
    end if;
  end if;

  if new.tipo_movimiento = 'cambio_rodeo' then
    if new.rodeo_destino_id is null then
      raise exception 'Falta rodeo_destino_id para cambio_rodeo';
    end if;
    if new.rodeo_destino_id = new.rodeo_id then
      raise exception 'En un cambio de rodeo, el rodeo destino tiene que ser distinto del origen';
    end if;
    if new.establecimiento_origen <> new.establecimiento_destino then
      raise exception 'En un cambio de rodeo, el establecimiento no cambia';
    end if;
    if new.categoria_origen <> new.categoria_destino then
      raise exception 'En un cambio de rodeo, la categoría no cambia';
    end if;
    if new.titular_origen <> new.titular_destino then
      raise exception 'En un cambio de rodeo, la titularidad no cambia';
    end if;
  elsif new.rodeo_destino_id is not null then
    raise exception 'rodeo_destino_id no corresponde para %', new.tipo_movimiento;
  end if;

  if new.tipo_movimiento = 'apertura_stock' and rol_actual() <> 'owner' then
    raise exception 'Solo un owner puede cargar una apertura de stock';
  end if;

  if new.fecha > current_date then
    raise exception 'La fecha no puede ser futura';
  end if;

  return new;
end;
$$;

create trigger trg_validar_movimiento
  before insert on movimientos
  for each row execute function validar_movimiento();

-- "Fecha de registro" (created_at) inamovible: ni una actualización
-- (por ejemplo al anular un movimiento) puede cambiarla.
create or replace function bloquear_cambio_created_at() returns trigger
language plpgsql as $$
begin
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger trg_bloquear_created_at
  before update on movimientos
  for each row execute function bloquear_cambio_created_at();

-- Mantiene rodeos.establecimiento_id / categoria_id al día cuando el
-- rodeo se traslada o cambia de categoría — si no, el selector de rodeos
-- de "Cargar movimiento" (que filtra por establecimiento+categoría
-- actuales) dejaría de encontrar un rodeo que ya se movió.
create or replace function actualizar_rodeo_tras_movimiento() returns trigger
language plpgsql as $$
begin
  if new.tipo_movimiento = 'traslado' then
    update rodeos set establecimiento_id = new.establecimiento_destino where id = new.rodeo_id;
  elsif new.tipo_movimiento = 'cambio_categoria' then
    update rodeos set categoria_id = new.categoria_destino where id = new.rodeo_id;
  end if;
  return new;
end;
$$;

create trigger trg_actualizar_rodeo_tras_movimiento
  after insert on movimientos
  for each row execute function actualizar_rodeo_tras_movimiento();

-- ─── Vistas de stock ────────────────────────────────────────────────────

-- coalesce(rodeo_destino_id, rodeo_id) en la rama de destino: para los 11
-- tipos "normales" rodeo_destino_id es null y no cambia nada (destino usa
-- el mismo rodeo que origen); solo 'cambio_rodeo' lo completa, y ahí el
-- lado que ENTRA cabezas debe acreditarse al rodeo nuevo, no al de origen.
create view movimiento_lineas as
  select id, fecha, establecimiento_destino as establecimiento, categoria_destino as categoria,
         coalesce(titular_destino, 'agro_salado') as titular,
         coalesce(rodeo_destino_id, rodeo_id) as rodeo_id,
         cantidad_cabezas as delta_cabezas, kilos_promedio, usuario_id
  from movimientos
  where not anulado and establecimiento_destino is not null
  union all
  select id, fecha, establecimiento_origen as establecimiento, categoria_origen as categoria,
         coalesce(titular_origen, 'agro_salado') as titular, rodeo_id,
         -cantidad_cabezas as delta_cabezas, kilos_promedio, usuario_id
  from movimientos
  where not anulado and establecimiento_origen is not null;
-- Nota: los movimientos previos a la funcionalidad de titularidad no tienen
-- titular cargado; se asumen de Agro Salado (coalesce) para no perder stock
-- en los totales. Si corresponde, se pueden corregir cargando un
-- "Cambio de titularidad" para pasarlos al titular real.

-- Se agrupa hasta el nivel de rodeo (no solo establecimiento/categoría/
-- titular): dashboard.js sigue sumando cabezas por establecimiento+
-- categoría igual que antes (las filas de más son transparentes para ese
-- cálculo), y ahora también puede desagregar por rodeo y mostrar kilos
-- promedio ponderado (sum(cabezas×kilos)/sum(cabezas) de los movimientos
-- que componen el stock, no un dato cargado aparte).
create view stock_actual as
  select
    ml.establecimiento, ml.categoria, ml.titular, ml.rodeo_id, r.codigo as rodeo,
    sum(ml.delta_cabezas) as cabezas,
    case when sum(ml.delta_cabezas) > 0
      then round(sum(ml.delta_cabezas * ml.kilos_promedio) / sum(ml.delta_cabezas), 2)
      else null end as kilos_promedio_ponderado
  from movimiento_lineas ml
  left join rodeos r on r.id = ml.rodeo_id
  group by ml.establecimiento, ml.categoria, ml.titular, ml.rodeo_id, r.codigo;

-- ─── Vista de historial (con etiquetas legibles para la UI) ─────────────

create view historial_movimientos as
  select
    m.id, m.tipo_movimiento, tm.nombre as tipo_movimiento_nombre, tm.clase,
    m.fecha,
    m.establecimiento_origen, eo.nombre as establecimiento_origen_nombre,
    m.establecimiento_destino, ed.nombre as establecimiento_destino_nombre,
    m.categoria_origen, co.nombre as categoria_origen_nombre,
    m.categoria_destino, cd.nombre as categoria_destino_nombre,
    m.titular_origen, tio.nombre as titular_origen_nombre,
    m.titular_destino, tid.nombre as titular_destino_nombre,
    m.cantidad_cabezas, m.kilos_promedio,
    m.rodeo_id, r.codigo as rodeo,
    m.rodeo_destino_id, rd.codigo as rodeo_destino,
    m.observaciones,
    m.usuario_id, p.nombre_completo as usuario_nombre,
    m.created_at, m.anulado, m.anulado_por, m.anulado_at, m.anulado_motivo,
    m.reemplazado_por, m.editado_de
  from movimientos m
  join tipos_movimiento tm on tm.id = m.tipo_movimiento
  left join establecimientos eo on eo.id = m.establecimiento_origen
  left join establecimientos ed on ed.id = m.establecimiento_destino
  left join categorias co on co.id = m.categoria_origen
  left join categorias cd on cd.id = m.categoria_destino
  left join titulares tio on tio.id = m.titular_origen
  left join titulares tid on tid.id = m.titular_destino
  left join rodeos r on r.id = m.rodeo_id
  left join rodeos rd on rd.id = m.rodeo_destino_id
  left join perfiles p on p.user_id = m.usuario_id
  order by m.fecha desc, m.created_at desc;

-- ─── RLS ────────────────────────────────────────────────────────────────

alter table perfiles enable row level security;
alter table establecimientos enable row level security;
alter table categorias enable row level security;
alter table titulares enable row level security;
alter table tipos_movimiento enable row level security;
alter table movimientos enable row level security;

create or replace function rol_actual() returns text
language sql security definer stable as
  $$ select rol from perfiles where user_id = auth.uid() $$;

create policy perfiles_select on perfiles for select to authenticated using (true);
create policy perfiles_update_self on perfiles for update to authenticated using (user_id = auth.uid());

create policy lookup_select_establecimientos on establecimientos for select to authenticated using (true);
create policy lookup_select_categorias on categorias for select to authenticated using (true);
create policy lookup_select_tipos_movimiento on tipos_movimiento for select to authenticated using (true);

create policy titulares_select on titulares for select to authenticated using (true);
create policy titulares_insert on titulares for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy movimientos_select on movimientos for select to authenticated using (true);

create policy movimientos_insert on movimientos for insert to authenticated
  with check (
    usuario_id = auth.uid()
    and rol_actual() in ('encargado', 'administrativo', 'owner')
  );

create policy movimientos_anular on movimientos for update to authenticated
  using (
    rol_actual() in ('administrativo', 'owner')
    or (usuario_id = auth.uid() and created_at > now() - interval '48 hours')
  )
  with check (true);

-- ─── Negocios (app Granos) ───────────────────────────────────────────────
-- Comparte el mismo proyecto/usuarios que Hacienda. Solo owners.

create table negocios_guardados (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  cliente text not null,
  datos jsonb not null,
  creado_at timestamptz not null default now(),
  expira_at timestamptz not null default (now() + interval '40 days')
);

create table negocios_historial (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  cliente text not null,
  numero_orden text,
  fecha_cierre date not null,
  datos jsonb not null,
  created_at timestamptz not null default now()
);

alter table negocios_guardados enable row level security;
alter table negocios_historial enable row level security;

create policy negocios_guardados_select on negocios_guardados for select to authenticated
  using (rol_actual() = 'owner');
create policy negocios_guardados_insert on negocios_guardados for insert to authenticated
  with check (rol_actual() = 'owner' and usuario_id = auth.uid());
create policy negocios_guardados_delete on negocios_guardados for delete to authenticated
  using (rol_actual() = 'owner');

create policy negocios_historial_select on negocios_historial for select to authenticated
  using (rol_actual() = 'owner');
create policy negocios_historial_insert on negocios_historial for insert to authenticated
  with check (rol_actual() = 'owner' and usuario_id = auth.uid());
create policy negocios_historial_update on negocios_historial for update to authenticated
  using (rol_actual() = 'owner');
create policy negocios_historial_delete on negocios_historial for delete to authenticated
  using (rol_actual() = 'owner');

-- Contador global y siempre creciente para el N° de orden de cada
-- alternativa (formato DDDLLLAAHHMM armado en el cliente: DDD+LLL sale
-- de esta secuencia, AA/HH/MM del momento de creación).
create sequence if not exists orden_secuencia_seq;
grant usage on sequence orden_secuencia_seq to authenticated;

create or replace function siguiente_numero_orden() returns bigint
language sql security definer as
  $$ select nextval('orden_secuencia_seq') $$;

grant execute on function siguiente_numero_orden() to authenticated;

-- Contador aparte para los negocios "tipo 2" (internos, sin mail — ver
-- generarCodigoTipo2() en index.html). Formato xxNNNNLL: NNNN es este
-- contador de 4 dígitos (0001-9999) y LL son 2 letras que avanzan una
-- combinación cada vez que NNNN completa la vuelta.
create sequence if not exists orden_secuencia_tipo2_seq;
grant usage on sequence orden_secuencia_tipo2_seq to authenticated;

create or replace function siguiente_numero_orden_tipo2() returns bigint
language sql security definer as
  $$ select nextval('orden_secuencia_tipo2_seq') $$;

grant execute on function siguiente_numero_orden_tipo2() to authenticated;

-- Borradores de VENTA guardados (mismo criterio que negocios_guardados
-- de compra, pero acá "datos" guarda LA LISTA COMPLETA de borradores
-- pendientes de un cierre, no una sola alternativa).
create table negocios_venta_guardados (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  cliente text not null,
  datos jsonb not null,
  creado_at timestamptz not null default now(),
  expira_at timestamptz not null default (now() + interval '40 days')
);

alter table negocios_venta_guardados enable row level security;

create policy negocios_venta_guardados_select on negocios_venta_guardados for select to authenticated
  using (rol_actual() = 'owner');
create policy negocios_venta_guardados_insert on negocios_venta_guardados for insert to authenticated
  with check (rol_actual() = 'owner' and usuario_id = auth.uid());
create policy negocios_venta_guardados_delete on negocios_venta_guardados for delete to authenticated
  using (rol_actual() = 'owner');

-- Negocios de VENTA (pestaña VENTA de Granos): un registro por cada
-- contrato de venta cerrado. A diferencia de negocios_historial (compra,
-- una alternativa elegida por negocio), acá un mismo "cierre" puede
-- insertar varias filas de una vez (uno por cada borrador confirmado),
-- porque un contrato de compra puede repartirse en 0, 1 o varios
-- contratos de venta.
create table negocios_venta_historial (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  cliente_vendedor text not null,
  numero_orden text,
  fecha_cierre date not null default current_date,
  datos jsonb not null,
  created_at timestamptz not null default now()
);

alter table negocios_venta_historial enable row level security;

create policy negocios_venta_historial_select on negocios_venta_historial for select to authenticated
  using (rol_actual() = 'owner');
create policy negocios_venta_historial_insert on negocios_venta_historial for insert to authenticated
  with check (rol_actual() = 'owner' and usuario_id = auth.uid());
create policy negocios_venta_historial_update on negocios_venta_historial for update to authenticated
  using (rol_actual() = 'owner');
create policy negocios_venta_historial_delete on negocios_venta_historial for delete to authenticated
  using (rol_actual() = 'owner');

-- Contador aparte para el N° de orden de VENTA (mismo esquema DDD+LLL+
-- AAHHMM que orden_secuencia_seq, pero independiente para que compra y
-- venta no compartan numeración — ver formatearCodigoVentaDesdeContador
-- en index.html, que además le agrega el prefijo "V").
create sequence if not exists orden_secuencia_venta_seq;
grant usage on sequence orden_secuencia_venta_seq to authenticated;

create or replace function siguiente_numero_orden_venta() returns bigint
language sql security definer as
  $$ select nextval('orden_secuencia_venta_seq') $$;

grant execute on function siguiente_numero_orden_venta() to authenticated;

-- Compradores: lista editable del desplegable "Comprador" en VENTA,
-- mismo patrón que "clientes" (solo nombre, sin mail).
create table compradores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  creado_at timestamptz not null default now()
);
create unique index compradores_nombre_lower_idx on compradores (lower(nombre));

alter table compradores enable row level security;

create policy compradores_select on compradores for select to authenticated
  using (rol_actual() = 'owner');
create policy compradores_insert on compradores for insert to authenticated
  with check (rol_actual() = 'owner');
create policy compradores_update on compradores for update to authenticated
  using (rol_actual() = 'owner');
create policy compradores_delete on compradores for delete to authenticated
  using (rol_actual() = 'owner');

-- Corredores: lista editable del desplegable "Corredor" en VENTA, mismo
-- patrón que "compradores".
create table corredores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  creado_at timestamptz not null default now()
);
create unique index corredores_nombre_lower_idx on corredores (lower(nombre));

alter table corredores enable row level security;

create policy corredores_select on corredores for select to authenticated
  using (rol_actual() = 'owner');
create policy corredores_insert on corredores for insert to authenticated
  with check (rol_actual() = 'owner');
create policy corredores_update on corredores for update to authenticated
  using (rol_actual() = 'owner');
create policy corredores_delete on corredores for delete to authenticated
  using (rol_actual() = 'owner');

-- Posición: cuánto de un negocio de compra ya cerrado está asignado a
-- uno o más negocios de venta cerrados (y viceversa), en toneladas
-- parciales — un contrato de compra puede repartirse en varios de
-- venta y viceversa, no es el vínculo 1 a 1 de "Contrato de compra
-- asociado" (que es solo texto libre, cargado por la cascada al cerrar).
-- "on delete cascade": si se anula la compra o la venta, sus
-- asignaciones se borran solas (no tiene sentido que sobrevivan a un
-- negocio que ya no existe).
create table asignaciones_compra_venta (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references negocios_historial(id) on delete cascade,
  venta_id uuid not null references negocios_venta_historial(id) on delete cascade,
  toneladas numeric not null check (toneladas > 0),
  usuario_id uuid not null references auth.users(id),
  creado_at timestamptz not null default now()
);

alter table asignaciones_compra_venta enable row level security;

create policy asignaciones_compra_venta_select on asignaciones_compra_venta for select to authenticated
  using (rol_actual() = 'owner');
create policy asignaciones_compra_venta_insert on asignaciones_compra_venta for insert to authenticated
  with check (rol_actual() = 'owner' and usuario_id = auth.uid());
create policy asignaciones_compra_venta_delete on asignaciones_compra_venta for delete to authenticated
  using (rol_actual() = 'owner');

-- Clientes: nombre + mail opcional, para autocompletar el campo "Cliente"
-- del formulario y poder mandarles por mail la liquidación cuando se
-- cierra un negocio a su nombre.
create table clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  email text,
  creado_at timestamptz not null default now()
);
create unique index clientes_nombre_lower_idx on clientes (lower(nombre));

alter table clientes enable row level security;

create policy clientes_select on clientes for select to authenticated
  using (rol_actual() = 'owner');
create policy clientes_insert on clientes for insert to authenticated
  with check (rol_actual() = 'owner');
create policy clientes_update on clientes for update to authenticated
  using (rol_actual() = 'owner');
create policy clientes_delete on clientes for delete to authenticated
  using (rol_actual() = 'owner');

-- Destinos "OTROS" que se van cargando desde el desplegable de Destino,
-- con sus km fijos (planta de acopio → destino) para autocompletar Flete
-- Largo. La lista base (Quequén, Rosario Norte/Sur, etc.) vive en
-- DESTINOS_BASE en index.html, no acá — esta tabla solo guarda los que
-- el usuario decide persistir al elegir "OTROS".
create table destinos_km (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  km integer not null,
  creado_at timestamptz not null default now()
);
create unique index destinos_km_nombre_lower_idx on destinos_km (lower(nombre));

alter table destinos_km enable row level security;

create policy destinos_km_select on destinos_km for select to authenticated
  using (rol_actual() = 'owner');
create policy destinos_km_insert on destinos_km for insert to authenticated
  with check (rol_actual() = 'owner');
create policy destinos_km_update on destinos_km for update to authenticated
  using (rol_actual() = 'owner');
create policy destinos_km_delete on destinos_km for delete to authenticated
  using (rol_actual() = 'owner');

-- Destinatarios internos que reciben los avisos de negocio (NUEVA ORDEN /
-- ANULACION). Antes era una lista fija en el código; ahora se administra
-- desde Configuración > Destinatarios de avisos.
create table destinatarios_negocio (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  nombre text,
  -- Qué tipo de avisos recibe cada uno: liquidaciones/anulaciones (Granos),
  -- resumen diario de movimientos de Hacienda, y/o WhatsApp del negocio
  -- cerrado — todos independientes entre sí.
  recibe_liquidaciones boolean not null default true,
  recibe_hacienda boolean not null default false,
  telefono text,
  recibe_whatsapp boolean not null default false,
  creado_at timestamptz not null default now()
);
create unique index destinatarios_negocio_email_lower_idx on destinatarios_negocio (lower(email));

alter table destinatarios_negocio enable row level security;

create policy destinatarios_negocio_select on destinatarios_negocio for select to authenticated
  using (rol_actual() = 'owner');
create policy destinatarios_negocio_insert on destinatarios_negocio for insert to authenticated
  with check (rol_actual() = 'owner');
create policy destinatarios_negocio_update on destinatarios_negocio for update to authenticated
  using (rol_actual() = 'owner');
create policy destinatarios_negocio_delete on destinatarios_negocio for delete to authenticated
  using (rol_actual() = 'owner');

insert into destinatarios_negocio (email, nombre, recibe_liquidaciones, recibe_hacienda) values
  ('braian.papastabru@agrosalado.com', 'Braian', true, false),
  ('facturacion@agrosalado.com', 'Facturación', true, false),
  ('juan.uranga@agrosalado.com', 'Juan Uranga', true, false),
  ('juanmanueluranga@gmail.com', 'Juan Manuel (personal)', false, true)
on conflict do nothing;

-- Incremental para instalaciones ya existentes (correr solo si la tabla
-- destinatarios_negocio ya existía antes de agregar WhatsApp):
--   alter table destinatarios_negocio add column if not exists telefono text;
--   alter table destinatarios_negocio add column if not exists recibe_whatsapp boolean not null default false;

-- ─── $Rel: Precios Relativos ───────────────────────────────────────────

alter table perfiles add column if not exists acceso_precios_relativos boolean not null default false;
alter table destinatarios_negocio add column if not exists recibe_alertas_precios boolean not null default false;

-- Catálogo de los productos trackeados. Espejado en rel/js/config.js (mismo
-- patrón que ESTABLECIMIENTOS/CATEGORIAS en stock/js/config.js) para que la
-- app renderice sin depender de la red al abrir.
create table precios_relativos_productos (
  id text primary key,
  nombre text not null,
  moneda_nativa text not null check (moneda_nativa in ('ARS','USD')),
  unidad text not null,
  origen text not null check (origen in ('automatico','manual')),
  fuente text,
  orden integer not null default 0,
  activo boolean not null default true
);

alter table precios_relativos_productos enable row level security;

create policy precios_relativos_productos_select on precios_relativos_productos for select to authenticated
  using (true);
create policy precios_relativos_productos_insert on precios_relativos_productos for insert to authenticated
  with check (rol_actual() = 'owner');
create policy precios_relativos_productos_update on precios_relativos_productos for update to authenticated
  using (rol_actual() = 'owner');
create policy precios_relativos_productos_delete on precios_relativos_productos for delete to authenticated
  using (rol_actual() = 'owner');

insert into precios_relativos_productos (id, nombre, moneda_nativa, unidad, origen, fuente, orden) values
  ('dolar_bna', 'Dólar Banco Nación', 'ARS', '$/USD', 'automatico', 'tc.js (ArgentinaDatos, oficial)', 1),
  ('dolar_blue', 'Dólar Blue', 'ARS', '$/USD', 'automatico', 'tc.js (ArgentinaDatos, blue)', 2),
  ('soja_ros', 'Soja Rosario', 'ARS', '$/tn', 'automatico', 'pizarra.js (BCR)', 10),
  ('maiz_ros', 'Maíz Rosario', 'ARS', '$/tn', 'automatico', 'pizarra.js (BCR)', 11),
  ('trigo_ros', 'Trigo Rosario', 'ARS', '$/tn', 'automatico', 'pizarra.js (BCR)', 12),
  ('girasol_ros', 'Girasol Rosario', 'ARS', '$/tn', 'automatico', 'pizarra.js (BCR)', 13),
  ('gasoil_g2', 'Gas oil Grado 2', 'ARS', '$/litro', 'automatico', 'scraper-gasoil.js (datos.energia.gob.ar, Pilar/San Pedro)', 20),
  ('novillo', 'Novillo', 'ARS', '$/kg vivo', 'automatico', 'scraper-novillo.js (Mercado Agroganadero)', 30),
  ('ternero', 'Ternero', 'ARS', '$/kg + IVA', 'automatico', 'scraper-invernada.js (deCampoaCampo)', 31),
  ('vaca_prenada', 'Vaca preñada', 'ARS', '$/cabeza + IVA', 'automatico', 'scraper-invernada.js (deCampoaCampo)', 32),
  ('map', 'MAP', 'USD', 'USD/tn', 'manual', 'carga manual', 40),
  ('urea', 'UREA', 'USD', 'USD/tn', 'manual', 'carga manual', 41),
  ('glifosato_48', 'Glifosato liq. 48%', 'USD', 'USD/litro', 'manual', 'carga manual', 42)
on conflict do nothing;

-- Serie histórica: un valor por producto por día, en su moneda nativa.
-- origen_dato distingue scraper automático, carga humana real, o arrastre
-- (LOCF) cuando un producto manual no tuvo carga ese día.
create table precios_relativos_historial (
  id uuid primary key default gen_random_uuid(),
  producto_id text not null references precios_relativos_productos(id),
  fecha date not null,
  valor_nativo numeric not null check (valor_nativo > 0),
  origen_dato text not null check (origen_dato in ('scraper','manual','arrastre')),
  usuario_id uuid references auth.users(id),
  creado_at timestamptz not null default now(),
  unique (producto_id, fecha)
);
create index precios_relativos_historial_fecha_idx on precios_relativos_historial (fecha);

alter table precios_relativos_historial enable row level security;

create policy precios_relativos_historial_select on precios_relativos_historial for select to authenticated
  using (true);
create policy precios_relativos_historial_insert on precios_relativos_historial for insert to authenticated
  with check (rol_actual() in ('encargado','administrativo','owner'));
create policy precios_relativos_historial_update on precios_relativos_historial for update to authenticated
  using (rol_actual() in ('administrativo','owner'));
create policy precios_relativos_historial_delete on precios_relativos_historial for delete to authenticated
  using (rol_actual() = 'owner');
-- Nota: las funciones scheduled (scrapers, snapshot diario, arrastre,
-- backfill) usan SUPABASE_SERVICE_ROLE_KEY y bypassean estas policies —
-- estas solo gobiernan la carga manual desde el cliente.

-- Índices de inflación para moneda constante. tipo='ARS' → IPC INDEC,
-- tipo='USD' → CPI EEUU (serie CPIAUCSL, FRED). Base=100 en el mes de
-- referencia que se elija al popular la tabla.
create table precios_relativos_indices (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('ARS','USD')),
  fecha date not null,
  indice numeric not null,
  creado_at timestamptz not null default now(),
  unique (tipo, fecha)
);

alter table precios_relativos_indices enable row level security;

create policy precios_relativos_indices_select on precios_relativos_indices for select to authenticated
  using (true);
create policy precios_relativos_indices_insert on precios_relativos_indices for insert to authenticated
  with check (rol_actual() = 'owner');
create policy precios_relativos_indices_update on precios_relativos_indices for update to authenticated
  using (rol_actual() = 'owner');

-- Ratios favoritos/alertas: solo hay fila cuando alguien marca un par como
-- favorito y/o le customiza la alerta. Sin fila = se usan los defaults
-- globales de rel/js/config.js. Compartido por todo el equipo, sin
-- personalización por usuario (no hay precedente de eso en el proyecto).
create table precios_relativos_ratios_config (
  id uuid primary key default gen_random_uuid(),
  producto_a_id text not null references precios_relativos_productos(id),
  producto_b_id text not null references precios_relativos_productos(id),
  favorito boolean not null default false,
  alerta_activa boolean not null default false,
  metodo text not null default 'desvio' check (metodo in ('percentil','desvio','ambos')),
  ventana_meses integer not null default 24,
  base text not null default 'nominal_ars' check (base in ('nominal_ars','nominal_usd','real_ars','real_usd')),
  umbral_desvio_pct numeric default 15,
  umbral_percentil_bajo numeric default 10,
  umbral_percentil_alto numeric default 90,
  creado_at timestamptz not null default now(),
  check (producto_a_id < producto_b_id),
  unique (producto_a_id, producto_b_id)
);

alter table precios_relativos_ratios_config enable row level security;

create policy precios_relativos_ratios_config_select on precios_relativos_ratios_config for select to authenticated
  using (true);
create policy precios_relativos_ratios_config_insert on precios_relativos_ratios_config for insert to authenticated
  with check (rol_actual() in ('encargado','administrativo','owner'));
create policy precios_relativos_ratios_config_update on precios_relativos_ratios_config for update to authenticated
  using (rol_actual() in ('encargado','administrativo','owner'));
create policy precios_relativos_ratios_config_delete on precios_relativos_ratios_config for delete to authenticated
  using (rol_actual() in ('encargado','administrativo','owner'));

-- Simulaciones de FLETE (pestaña privada de Granos, solo owner): compara
-- para una misma alternativa de compra/venta cuánto le queda al acopio
-- según a qué destino despache realmente. Todos los campos son editables a
-- mano en la pestaña (ej. si el precio pactado con el productor es el de
-- OTRA alternativa, no el de esta fila). modo_costo elige cómo se calcula
-- el costo de flete: 'pct' (estimación simple, % de flete_corto+flete_largo)
-- o 'rubros' (costo real: flete_costos_rubro × km_corto+km_largo).
-- componentes_costo guarda una foto de los rubros usados en el momento,
-- para que no cambie retroactivamente si después se actualiza
-- flete_costos_rubro.
create table flete_simulaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  origen_codigo text,
  origen_modo text check (origen_modo in ('compra', 'venta', 'manual')),
  cliente text,
  producto text,
  destino text,
  precio_bruto numeric,
  precio_productor numeric,
  km_corto numeric,
  km_largo numeric,
  flete_corto numeric,
  flete_largo numeric,
  desc_corto numeric not null default 0,
  desc_largo numeric not null default 0,
  modo_costo text not null default 'pct' check (modo_costo in ('pct', 'rubros')),
  costo_flete_pct numeric not null default 75,
  componentes_costo jsonb,
  notas text,
  creado_at timestamptz not null default now()
);

alter table flete_simulaciones enable row level security;

create policy flete_simulaciones_select on flete_simulaciones for select to authenticated
  using (rol_actual() = 'owner');
create policy flete_simulaciones_insert on flete_simulaciones for insert to authenticated
  with check (rol_actual() = 'owner' and usuario_id = auth.uid());
create policy flete_simulaciones_update on flete_simulaciones for update to authenticated
  using (rol_actual() = 'owner');
create policy flete_simulaciones_delete on flete_simulaciones for delete to authenticated
  using (rol_actual() = 'owner');

-- Costo real de flete por rubro ($/KM) — historial (no una sola fila fija):
-- cada "Guardar rubros" inserta una fila nueva, para poder comparar en el
-- tiempo qué tan competitiva es la tarifa (guarda el total en ARS y, si
-- hay cotización de dólar disponible en ese momento, también en USD). La
-- pestaña FLETE siempre precarga el último registro como default. Los
-- rubros son los que categoriza la publicación de "Costos del Transporte
-- de Larga Distancia": mano de obra, combustibles, neumáticos,
-- mantenimiento, material rodante, patentes y registros, seguros, gastos
-- generales y costos financieros.
create table flete_costos_rubro_historial (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  -- Mano de obra puede cargarse como valor fijo ($/km) o como % de la
  -- tarifa pagada de cada viaje (default: 16% de la tarifa) — a diferencia
  -- del resto de los rubros, que siempre son $/km fijo.
  mano_obra_modo text not null default 'pct' check (mano_obra_modo in ('fijo', 'pct')),
  mano_obra numeric not null default 16,
  combustibles numeric not null default 0,
  neumaticos numeric not null default 0,
  mantenimiento numeric not null default 0,
  material_rodante numeric not null default 0,
  patentes_registros numeric not null default 0,
  seguros numeric not null default 0,
  gastos_generales numeric not null default 0,
  costos_financieros numeric not null default 0,
  total_ars numeric not null,
  dolar_bna numeric,
  total_usd numeric,
  creado_at timestamptz not null default now()
);

alter table flete_costos_rubro_historial enable row level security;

create policy flete_costos_rubro_historial_select on flete_costos_rubro_historial for select to authenticated
  using (rol_actual() = 'owner');
create policy flete_costos_rubro_historial_insert on flete_costos_rubro_historial for insert to authenticated
  with check (rol_actual() = 'owner' and usuario_id = auth.uid());
create policy flete_costos_rubro_historial_delete on flete_costos_rubro_historial for delete to authenticated
  using (rol_actual() = 'owner');

-- ─── Después de correr este script ──────────────────────────────────────
-- 1. Crear los usuarios reales en Authentication > Users (email + password).
-- 2. Por cada uno, insertar su fila en perfiles, por ejemplo:
--    insert into perfiles (user_id, nombre_completo, rol) values
--      ('<uuid-del-usuario>', 'Juan Uranga', 'owner');
-- 3. Cargar el stock físico actual como movimientos "apertura_stock" desde la app.
