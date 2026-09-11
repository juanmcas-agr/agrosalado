-- 024: Storage para documentos de Logística (Milestone 4) — bucket
-- privado + políticas, y el trigger que exige carta de porte + ticket de
-- pesada para transportistas externos.

create or replace function validar_viaje() returns trigger
language plpgsql as $$
begin
  if (select categoria from transportistas where user_id = new.transportista_id) = 'externo' then
    if new.carta_porte_path is null or new.ticket_pesada_path is null then
      raise exception 'Para transportistas externos, la carta de porte y el ticket de pesada son obligatorios.';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_validar_viaje
  before insert or update on viajes
  for each row execute function validar_viaje();

insert into storage.buckets (id, name, public)
values ('logistica-documentos', 'logistica-documentos', false)
on conflict (id) do nothing;

create policy logistica_documentos_select on storage.objects for select to authenticated using (
  bucket_id = 'logistica-documentos'
  and (rol_actual() is not null or (storage.foldername(name))[2] = transportista_actual()::text)
);
create policy logistica_documentos_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'logistica-documentos'
  and (rol_actual() in ('encargado', 'administrativo', 'owner') or (storage.foldername(name))[2] = transportista_actual()::text)
);
create policy logistica_documentos_update on storage.objects for update to authenticated using (
  bucket_id = 'logistica-documentos'
  and (rol_actual() in ('encargado', 'administrativo', 'owner') or (storage.foldername(name))[2] = transportista_actual()::text)
);
create policy logistica_documentos_delete on storage.objects for delete to authenticated using (
  bucket_id = 'logistica-documentos'
  and (rol_actual() in ('encargado', 'administrativo', 'owner') or (storage.foldername(name))[2] = transportista_actual()::text)
);

-- Verificación
select id, public from storage.buckets where id = 'logistica-documentos';
