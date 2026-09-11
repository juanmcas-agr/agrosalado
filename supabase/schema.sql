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
  ('toro', 'Toro', 7),
  ('vaca', 'Vaca', 8);

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

-- Secuencia del código del rodeo, POR AÑO Y NOMBRE (reinicia a 01 cada
-- año nuevo, y cuenta aparte para cada nombre — "San Miguel" 01,02,03...
-- no comparte contador con "San Juan" 01,02,03...). Función atómica
-- (security definer) para que dos altas simultáneas no puedan pisarse
-- el mismo número — mismo criterio que siguiente_numero_orden() de
-- Granos, pero parametrizada por (año, nombre) en vez de una sequence
-- global.
create table rodeo_secuencias (
  anio int not null,
  nombre text not null,
  ultimo int not null default 0,
  primary key (anio, nombre)
);

create or replace function siguiente_secuencia_rodeo(p_anio int, p_nombre text) returns int
language plpgsql security definer as $$
declare
  v_valor int;
begin
  insert into rodeo_secuencias (anio, nombre, ultimo) values (p_anio, p_nombre, 1)
  on conflict (anio, nombre) do update set ultimo = rodeo_secuencias.ultimo + 1
  returning ultimo into v_valor;
  return v_valor;
end;
$$;

grant execute on function siguiente_secuencia_rodeo(int, text) to authenticated;

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

create policy rodeos_select on rodeos for select to authenticated using (rol_actual() is not null);
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

