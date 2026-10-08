-- AÑADIDOS SINTÉTICOS, marcados a propósito.
--
-- Producción solo tiene dos enlaces de portal y los dos están revocados, así
-- que con los datos reales el snapshot no se puede ejercitar. Se añaden dos
-- enlaces activos para cubrir las dos ramas de la regla de visibilidad:
--
--  · Obra 7 pertenece al Cliente 1, que tiene CUATRO obras: su factura sin obra
--    NO debe asomar (el caso ambiguo).
--  · Cliente 13 se crea con UNA sola obra: ahí sí debe asomar la factura sin
--    obra de ese cliente (el caso inequívoco).
insert into public.portal_tokens (id, project_id, token, label, permissions, is_active, expires_at, created_at)
values ('aaaa1111-0000-4000-8000-000000000001','04ce624b-88cd-4b26-ab8d-a6f4ea287422',
        'aaaa2222-0000-4000-8000-000000000001','Enlace activo obra 7','["read"]', true,
        now() + interval '90 days', now());

insert into public.clients (id, user_id, name, status)
values ('aaaa3333-0000-4000-8000-000000000001','53918141-519a-4397-95bb-b61321021479','Cliente 13 (sintético)','active');
insert into public.projects (id, user_id, client_id, name, status)
values ('aaaa4444-0000-4000-8000-000000000001','53918141-519a-4397-95bb-b61321021479',
        'aaaa3333-0000-4000-8000-000000000001','Obra 9 (sintética)','planning');
insert into public.portal_tokens (id, project_id, token, label, permissions, is_active, expires_at, created_at)
values ('aaaa1111-0000-4000-8000-000000000002','aaaa4444-0000-4000-8000-000000000001',
        'aaaa2222-0000-4000-8000-000000000002','Enlace activo obra 9','["read"]', true,
        now() + interval '90 days', now());
