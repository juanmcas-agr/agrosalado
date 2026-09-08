-- Fix: la secuencia del código de rodeo (el "01" en "San Miguel 202601")
-- era un contador GLOBAL compartido por TODOS los rodeos del año, no uno
-- independiente por nombre — si creabas "San Miguel" y después "San
-- Juan" en el mismo año, San Juan no arrancaba en 01 sino que seguía la
-- cuenta global. Ahora cada nombre cuenta aparte.
--
-- rodeo_secuencias es solo un contador derivado (no hay dato de usuario
-- ahí adentro — la fuente de verdad es rodeos.secuencia, que no se toca),
-- así que se recrea entera y se siembra desde los rodeos que ya existen.
--
-- Los códigos YA ASIGNADOS a rodeos existentes NO cambian (serían
-- identificadores rotos si se renumeraran) — esto solo corrige la
-- numeración de los rodeos que se creen de acá en adelante.
--
-- Requiere haber corrido 003 a 013 antes.

drop function if exists siguiente_secuencia_rodeo(int);
drop table rodeo_secuencias;

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

-- Sembrar el contador con el máximo secuencia ya usado por cada (año,
-- nombre) entre los rodeos existentes, para que el próximo rodeo con ese
-- mismo nombre no choque con uno ya creado (puede dejar "huecos" en la
-- numeración por nombre si antes se repartían números con otros
-- nombres en el medio — es un costo aceptable de la transición, no vale
-- la pena renumerar códigos ya asignados).
insert into rodeo_secuencias (anio, nombre, ultimo)
  select anio, nombre, max(secuencia) from rodeos group by anio, nombre
  on conflict (anio, nombre) do update set ultimo = excluded.ultimo;

-- Verificación
select anio, nombre, ultimo from rodeo_secuencias order by anio, nombre;