create policy feed_lot_ciclos_select on feed_lot_ciclos for select to authenticated using (rol_actual() is not null);
create policy feed_lot_ciclos_insert on feed_lot_ciclos for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));
create policy feed_lot_ciclos_update on feed_lot_ciclos for update to authenticated
  using (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- ─── Códigos rastreables (movimientos y trabajos_manga) ─────────────────
-- Contador atómico GLOBAL por tipo (no por año como rodeo_secuencias: acá
-- el código es solo un identificador de auditoría para ubicar una carga
-- desde el Historial, no lleva significado como el código del rodeo).
-- Se usa como DEFAULT de columna (no trigger): movimientos se inserta vía
-- upsert(..., { onConflict: 'id', ignoreDuplicates: true }) para que los
-- reintentos de sincronización offline sean idempotentes — un default de
-- columna solo se evalúa cuando la fila efectivamente se inserta (nunca
-- en la rama de conflicto de un reintento), y si validar_movimiento()
-- rechaza la fila, la transacción entera (incluido el contador) se revierte.
create table codigo_secuencias (
  tipo text primary key,
  ultimo bigint not null default 0
);

create or replace function siguiente_codigo(p_tipo text, p_prefijo text) returns text
language plpgsql security definer as $$
declare
  v_valor bigint;
begin
  insert into codigo_secuencias (tipo, ultimo) values (p_tipo, 1)
  on conflict (tipo) do update set ultimo = codigo_secuencias.ultimo + 1
  returning ultimo into v_valor;
  return p_prefijo || '-' || lpad(v_valor::text, 6, '0');
end;
$$;

grant execute on function siguiente_codigo(text, text) to authenticated;

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
  codigo text not null unique default siguiente_codigo('trabajo_manga', 'T'),
  fecha date not null,
  rodeo_id uuid not null references rodeos(id),
  categoria_id text not null references categorias(id),
  cantidad_trabajada int not null check (cantidad_trabajada > 0),
  stock_al_momento int not null,
  diferencia_pendiente boolean not null default false,
  usuario_id uuid not null references auth.users(id),
  observaciones text,
  creado_at timestamptz not null default now(),
  -- Cómo se resolvió una diferencia pendiente: con un movimiento real
  -- (resuelto_por_movimiento_id apunta a él) o corrigiendo la cantidad
  -- trabajada a mano (resuelto_at seteado, resuelto_por_movimiento_id null).
  resuelto_por_movimiento_id uuid references movimientos(id),
  resuelto_at timestamptz,
  -- Anulación (solo owner, ver trabajos_manga_anular más abajo) — mismo
  -- criterio que movimientos: se marca, no se borra, para no perder
  -- trazabilidad de códigos.
  anulado boolean not null default false,
  anulado_por uuid references auth.users(id),
  anulado_at timestamptz,
  anulado_motivo text
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

create policy trabajos_manga_select on trabajos_manga for select to authenticated using (rol_actual() is not null);
create policy trabajos_manga_insert on trabajos_manga for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner') and usuario_id = auth.uid());
create policy trabajos_manga_update on trabajos_manga for update to authenticated
  using (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy trabajo_manga_propietarios_select on trabajo_manga_propietarios for select to authenticated using (rol_actual() is not null);
create policy trabajo_manga_propietarios_insert on trabajo_manga_propietarios for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- Rectificar la cantidad trabajada de una diferencia pendiente requiere
-- aprobación del owner cuando lo propone otro rol (encargado/
-- administrativo) — el owner sigue pudiendo rectificar directo, sin
-- aprobarse a sí mismo (ver stock/js/trabajoManga.js). Solo puede haber
-- una propuesta pendiente a la vez por trabajo (índice único parcial).
create table rectificaciones_pendientes (
  id uuid primary key default gen_random_uuid(),
  trabajo_manga_id uuid not null references trabajos_manga(id),
  cantidad_anterior int not null,
  cantidad_propuesta int not null,
  propuesto_por uuid not null references auth.users(id),
  propuesto_at timestamptz not null default now(),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  resuelto_por uuid references auth.users(id),
  resuelto_at timestamptz,
  motivo_rechazo text
);

create unique index rectificaciones_pendientes_una_activa
  on rectificaciones_pendientes (trabajo_manga_id) where estado = 'pendiente';

alter table rectificaciones_pendientes enable row level security;

create policy rectificaciones_pendientes_select on rectificaciones_pendientes for select to authenticated using (rol_actual() is not null);
create policy rectificaciones_pendientes_insert on rectificaciones_pendientes for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner') and propuesto_por = auth.uid());
create policy rectificaciones_pendientes_update on rectificaciones_pendientes for update to authenticated
  using (rol_actual() = 'owner');

-- Toda vista de este esquema lleva "with (security_invoker = true)": por
-- default, en Postgres una vista corre con los permisos de quien la CREÓ
-- (acá, un rol que salta RLS), no de quien la consulta — sin esta marca,
-- cualquier autenticado podría leer a través de la vista datos que la
-- política RLS de la tabla de base le tendría que estar negando. Con
-- security_invoker=true la vista respeta la RLS de quien pregunta, como
-- corresponde.
--
-- Vista con nombres resueltos, la usa el cartel de "Rectificaciones
-- pendientes de aprobar" en Trabajo de Manga.
create view rectificaciones_pendientes_detalle with (security_invoker = true) as
  select
    rp.id, rp.trabajo_manga_id, t.codigo, t.rodeo_id, r.codigo as rodeo,
    rp.cantidad_anterior, rp.cantidad_propuesta,
    rp.propuesto_por, p.nombre_completo as propuesto_nombre, rp.propuesto_at,
    rp.estado, rp.resuelto_por, rp.resuelto_at, rp.motivo_rechazo
  from rectificaciones_pendientes rp
  join trabajos_manga t on t.id = rp.trabajo_manga_id
  left join rodeos r on r.id = t.rodeo_id
  left join perfiles p on p.user_id = rp.propuesto_por
  order by rp.propuesto_at desc;

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
      set diferencia_pendiente = false,
          resuelto_por_movimiento_id = new.id,
          resuelto_at = now()
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

create policy catalogo_drogas_select on catalogo_drogas for select to authenticated using (rol_actual() is not null);
create policy catalogo_drogas_insert on catalogo_drogas for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy catalogo_vacunas_reproductivas_select on catalogo_vacunas_reproductivas for select to authenticated using (rol_actual() is not null);
create policy catalogo_vacunas_reproductivas_insert on catalogo_vacunas_reproductivas for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy catalogo_otras_sanidades_select on catalogo_otras_sanidades for select to authenticated using (rol_actual() is not null);
create policy catalogo_otras_sanidades_insert on catalogo_otras_sanidades for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy trabajo_manga_sanidad_select on trabajo_manga_sanidad for select to authenticated using (rol_actual() is not null);
create policy trabajo_manga_sanidad_insert on trabajo_manga_sanidad for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy trabajo_manga_vacunas_select on trabajo_manga_vacunas for select to authenticated using (rol_actual() is not null);
create policy trabajo_manga_vacunas_insert on trabajo_manga_vacunas for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy trabajo_manga_otras_sanidades_select on trabajo_manga_otras_sanidades for select to authenticated using (rol_actual() is not null);
create policy trabajo_manga_otras_sanidades_insert on trabajo_manga_otras_sanidades for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- ─── Trabajo de Manga: Reproducción ─────────────────────────────────────
create table catalogo_toros (id text primary key, nombre text not null, activo boolean not null default true);

-- 1-a-1 con trabajos_manga: solo existe si el checkbox "Reproducción" se tildó.
create table trabajo_manga_reproduccion (
  trabajo_manga_id uuid primary key references trabajos_manga(id) on delete cascade,
  estado_corporal numeric(3,2) check (estado_corporal between 1 and 5),
  inseminacion boolean not null default false,
  tacto boolean not null default false,
  raspaje boolean not null default false,
  ecografia boolean not null default false,
  resincronizacion boolean not null default false
);

-- Selección múltiple de toros usados en la inseminación.
create table trabajo_manga_inseminacion_toros (
  trabajo_manga_id uuid references trabajos_manga(id) on delete cascade,
  toro_id text references catalogo_toros(id),
  primary key (trabajo_manga_id, toro_id)
);

alter table catalogo_toros enable row level security;
alter table trabajo_manga_reproduccion enable row level security;
alter table trabajo_manga_inseminacion_toros enable row level security;

create policy catalogo_toros_select on catalogo_toros for select to authenticated using (rol_actual() is not null);
create policy catalogo_toros_insert on catalogo_toros for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy trabajo_manga_reproduccion_select on trabajo_manga_reproduccion for select to authenticated using (rol_actual() is not null);
create policy trabajo_manga_reproduccion_insert on trabajo_manga_reproduccion for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy trabajo_manga_inseminacion_toros_select on trabajo_manga_inseminacion_toros for select to authenticated using (rol_actual() is not null);
create policy trabajo_manga_inseminacion_toros_insert on trabajo_manga_inseminacion_toros for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- ─── Trabajo de Manga: Manejo de rodeo ──────────────────────────────────
-- 1-a-1 con trabajos_manga: solo existe si el checkbox "Manejo de rodeo"
-- se tildó. Destete no es un movimiento en sí (esta tabla es la bitácora),
-- pero SÍ dispara movimientos reales de cambio_categoria (con cambio de
-- rodeo incluido, ver validar_movimiento/actualizar_rodeo_tras_movimiento
-- más arriba) — eso lo hace el cliente, insertando directo en movimientos
-- igual que hace el resto de Trabajo de Manga (todo requiere estar online).
create table trabajo_manga_manejo (
  trabajo_manga_id uuid primary key references trabajos_manga(id) on delete cascade,
  aparte boolean not null default false,
  capada boolean not null default false,
  pesada_control_kilos numeric,
  destete boolean not null default false,
  destete_machos_cantidad int,
  destete_hembras_cantidad int,
  destete_kilos_ternero numeric,
  destete_kilos_ternera numeric
);

-- Pesada de control: guarda evolución del rodeo sin pisar nada (no hay
-- update, cada pesada es una fila nueva).
create table rodeo_pesadas_historial (
  id uuid primary key default gen_random_uuid(),
  rodeo_id uuid not null references rodeos(id),
  fecha date not null,
  kilos_promedio numeric not null,
  trabajo_manga_id uuid references trabajos_manga(id),
  creado_at timestamptz not null default now()
);

alter table trabajo_manga_manejo enable row level security;
alter table rodeo_pesadas_historial enable row level security;

create policy trabajo_manga_manejo_select on trabajo_manga_manejo for select to authenticated using (rol_actual() is not null);
create policy trabajo_manga_manejo_insert on trabajo_manga_manejo for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy rodeo_pesadas_historial_select on rodeo_pesadas_historial for select to authenticated using (rol_actual() is not null);
create policy rodeo_pesadas_historial_insert on rodeo_pesadas_historial for insert to authenticated
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
  codigo text not null unique default siguiente_codigo('movimiento', 'M'),
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
    -- El rodeo destino es opcional: normalmente el cambio de categoría
    -- ocurre dentro del mismo rodeo (rodeo_destino_id null), pero Destete
    -- (Trabajo de Manga > Manejo de rodeo) también cambia de rodeo a la
    -- vez (los terneros/as destetados pasan a su propio rodeo nuevo).
    if new.rodeo_destino_id is not null and new.rodeo_destino_id = new.rodeo_id then
      raise exception 'Si el cambio de categoría también cambia de rodeo, el rodeo destino tiene que ser distinto del origen';
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
    -- El establecimiento SÍ puede cambiar acá (el rodeo destino puede
    -- estar en otro establecimiento) — lo único fijo es categoría y
    -- titularidad, que no cambian en un cambio de rodeo.
    if new.categoria_origen <> new.categoria_destino then
      raise exception 'En un cambio de rodeo, la categoría no cambia';
    end if;
    if new.titular_origen <> new.titular_destino then
      raise exception 'En un cambio de rodeo, la titularidad no cambia';
    end if;
  elsif new.tipo_movimiento <> 'cambio_categoria' and new.rodeo_destino_id is not null then
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
  elsif new.tipo_movimiento = 'cambio_categoria' and new.rodeo_destino_id is null then
    -- Recategorización dentro del mismo rodeo (caso normal). Cuando
    -- rodeo_destino_id no es null (Destete), el rodeo de origen NO cambia
    -- de categoría — solo pierde cabezas hacia el rodeo nuevo, que ya
    -- nace con la categoría correcta (se crea con esa categoría).
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
create view movimiento_lineas with (security_invoker = true) as
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
create view stock_actual with (security_invoker = true) as
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

create view historial_movimientos with (security_invoker = true) as
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
    m.reemplazado_por, m.editado_de,
    m.codigo, mr.codigo as reemplazado_por_codigo, me.codigo as editado_de_codigo
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
  left join movimientos mr on mr.id = m.reemplazado_por
  left join movimientos me on me.id = m.editado_de
  order by m.fecha desc, m.created_at desc;

-- Vista liviana de Trabajo de Manga con nombres resueltos (rodeo,
-- categoría, usuario, y el código del movimiento que resolvió una
-- diferencia pendiente, si corresponde) — la usa el mail diario (M3) y
-- más adelante Reportes > Trabajo de Manga (M5). No suma el detalle de
-- Sanidad/Reproducción/Manejo de cada trabajo, solo los datos base.
create view historial_trabajos_manga with (security_invoker = true) as
  select
    t.id, t.codigo, t.fecha,
    t.rodeo_id, r.codigo as rodeo,
    t.categoria_id, c.nombre as categoria_nombre,
    t.cantidad_trabajada, t.stock_al_momento, t.diferencia_pendiente,
    t.usuario_id, p.nombre_completo as usuario_nombre,
    t.observaciones, t.creado_at,
    t.resuelto_por_movimiento_id, mv.codigo as resuelto_por_movimiento_codigo, t.resuelto_at,
    t.anulado, t.anulado_por, t.anulado_at, t.anulado_motivo
  from trabajos_manga t
  left join rodeos r on r.id = t.rodeo_id
  left join categorias c on c.id = t.categoria_id
  left join perfiles p on p.user_id = t.usuario_id
  left join movimientos mv on mv.id = t.resuelto_por_movimiento_id
  order by t.fecha desc, t.creado_at desc;

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

-- Todas las políticas "for select ... using (true)" de este esquema se
-- cambiaron a "using (rol_actual() is not null)" (mismo efecto para el
-- personal interno — siempre tiene fila en perfiles con un rol — pero
-- bloquea a cualquier autenticado que NO esté en perfiles). Hasta ahora eso
-- no importaba porque la única forma de crear una cuenta autenticada era
-- admin-crear-usuario.js (owner-only, siempre gente de la empresa). Con
-- Logística se empiezan a dar de alta cuentas de transportistas (tabla
-- aparte, no perfiles) que van a compartir el mismo proyecto de Supabase —
-- sin este cambio, cualquiera de ellos podría leer directo, con las
-- herramientas del navegador, datos de Hacienda/Granos/$Rel que no le
-- corresponden (el gate de cada app hoy es solo de UI, no de datos).
create policy perfiles_select on perfiles for select to authenticated using (rol_actual() is not null);
create policy perfiles_update_self on perfiles for update to authenticated using (user_id = auth.uid());

create policy lookup_select_establecimientos on establecimientos for select to authenticated using (rol_actual() is not null);
create policy lookup_select_categorias on categorias for select to authenticated using (rol_actual() is not null);
create policy lookup_select_tipos_movimiento on tipos_movimiento for select to authenticated using (rol_actual() is not null);

create policy titulares_select on titulares for select to authenticated using (rol_actual() is not null);
create policy titulares_insert on titulares for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy movimientos_select on movimientos for select to authenticated using (rol_actual() is not null);

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
  using (rol_actual() is not null);
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
  using (rol_actual() is not null);
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
  using (rol_actual() is not null);
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
  using (rol_actual() is not null);
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

-- ─── Índices reproductivos de Hacienda (M8) ──────────────────────────────
-- Una tabla genérica para todos los índices: qué índices existen, sus
-- fechas gatillo y cómo se calculan vive en la config del cliente
-- (stock/js/indicesConfig.js), no acá. "corroborado" es lo que hace
-- reaparecer el cartel de recordatorio el día del gatillo aunque el
-- índice ya tenga un valor cargado (ver decisión de diseño del plan).
create table indices_valores (
  id uuid primary key default gen_random_uuid(),
  tipo_indice text not null,
  anio int not null,
  fecha_gatillo date not null,
  valor_principal numeric not null,
  valor_secundario numeric,
  unidad_secundaria text,
  observaciones text,
  cargado_por uuid not null references auth.users(id),
  cargado_at timestamptz not null default now(),
  corroborado boolean not null default false,
  corroborado_por uuid references auth.users(id),
  corroborado_at timestamptz,
  unique (tipo_indice, anio)
);

alter table indices_valores enable row level security;

create policy indices_valores_select on indices_valores for select to authenticated using (rol_actual() is not null);
create policy indices_valores_insert on indices_valores for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner') and cargado_por = auth.uid());
create policy indices_valores_update on indices_valores for update to authenticated
  using (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- ─── Logística: viajes de flete (M1) ─────────────────────────────────────
-- App nueva ("logistica/"), hermana de Granos/Hacienda/$Rel. Dos tipos de
-- transportista, cada uno con su propia cuenta de Supabase Auth:
--   - propio: chofer de la empresa. Sus viajes alimentan el pago de sueldo
--     — datos sensibles, gateados por el flag acceso_logistica_sueldos. A
--     fin de mes alguien (el propio chofer, owner, o quien tenga ese flag)
--     "cierra" su mes: a partir de ahí el chofer ya no ve esos viajes, y
--     solo owner + acceso_logistica_sueldos pueden verlos/tocarlos.
--   - externo: transportista tercero que factura. Agrupa viajes propios en
--     una liquidación pendiente ("enviar a liquidar"); administración la
--     acepta (código + mail) o la rechaza (libera los viajes). Mientras la
--     liquidación no esté aceptada, el externo puede seguir editando sus
--     viajes.
-- Nota de nombres: no se usa el prefijo "flete_" a propósito — ya lo usa
-- el simulador de costos de Granos (flete_simulaciones), que no tiene nada
-- que ver con esto.
-- transportistas NO es parte de perfiles/rol_actual(): es gente externa a
-- la empresa (los propios incluidos, en el sentido de "no son personal
-- administrativo/encargado/owner"), con sus propios campos (empresa/CUIT)
-- y su propia función espejo (transportista_actual()), para no arrastrar
-- esa categoría dentro del modelo de roles que ya usan las otras 3 apps.

alter table perfiles add column if not exists acceso_logistica boolean not null default false;
alter table perfiles add column if not exists acceso_logistica_sueldos boolean not null default false;

create table transportistas (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text not null,
  email text not null,
  telefono text,
  empresa text,          -- razón social; null para propios
  cuit text,              -- null para propios
  categoria text not null check (categoria in ('propio', 'externo')),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table transportistas enable row level security;

-- Sin política de insert/update: el alta y la edición se hacen server-side
-- con la service role key (netlify/functions/admin-crear-transportista.js,
-- M2) — mismo criterio que perfiles, que tampoco tiene política de insert.
create policy transportistas_select on transportistas for select to authenticated using (
  rol_actual() is not null or user_id = auth.uid()
);

create or replace function transportista_actual() returns uuid
language sql security definer stable as
  $$ select user_id from transportistas where user_id = auth.uid() $$;

-- Devuelve true si quien pregunta es personal interno con permiso para
-- ver/tocar los viajes de este transportista puntual: cualquier staff para
-- un externo, pero para un propio hace falta ser owner o tener
-- acceso_logistica_sueldos (sus viajes alimentan el sueldo).
create or replace function staff_puede_gestionar_transportista(p_transportista_id uuid) returns boolean
language sql security definer stable as $$
  select
    rol_actual() = 'owner'
    or (rol_actual() is not null and (
      (select categoria from transportistas where user_id = p_transportista_id) = 'externo'
      or (select acceso_logistica_sueldos from perfiles where user_id = auth.uid()) = true
    ));
$$;

-- Catálogo único de camiones — no está atado a un transportista en
-- particular, cualquiera elige de la misma lista al cargar un viaje.
create table camiones (
  id uuid primary key default gen_random_uuid(),
  patente text not null unique,
  descripcion text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table camiones enable row level security;

create policy camiones_select on camiones for select to authenticated using (
  rol_actual() is not null or transportista_actual() is not null
);
create policy camiones_insert on camiones for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));
create policy camiones_update on camiones for update to authenticated
  using (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- Liquidaciones de transportistas externos. El código se asigna recién al
-- ACEPTAR (no es default de columna) — antes de eso no hay nada que
-- facturar todavía.
create table liquidaciones_transporte (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  transportista_id uuid not null references transportistas(user_id),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'rechazada')),
  enviado_por uuid not null references auth.users(id),
  enviado_at timestamptz not null default now(),
  resuelto_por uuid references auth.users(id),
  resuelto_at timestamptz,
  motivo_rechazo text
);

alter table liquidaciones_transporte enable row level security;

create policy liquidaciones_transporte_select on liquidaciones_transporte for select to authenticated using (
  rol_actual() is not null or transportista_id = transportista_actual()
);
create policy liquidaciones_transporte_insert on liquidaciones_transporte for insert to authenticated
  with check (transportista_id = transportista_actual() and enviado_por = auth.uid());
-- Aceptar/rechazar: administración revisa, no encargado.
create policy liquidaciones_transporte_update on liquidaciones_transporte for update to authenticated
  using (rol_actual() in ('administrativo', 'owner'));

-- Viajes. Adjuntos (carta de porte / ticket de pesada) quedan nullable acá
-- — la obligatoriedad para externos se agrega en M3 (Storage) vía trigger,
-- no en esta migración.
create table viajes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default siguiente_codigo('viaje', 'V'),
  transportista_id uuid not null references transportistas(user_id),
  camion_id uuid not null references camiones(id),
  fecha_carga date not null,
  origen text not null,
  destino text not null,
  mercaderia text not null,
  km numeric,
  tn numeric,
  observaciones text,
  carta_porte_path text,
  ticket_pesada_path text,
  liquidacion_id uuid references liquidaciones_transporte(id),
  cargado_por uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index on viajes (transportista_id);
create index on viajes (liquidacion_id);

alter table viajes enable row level security;

-- Cierre mensual de propios — el "candado" que, para un propio, hace lo
-- mismo que una liquidación aceptada hace para un externo: le saca el
-- viaje de las manos. A diferencia de una liquidación aceptada (que solo
-- bloquea edición, el externo sigue viendo el código), acá el chofer deja
-- de ver directamente los viajes del período cerrado.
create table cierres_periodo_propio (
  id uuid primary key default gen_random_uuid(),
  transportista_id uuid not null references transportistas(user_id),
  anio int not null,
  mes int not null check (mes between 1 and 12),
  cerrado_por uuid not null references auth.users(id),
  cerrado_at timestamptz not null default now(),
  unique (transportista_id, anio, mes)
);

alter table cierres_periodo_propio enable row level security;

create policy cierres_periodo_propio_select on cierres_periodo_propio for select to authenticated using (
  rol_actual() = 'owner'
  or (select acceso_logistica_sueldos from perfiles where user_id = auth.uid()) = true
  or transportista_id = transportista_actual()
);
create policy cierres_periodo_propio_insert on cierres_periodo_propio for insert to authenticated
  with check (
    transportista_id = transportista_actual()
    or rol_actual() = 'owner'
    or (select acceso_logistica_sueldos from perfiles where user_id = auth.uid()) = true
  );
-- Reabrir un mes (borrar el cierre) es exclusivo de owner/sueldos — el
-- propio chofer puede cerrar su mes pero no reabrirlo solo.
create policy cierres_periodo_propio_delete on cierres_periodo_propio for delete to authenticated
  using (
    rol_actual() = 'owner'
    or (select acceso_logistica_sueldos from perfiles where user_id = auth.uid()) = true
  );

-- viajes: select/insert/update/delete — se definen recién acá porque
-- dependen de cierres_periodo_propio y staff_puede_gestionar_transportista.
create policy viajes_select_staff on viajes for select to authenticated using (
  staff_puede_gestionar_transportista(transportista_id)
);
create policy viajes_select_dueno on viajes for select to authenticated using (
  transportista_id = transportista_actual()
  and not exists (
    select 1 from cierres_periodo_propio c
    where c.transportista_id = viajes.transportista_id
      and c.anio = extract(year from viajes.fecha_carga)::int
      and c.mes = extract(month from viajes.fecha_carga)::int
  )
);
create policy viajes_insert on viajes for insert to authenticated with check (
  staff_puede_gestionar_transportista(transportista_id)
  or (
    transportista_id = transportista_actual()
    and not exists (
      select 1 from cierres_periodo_propio c
      where c.transportista_id = viajes.transportista_id
        and c.anio = extract(year from viajes.fecha_carga)::int
        and c.mes = extract(month from viajes.fecha_carga)::int
    )
  )
);
create policy viajes_update on viajes for update to authenticated using (
  staff_puede_gestionar_transportista(transportista_id)
  or (
    transportista_id = transportista_actual()
    and (liquidacion_id is null or (select estado from liquidaciones_transporte l where l.id = viajes.liquidacion_id) <> 'aceptada')
    and not exists (
      select 1 from cierres_periodo_propio c
      where c.transportista_id = viajes.transportista_id
        and c.anio = extract(year from viajes.fecha_carga)::int
        and c.mes = extract(month from viajes.fecha_carga)::int
    )
  )
);
create policy viajes_delete on viajes for delete to authenticated using (
  staff_puede_gestionar_transportista(transportista_id)
  or (
    transportista_id = transportista_actual()
    and (liquidacion_id is null or (select estado from liquidaciones_transporte l where l.id = viajes.liquidacion_id) <> 'aceptada')
    and not exists (
      select 1 from cierres_periodo_propio c
      where c.transportista_id = viajes.transportista_id
        and c.anio = extract(year from viajes.fecha_carga)::int
        and c.mes = extract(month from viajes.fecha_carga)::int
    )
  )
);

-- Vistas con nombres resueltos, para el listado de viajes y el panel de
-- liquidaciones (ambos lados: chofer y staff).
create view viajes_detalle with (security_invoker = true) as
  select
    v.id, v.codigo, v.fecha_carga, v.origen, v.destino, v.mercaderia, v.km, v.tn, v.observaciones,
    v.transportista_id, t.nombre_completo as transportista_nombre, t.categoria as transportista_categoria,
    v.camion_id, c.patente as camion_patente,
    v.carta_porte_path, v.ticket_pesada_path,
    v.liquidacion_id, lt.codigo as liquidacion_codigo, lt.estado as liquidacion_estado,
    v.cargado_por, p.nombre_completo as cargado_por_nombre,
    v.created_at
  from viajes v
  join transportistas t on t.user_id = v.transportista_id
  join camiones c on c.id = v.camion_id
  left join liquidaciones_transporte lt on lt.id = v.liquidacion_id
  left join perfiles p on p.user_id = v.cargado_por
  order by v.fecha_carga desc, v.created_at desc;

create view liquidaciones_transporte_detalle with (security_invoker = true) as
  select
    lt.id, lt.codigo, lt.estado, lt.transportista_id, t.nombre_completo as transportista_nombre,
    t.email as transportista_email,
    lt.enviado_por, lt.enviado_at, lt.resuelto_por, lt.resuelto_at, lt.motivo_rechazo,
    (select count(*) from viajes v where v.liquidacion_id = lt.id) as cantidad_viajes,
    (select coalesce(sum(v.tn), 0) from viajes v where v.liquidacion_id = lt.id) as total_tn,
    (select coalesce(sum(v.km), 0) from viajes v where v.liquidacion_id = lt.id) as total_km
  from liquidaciones_transporte lt
  join transportistas t on t.user_id = lt.transportista_id
  order by lt.enviado_at desc;

-- ─── Después de correr este script ──────────────────────────────────────
-- 1. Crear los usuarios reales en Authentication > Users (email + password).
-- 2. Por cada uno, insertar su fila en perfiles, por ejemplo:
--    insert into perfiles (user_id, nombre_completo, rol) values
--      ('<uuid-del-usuario>', 'Juan Uranga', 'owner');
-- 3. Cargar el stock físico actual como movimientos "apertura_stock" desde la app.
