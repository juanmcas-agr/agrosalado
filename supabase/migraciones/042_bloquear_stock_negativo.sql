-- 042: la base de datos deja de permitir que el stock quede en negativo.
--
-- Hasta ahora el chequeo de "¿hay cabezas suficientes?" vivía SOLO en el
-- navegador (validarStockDisponible en stock/js/movimientos.js), y encima
-- se saltea a propósito cuando no hay señal. O sea que el stock podía
-- quedar negativo, en silencio, por tres caminos reales:
--   1) cargar una salida sin internet (en el campo) y sincronizarla después
--   2) dos personas cargando del mismo corral al mismo tiempo
--   3) un movimiento que quedó en la cola y sincroniza al otro día, cuando
--      el stock ya cambió
-- Ninguna pantalla avisaba: el Dashboard suma los negativos sin decir nada.
--
-- Esta migración NO borra ni cambia datos: solo agrega el control. Al
-- final hay una consulta que lista los negativos que YA existan (si
-- devuelve 0 filas, está todo sano).

-- El "bolsillo" de stock es siempre la combinación
-- establecimiento + categoría + titular + rodeo (así lo agrupa
-- stock_actual). Este trigger mira ese mismo bolsillo y rechaza la
-- operación si quedaría abajo de cero.
create or replace function validar_stock_no_negativo() returns trigger
language plpgsql as $$
declare
  v_est text;
  v_cat text;
  v_tit text;
  v_rodeo uuid;
  v_saca int;
  v_stock int;
  v_excluir uuid := null;
  v_es_update boolean := false;
  v_nombre_cat text;
  v_nombre_tit text;
  v_nombre_rodeo text;
