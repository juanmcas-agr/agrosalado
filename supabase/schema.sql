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
  ('macho', 'Macho', 1),
  ('hembra', 'Hembra', 2),
  ('vaquillona_reposicion', 'Vaquillona reposición', 3),
  ('vaca_servicio_primavera', 'Vaca servicio de primavera', 4),
  ('vaca_servicio_invierno', 'Vaca servicio de invierno', 5),
  ('toro', 'Toro', 6);

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
  ('apertura_stock',      'Apertura de stock',                  'entrada', false, true,  false, true,  false, true,  11);

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
  rodeo text,
  observaciones text,
  created_at timestamptz not null default now(),
  anulado boolean not null default false,
  anulado_por uuid references auth.users(id),
  anulado_at timestamptz,
  anulado_motivo text
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

-- ─── Vistas de stock ────────────────────────────────────────────────────

create view movimiento_lineas as
  select id, fecha, establecimiento_destino as establecimiento, categoria_destino as categoria,
         coalesce(titular_destino, 'agro_salado') as titular,
         cantidad_cabezas as delta_cabezas, kilos_promedio, usuario_id
  from movimientos
  where not anulado and establecimiento_destino is not null
  union all
  select id, fecha, establecimiento_origen as establecimiento, categoria_origen as categoria,
         coalesce(titular_origen, 'agro_salado') as titular,
         -cantidad_cabezas as delta_cabezas, kilos_promedio, usuario_id
  from movimientos
  where not anulado and establecimiento_origen is not null;
-- Nota: los movimientos previos a la funcionalidad de titularidad no tienen
-- titular cargado; se asumen de Agro Salado (coalesce) para no perder stock
-- en los totales. Si corresponde, se pueden corregir cargando un
-- "Cambio de titularidad" para pasarlos al titular real.

create view stock_actual as
  select establecimiento, categoria, titular, sum(delta_cabezas) as cabezas
  from movimiento_lineas
  group by establecimiento, categoria, titular;

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
    m.cantidad_cabezas, m.kilos_promedio, m.rodeo, m.observaciones,
    m.usuario_id, p.nombre_completo as usuario_nombre,
    m.created_at, m.anulado, m.anulado_por, m.anulado_at, m.anulado_motivo
  from movimientos m
  join tipos_movimiento tm on tm.id = m.tipo_movimiento
  left join establecimientos eo on eo.id = m.establecimiento_origen
  left join establecimientos ed on ed.id = m.establecimiento_destino
  left join categorias co on co.id = m.categoria_origen
  left join categorias cd on cd.id = m.categoria_destino
  left join titulares tio on tio.id = m.titular_origen
  left join titulares tid on tid.id = m.titular_destino
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

-- ─── Después de correr este script ──────────────────────────────────────
-- 1. Crear los usuarios reales en Authentication > Users (email + password).
-- 2. Por cada uno, insertar su fila en perfiles, por ejemplo:
--    insert into perfiles (user_id, nombre_completo, rol) values
--      ('<uuid-del-usuario>', 'Juan Uranga', 'owner');
-- 3. Cargar el stock físico actual como movimientos "apertura_stock" desde la app.
