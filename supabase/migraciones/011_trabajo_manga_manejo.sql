-- Milestone 11: Trabajo de Manga — Manejo de rodeo.
-- Tabla trabajo_manga_manejo (aparte, capada, pesada de control, Destete)
-- + rodeo_pesadas_historial (evolución de peso del rodeo).
--
-- Destete dispara 2 movimientos reales de cambio_categoria (ternero a
-- novillito, ternera a vaquillona) que ADEMÁS cambian de rodeo (los
-- terneros/as destetados pasan a su propio rodeo nuevo). Eso requiere
-- que 'cambio_categoria' pueda llevar rodeo_destino_id, algo que hoy
-- validar_movimiento() rechaza (solo lo permitía para 'cambio_rodeo') y
-- que actualizar_rodeo_tras_movimiento() manejaría mal (pisaría la
-- categoría del rodeo de ORIGEN en vez de dejarlo como está). Esta
-- migración redefine esas dos funciones para soportarlo.
--
-- Requiere haber corrido 003 a 010 antes.

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

create policy trabajo_manga_manejo_select on trabajo_manga_manejo for select to authenticated using (true);
create policy trabajo_manga_manejo_insert on trabajo_manga_manejo for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

create policy rodeo_pesadas_historial_select on rodeo_pesadas_historial for select to authenticated using (true);
create policy rodeo_pesadas_historial_insert on rodeo_pesadas_historial for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner'));

-- ─── Redefinición de validar_movimiento(): cambio_categoria ahora puede
-- llevar rodeo_destino_id opcional (Destete) ─────────────────────────────
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
    if new.establecimiento_origen <> new.establecimiento_destino then
      raise exception 'En un cambio de rodeo, el establecimiento no cambia';
    end if;
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

-- ─── Redefinición de actualizar_rodeo_tras_movimiento(): si el cambio de
-- categoría también cambió de rodeo (Destete), el rodeo de ORIGEN no
-- cambia de categoría — solo el rodeo nuevo (que ya nace con la
-- categoría correcta) se queda con esas cabezas ────────────────────────
create or replace function actualizar_rodeo_tras_movimiento() returns trigger
language plpgsql as $$
begin
  if new.tipo_movimiento = 'traslado' then
    update rodeos set establecimiento_id = new.establecimiento_destino where id = new.rodeo_id;
  elsif new.tipo_movimiento = 'cambio_categoria' and new.rodeo_destino_id is null then
    update rodeos set categoria_id = new.categoria_destino where id = new.rodeo_id;
  end if;
  return new;
end;
$$;

-- Verificación
select 'trabajo_manga_manejo' as tabla, count(*) from trabajo_manga_manejo
union all select 'rodeo_pesadas_historial', count(*) from rodeo_pesadas_historial;