begin
  if tg_op = 'INSERT' then
    -- Reenvío de la cola offline: si el movimiento YA está guardado, este
    -- insert no va a hacer nada (sync.js manda upsert con
    -- ignoreDuplicates), pero el trigger corre igual. Sin esta salida, un
    -- reintento después de una respuesta perdida fallaría con "no hay
    -- stock" — porque ese mismo movimiento ya está descontado.
    if exists (select 1 from movimientos where id = new.id) then return new; end if;

    -- Las entradas puras (apertura, compra, hotelería, parición) no tienen
    -- establecimiento_origen: no pueden dejar nada en negativo.
    if new.establecimiento_origen is null then return new; end if;

    v_est := new.establecimiento_origen;
    v_cat := new.categoria_origen;
    v_tit := coalesce(new.titular_origen, 'agro_salado');
    v_rodeo := new.rodeo_id;
    v_saca := new.cantidad_cabezas;

    -- Corrección de un movimiento ("Editar" en el Historial): el original
    -- todavía cuenta en este instante, y deja de contar recién un renglón
    -- más abajo, cuando se lo marca como reemplazado. Si no se lo
    -- descontara acá, corregir una venta que dejó el corral en cero
    -- quedaría bloqueada contra sí misma, siempre.
    v_excluir := new.editado_de;
  else
    -- Si el movimiento ya no contaba (anulado o reemplazado de antes),
    -- volver a sacarlo no cambia ningún stock.
    if old.anulado or old.reemplazado_por is not null then return new; end if;

    -- Solo importa cuando el movimiento DEJA de contar, o sea al anularlo
    -- o al reemplazarlo por una corrección. Ahí desaparece lo que ese
    -- movimiento había ACREDITADO, y eso sí puede dejar el destino en
    -- negativo (ej. anular una apertura de la que ya se vendió). Lo que
    -- había debitado desaparece también, pero eso solo suma.
    if not ((new.anulado and not old.anulado)
            or (new.reemplazado_por is not null and old.reemplazado_por is null)) then
      return new;
    end if;
    if new.establecimiento_destino is null then return new; end if;

    v_es_update := true;
    v_est := new.establecimiento_destino;
    v_cat := new.categoria_destino;
    v_tit := coalesce(new.titular_destino, 'agro_salado');
    v_rodeo := coalesce(new.rodeo_destino_id, new.rodeo_id);
    v_saca := new.cantidad_cabezas;
  end if;

  -- Sin categoría/rodeo no hay bolsillo que mirar (no debería pasar:
  -- validar_movimiento() ya los exige donde corresponde).
  if v_cat is null or v_rodeo is null then return new; end if;

  -- Serializa contra cualquier otra transacción que toque EXACTAMENTE el
  -- mismo bolsillo. Sin esto, dos ventas simultáneas del mismo corral leen
  -- las dos el stock viejo, pasan las dos el control, y el resultado queda
  -- negativo igual. El lock se libera solo al terminar la transacción.
  perform pg_advisory_xact_lock(
    hashtext(v_est || '|' || v_cat || '|' || v_tit || '|' || v_rodeo::text)::bigint
  );

  -- Stock actual de ese bolsillo. En INSERT la fila nueva todavía no está
  -- en la tabla; en UPDATE la fila vieja todavía cuenta. En los dos casos
  -- lo que queda después es el mismo cálculo: lo de ahora menos lo que este
  -- movimiento saca (o deja de acreditar).
  select coalesce(sum(delta_cabezas), 0) into v_stock
  from movimiento_lineas
  where establecimiento = v_est
    and categoria = v_cat
    and titular = v_tit
    and rodeo_id = v_rodeo
    and (v_excluir is null or id <> v_excluir);

  if v_stock - v_saca >= 0 then return new; end if;

  select nombre into v_nombre_cat from categorias where id = v_cat;
  select nombre into v_nombre_tit from titulares where id = v_tit;
  select codigo into v_nombre_rodeo from rodeos where id = v_rodeo;

  if v_es_update then
    raise exception
      'No se puede % este movimiento: dejaría a % con % cabeza(s) de % en % (stock negativo). Anulá o corregí primero los movimientos posteriores que sacaron de ahí.',
      case when new.anulado then 'anular' else 'corregir' end,
      coalesce(v_nombre_tit, v_tit),
      v_stock - v_saca,
      coalesce(v_nombre_cat, v_cat),
      coalesce(v_nombre_rodeo, 'ese rodeo');
  else
    raise exception
      'No hay stock suficiente: % tiene % cabeza(s) de % en % y este movimiento saca %. Revisá la cantidad, el corral/rodeo y el titular.',
      coalesce(v_nombre_tit, v_tit),
      v_stock,
      coalesce(v_nombre_cat, v_cat),
      coalesce(v_nombre_rodeo, 'ese rodeo'),
      v_saca;
  end if;

  return new;
end;
$$;

-- Corre después de trg_validar_movimiento (Postgres dispara los triggers
-- del mismo momento en orden alfabético, y "validar_m..." va antes que
-- "validar_s..."): primero se valida la forma del movimiento, después la
-- disponibilidad — así el mensaje de error que le llega al usuario es el
-- más útil de los dos.
drop trigger if exists trg_validar_stock_no_negativo on movimientos;
create trigger trg_validar_stock_no_negativo
  before insert or update on movimientos
  for each row execute function validar_stock_no_negativo();

-- ─────────────────────────────────────────────────────────────────────
-- Diagnóstico: bolsillos que YA están en negativo. El trigger frena los
-- nuevos, pero no arregla los que puedan existir de antes. Si esto
-- devuelve 0 filas, está todo sano. Si devuelve algo, esos rodeos hay que
-- corregirlos a mano desde el Historial (y el Dashboard ahora los avisa
-- arriba de todo).
select
  coalesce(r.codigo, '(sin rodeo)') as rodeo,
  sa.establecimiento,
  sa.categoria,
  sa.titular,
  sa.cabezas
from stock_actual sa
left join rodeos r on r.id = sa.rodeo_id
where sa.cabezas < 0
order by sa.cabezas;
