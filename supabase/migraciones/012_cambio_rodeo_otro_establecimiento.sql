-- Milestone: "Cambio de rodeo" permite que el rodeo destino esté en OTRO
-- establecimiento (antes exigía que fuera el mismo). Solo hace falta
-- redefinir validar_movimiento(): se saca el chequeo que forzaba
-- establecimiento_origen = establecimiento_destino en cambio_rodeo (el
-- resto de las reglas — categoría y titularidad no cambian — se
-- mantienen igual). tipos_movimiento.cambio_rodeo ya tenía
-- requiere_establecimiento_destino = true desde el inicio, así que no
-- hace falta tocar esa tabla.
--
-- Requiere haber corrido 003 a 011 antes.

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

-- Verificación
select proname from pg_proc where proname = 'validar_movimiento';
