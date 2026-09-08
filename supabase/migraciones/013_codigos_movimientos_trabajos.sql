-- Milestone: Códigos rastreables para movimientos y trabajos_manga
-- (ej. "M-000123", "T-000045"), para poder ubicar cualquier carga desde
-- el Historial sin tener que andar mirando fecha/tipo/rodeo a ojo.
--
-- El código se asigna en el SERVIDOR vía un "default" de columna (no un
-- trigger, no el cliente): movimientos.js/sync.js insertan movimientos
-- vía upsert(..., { onConflict: 'id', ignoreDuplicates: true }) para que
-- los reintentos de sincronización offline sean idempotentes — si el
-- código se generara en un trigger BEFORE INSERT, cada reintento (aunque
-- termine en "no hizo nada" por el conflicto) podría gastar un número.
-- Con un default de columna, la expresión solo se evalúa cuando la fila
-- efectivamente se inserta; y si validar_movimiento() la rechaza, toda la
-- transacción (incluido el incremento del contador) se revierte sola.
--
-- Como movimientos/trabajos_manga YA tienen filas cargadas, agregar la
-- columna es en pasos: nullable -> backfill -> not null -> unique ->
-- recién ahí el default para las filas nuevas -> sembrar el contador.
--
-- Requiere haber corrido 003 a 012 antes.

-- ─── Contador atómico por tipo (mismo patrón que rodeo_secuencias) ──────
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

-- ─── movimientos ─────────────────────────────────────────────────────────
alter table movimientos add column codigo text;

with numerados as (
  select id, row_number() over (order by created_at, id) as n
  from movimientos
)
update movimientos m
set codigo = 'M-' || lpad(numerados.n::text, 6, '0')
from numerados
where numerados.id = m.id;

alter table movimientos alter column codigo set not null;
alter table movimientos add constraint movimientos_codigo_key unique (codigo);
alter table movimientos alter column codigo set default siguiente_codigo('movimiento', 'M');

insert into codigo_secuencias (tipo, ultimo)
  values ('movimiento', (select count(*) from movimientos))
  on conflict (tipo) do update set ultimo = excluded.ultimo;

-- ─── trabajos_manga ──────────────────────────────────────────────────────
alter table trabajos_manga add column codigo text;

with numerados as (
  select id, row_number() over (order by creado_at, id) as n
  from trabajos_manga
)
update trabajos_manga t
set codigo = 'T-' || lpad(numerados.n::text, 6, '0')
from numerados
where numerados.id = t.id;

alter table trabajos_manga alter column codigo set not null;
alter table trabajos_manga add constraint trabajos_manga_codigo_key unique (codigo);
alter table trabajos_manga alter column codigo set default siguiente_codigo('trabajo_manga', 'T');

insert into codigo_secuencias (tipo, ultimo)
  values ('trabajo_manga', (select count(*) from trabajos_manga))
  on conflict (tipo) do update set ultimo = excluded.ultimo;

-- ─── historial_movimientos: sumar el código ─────────────────────────────
create or replace view historial_movimientos as
  select
    m.id, m.codigo, m.tipo_movimiento, tm.nombre as tipo_movimiento_nombre, tm.clase,
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
    m.reemplazado_por, mr.codigo as reemplazado_por_codigo,
    m.editado_de, me.codigo as editado_de_codigo
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

-- Verificación
select 'movimientos sin codigo' as chequeo, count(*) from movimientos where codigo is null
union all select 'trabajos_manga sin codigo', count(*) from trabajos_manga where codigo is null
union all select 'movimientos codigo duplicado', count(*) - count(distinct codigo) from movimientos
union all select 'trabajos_manga codigo duplicado', count(*) - count(distinct codigo) from trabajos_manga;
