-- Avisos por correo a AbyC cuando un cliente actúa en el portal.
-- La base de datos llama al script "Avisos portal AbyC" (Google Apps Script).
-- __URL__ y __TOKEN__ se reemplazan al correr este archivo; NO se guardan en el repo.
create extension if not exists pg_net;

create or replace function public.avisar_abyc(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := '__URL__',
    body := p || jsonb_build_object('token', '__TOKEN__'),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
exception when others then
  null; -- un aviso que falla nunca bloquea lo que hizo el cliente
end;
$$;
revoke all on function public.avisar_abyc(jsonb) from public, anon, authenticated;

-- 1) El cliente manda material
create or replace function public.t_aviso_entrega() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then
    perform public.avisar_abyc(jsonb_build_object(
      'tipo', 'entrega',
      'cliente', (select nombre from public.clientes where id = new.cliente_id),
      'categoria', new.tipo, 'url', new.url, 'nota', coalesce(new.nota, '')));
  end if;
  return new;
end;
$$;
drop trigger if exists aviso_entrega on public.entregas;
create trigger aviso_entrega after insert on public.entregas
  for each row execute function public.t_aviso_entrega();

-- 2) El cliente aprueba o pide cambios
create or replace function public.t_aviso_pieza() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado is distinct from old.estado and new.estado in ('aprobada', 'cambios') and not public.es_admin() then
    perform public.avisar_abyc(jsonb_build_object(
      'tipo', 'pieza',
      'cliente', (select nombre from public.clientes where id = new.cliente_id),
      'titulo', new.titulo, 'estado', new.estado, 'comentario', coalesce(new.comentario, '')));
  end if;
  return new;
end;
$$;
drop trigger if exists aviso_pieza on public.piezas;
create trigger aviso_pieza after update on public.piezas
  for each row execute function public.t_aviso_pieza();

-- 3) El cliente termina un pendiente que le tocaba
create or replace function public.t_aviso_pendiente() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'listo' and old.estado is distinct from 'listo'
     and new.responsable = 'cliente' and not public.es_admin() then
    perform public.avisar_abyc(jsonb_build_object(
      'tipo', 'pendiente',
      'cliente', (select nombre from public.clientes where id = new.cliente_id),
      'titulo', new.titulo));
  end if;
  return new;
end;
$$;
drop trigger if exists aviso_pendiente on public.pendientes;
create trigger aviso_pendiente after update on public.pendientes
  for each row execute function public.t_aviso_pendiente();

-- Prueba: manda un correo de prueba
select public.avisar_abyc('{"tipo": "prueba"}'::jsonb);
