-- 036: cada chofer (propio) puede tener un camión "por defecto" (se
-- precarga solo, se puede cambiar por viaje si hace falta). El propio
-- chofer lo puede cambiar (RPC acotada, ver más abajo) y owner/
-- administrativo también, desde Catálogo. De paso, un chofer ahora puede
-- dar de alta un camión nuevo si el suyo no está en el catálogo (antes
-- solo el personal podía cargar camiones) — un externo no, sigue como
-- estaba (usa su propia flota, no la de Agro Salado).

alter table transportistas add column camion_default_id uuid references camiones(id);

-- Un chofer (propio) también puede cargar un camión nuevo — se agrega
-- como policy aparte (no se toca camiones_insert existente) para no
-- alterar el criterio ya usado por el personal.
create policy camiones_insert_chofer on camiones for insert to authenticated
  with check (
    exists (select 1 from transportistas t where t.user_id = auth.uid() and t.categoria = 'propio')
  );

-- Deja que un chofer actualice SU PROPIO camión por defecto sin darle una
-- política de update genérica sobre transportistas (que seguiría
-- exponiendo el resto de sus propios datos a edición directa desde el
-- cliente). security definer + chequeo de categoria adentro.
create or replace function actualizar_mi_camion_default(p_camion_id uuid) returns void
language plpgsql security definer as $$
begin
  update transportistas
  set camion_default_id = p_camion_id
  where user_id = auth.uid() and categoria = 'propio';
end;
$$;

grant execute on function actualizar_mi_camion_default(uuid) to authenticated;
