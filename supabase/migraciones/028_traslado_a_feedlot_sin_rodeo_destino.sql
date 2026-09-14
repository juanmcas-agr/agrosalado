-- 028: un traslado con destino Feed Lot no tiene que pedir rodeo
-- destino — ahí las cabezas entran directo a un corral (bloque aparte
-- del formulario), quedándose en el mismo rodeo de origen, que se
-- reubica tal cual (ver actualizar_rodeo_tras_movimiento, sin cambios
-- acá — ya tenía el resguardo para rodeo_destino_id null desde la 027).
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
    -- Un rodeo queda atado para siempre al establecimiento donde se
    -- creó: mover animales a otro establecimiento significa sumarlos a
    -- un rodeo (existente o nuevo) DE ESE establecimiento. Excepción:
    -- feed lot no organiza por rodeo destino sino por corral (bloque
    -- aparte del formulario) — ahí el rodeo de origen se reubica tal
    -- cual, ver actualizar_rodeo_tras_movimiento().
    if new.establecimiento_destino <> 'feed_lot' then
      if new.rodeo_destino_id is null then
        raise exception 'Falta rodeo_destino_id para traslado';
      end if;
      if new.rodeo_destino_id = new.rodeo_id then
        raise exception 'En un traslado, el rodeo destino tiene que ser distinto del origen';
      end if;
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
  elsif new.tipo_movimiento not in ('cambio_categoria', 'traslado') and new.rodeo_destino_id is not null then
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
