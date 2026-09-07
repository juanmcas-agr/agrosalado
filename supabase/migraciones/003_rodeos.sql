-- Migración: Rodeos (Hacienda M2)
-- Correr completo en el SQL Editor de Supabase, en una pestaña nueva.
-- Requiere haber corrido antes el reset de categorías (Hacienda M1) —
-- movimientos debe estar vacío para poder agregar rodeo_id como NOT NULL
-- sin romper filas existentes.

-- 1. Secuencia del código de rodeo, por año (reinicia a 01 cada año nuevo).
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

-- 2. Tabla de rodeos
create table rodeos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  anio int not null,
  secuencia int not null,
  codigo text not null unique,
  categoria_id text not null references categorias(id),
  establecimiento_id text not null references establecimientos(id),
  corral text check (corral in ('1', '2', '3', '4')),
  fecha_creacion date not null default current_date,
  activo boolean not null default true,
  creado_por uuid not null references auth.users(id),
  creado_at timestamptz not null default now()
);

alter table rodeos enable row level security;

create policy rodeos_select on rodeos for select to authenticated using (true);
create policy rodeos_insert on rodeos for insert to authenticated
  with check (rol_actual() in ('encargado', 'administrativo', 'owner') and creado_por = auth.uid());

-- 3. movimientos: reemplaza el campo de texto libre "rodeo" por un rodeo_id
-- obligatorio. Hay que soltar la vista que depende de la columna vieja
-- antes de poder borrarla, y recrearla después con la nueva.
drop view historial_movimientos;

alter table movimientos drop column rodeo;
alter table movimientos add column rodeo_id uuid not null references rodeos(id);

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
    m.rodeo_id, r.codigo as rodeo, m.observaciones,
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
  left join rodeos r on r.id = m.rodeo_id
  left join perfiles p on p.user_id = m.usuario_id
  order by m.fecha desc, m.created_at desc;

-- Verificación: 0 rodeos todavía, movimientos sigue en 0.
select count(*) as rodeos from rodeos;
select count(*) as movimientos from movimientos;
