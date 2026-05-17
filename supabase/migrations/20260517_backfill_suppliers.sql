-- Backfill construction supplier names based on source_url, description, name
update price_items
set supplier_name = case
  when lower(coalesce(source_url, description, name, '')) like '%leroy%' then 'Leroy Merlin'
  when lower(coalesce(source_url, description, name, '')) like '%obramat%' then 'OBRAMAT'
  when lower(coalesce(source_url, description, name, '')) like '%bricomart%' then 'OBRAMAT'
  when lower(coalesce(source_url, description, name, '')) like '%cype%' then 'CYPE / Banco de precios'
  when lower(coalesce(source_url, description, name, '')) like '%referencia%' then 'Referencia mercado'
  when source_type = 'default' then 'Banco ENLAZE base'
  else supplier_name
end
where sector = 'construccion'
  and supplier_name is null;

update sector_data
set supplier_name = case
  when lower(coalesce(source, description, title, '')) like '%leroy%' then 'Leroy Merlin'
  when lower(coalesce(source, description, title, '')) like '%obramat%' then 'OBRAMAT'
  when lower(coalesce(source, description, title, '')) like '%bricomart%' then 'OBRAMAT'
  when lower(coalesce(source, description, title, '')) like '%cype%' then 'CYPE / Banco de precios'
  when lower(coalesce(source, description, title, '')) like '%referencia%' then 'Referencia mercado'
  else supplier_name
end
where sector = 'construccion'
  and supplier_name is null;
