-- ===================================================================
-- Portal de clientes de AbyC · esquema de base de datos y seguridad
-- Se pega completo en Supabase > SQL Editor > New query > Run.
-- Se puede volver a correr sin romper nada.
-- ===================================================================

-- ---------- tablas ----------
create table if not exists public.clientes (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  plan       text not null default 'Plan Presencia',
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

-- Redes del cliente para la pantalla de Inicio: [{"red":"Instagram","usuario":"@...","url":"https://..."}]
alter table public.clientes add column if not exists redes jsonb not null default '[]'::jsonb;

create table if not exists public.perfiles (
  id          uuid primary key references auth.users on delete cascade,
  cliente_id  uuid references public.clientes on delete set null,
  nombre      text,
  correo      text,
  rol         text not null default 'cliente' check (rol in ('cliente', 'admin')),
  creado_en   timestamptz not null default now()
);

-- Materiales (videos, diseños, guiones, estrategia) y reportes mensuales
create table if not exists public.archivos (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references public.clientes on delete cascade,
  tipo         text not null check (tipo in ('material', 'reporte')),
  titulo       text not null,
  descripcion  text,
  ruta         text not null,          -- ruta dentro del bucket "portal"
  mes          date,                   -- para reportes: primer día del mes
  creado_en    timestamptz not null default now()
);

create table if not exists public.pendientes (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references public.clientes on delete cascade,
  titulo          text not null,
  detalle         text,
  responsable     text not null default 'abyc' check (responsable in ('abyc', 'cliente')),
  estado          text not null default 'por_hacer' check (estado in ('por_hacer', 'en_proceso', 'listo')),
  fecha_limite    date,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

-- Piezas que el cliente aprueba o regresa con cambios antes de publicarse
create table if not exists public.piezas (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references public.clientes on delete cascade,
  titulo             text not null,
  descripcion        text,
  ruta               text,
  fecha_publicacion  date,
  estado             text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'cambios')),
  comentario         text,
  respondido_en      timestamptz,
  creado_en          timestamptz not null default now()
);

create index if not exists archivos_cliente_idx   on public.archivos (cliente_id);
create index if not exists pendientes_cliente_idx on public.pendientes (cliente_id);
create index if not exists piezas_cliente_idx     on public.piezas (cliente_id);
create index if not exists perfiles_cliente_idx   on public.perfiles (cliente_id);

-- ---------- funciones de apoyo ----------
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin');
$$;

create or replace function public.mi_cliente() returns uuid
language sql stable security definer set search_path = public as $$
  select cliente_id from public.perfiles where id = auth.uid();
$$;

-- Al invitar a alguien se crea su perfil con el cliente que viene en la invitación.
-- La cuenta de AbyC (abycmexico@gmail.com) queda como administradora.
create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, correo, nombre, cliente_id, rol)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'nombre',
    nullif(new.raw_user_meta_data ->> 'cliente_id', '')::uuid,
    case when lower(new.email) = 'abycmexico@gmail.com' then 'admin' else 'cliente' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.crear_perfil();

-- Por si la cuenta de AbyC se creó antes de correr este archivo
insert into public.perfiles (id, correo, rol)
  select id, email, 'admin' from auth.users where lower(email) = 'abycmexico@gmail.com'
  on conflict (id) do update set rol = 'admin';

-- El cliente responde una pieza (solo puede tocar estado y comentario de las suyas)
create or replace function public.responder_pieza(p_id uuid, p_estado text, p_comentario text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_estado not in ('aprobada', 'cambios') then
    raise exception 'Estado no válido';
  end if;
  update public.piezas
     set estado = p_estado, comentario = nullif(trim(p_comentario), ''), respondido_en = now()
   where id = p_id and cliente_id = public.mi_cliente();
  if not found then raise exception 'Pieza no encontrada'; end if;
end;
$$;

-- El cliente marca como listos los pendientes que le tocan a él
create or replace function public.marcar_pendiente(p_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_estado not in ('por_hacer', 'listo') then
    raise exception 'Estado no válido';
  end if;
  update public.pendientes
     set estado = p_estado, actualizado_en = now()
   where id = p_id and cliente_id = public.mi_cliente() and responsable = 'cliente';
  if not found then raise exception 'Pendiente no encontrado'; end if;
end;
$$;

revoke all on function public.responder_pieza(uuid, text, text) from public, anon;
revoke all on function public.marcar_pendiente(uuid, text) from public, anon;
grant execute on function public.responder_pieza(uuid, text, text) to authenticated;
grant execute on function public.marcar_pendiente(uuid, text) to authenticated;
grant execute on function public.es_admin() to authenticated;
grant execute on function public.mi_cliente() to authenticated;

-- ---------- permisos de la API (las reglas de abajo deciden qué filas ve cada quien) ----------
revoke all on public.clientes, public.perfiles, public.archivos, public.pendientes, public.piezas from anon;
grant select, insert, update, delete on public.clientes, public.perfiles, public.archivos,
  public.pendientes, public.piezas to authenticated;
grant all on public.clientes, public.perfiles, public.archivos, public.pendientes, public.piezas to service_role;

-- ---------- seguridad por filas: cada cliente ve solo lo suyo ----------
alter table public.clientes   enable row level security;
alter table public.perfiles   enable row level security;
alter table public.archivos   enable row level security;
alter table public.pendientes enable row level security;
alter table public.piezas     enable row level security;

drop policy if exists "ver cliente propio" on public.clientes;
create policy "ver cliente propio" on public.clientes for select to authenticated
  using (public.es_admin() or id = public.mi_cliente());
drop policy if exists "admin clientes" on public.clientes;
create policy "admin clientes" on public.clientes for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists "ver perfil propio" on public.perfiles;
create policy "ver perfil propio" on public.perfiles for select to authenticated
  using (id = auth.uid() or public.es_admin());
drop policy if exists "admin perfiles" on public.perfiles;
create policy "admin perfiles" on public.perfiles for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists "ver archivos propios" on public.archivos;
create policy "ver archivos propios" on public.archivos for select to authenticated
  using (public.es_admin() or cliente_id = public.mi_cliente());
drop policy if exists "admin archivos" on public.archivos;
create policy "admin archivos" on public.archivos for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists "ver pendientes propios" on public.pendientes;
create policy "ver pendientes propios" on public.pendientes for select to authenticated
  using (public.es_admin() or cliente_id = public.mi_cliente());
drop policy if exists "admin pendientes" on public.pendientes;
create policy "admin pendientes" on public.pendientes for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists "ver piezas propias" on public.piezas;
create policy "ver piezas propias" on public.piezas for select to authenticated
  using (public.es_admin() or cliente_id = public.mi_cliente());
drop policy if exists "admin piezas" on public.piezas;
create policy "admin piezas" on public.piezas for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- ---------- archivos: bucket privado "portal", una carpeta por cliente ----------
insert into storage.buckets (id, name, public)
  values ('portal', 'portal', false)
  on conflict (id) do nothing;

drop policy if exists "portal leer" on storage.objects;
create policy "portal leer" on storage.objects for select to authenticated
  using (bucket_id = 'portal' and (public.es_admin()
         or (storage.foldername(name))[1] = public.mi_cliente()::text));

drop policy if exists "portal admin subir" on storage.objects;
create policy "portal admin subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'portal' and public.es_admin());

drop policy if exists "portal admin cambiar" on storage.objects;
create policy "portal admin cambiar" on storage.objects for update to authenticated
  using (bucket_id = 'portal' and public.es_admin());

drop policy if exists "portal admin borrar" on storage.objects;
create policy "portal admin borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'portal' and public.es_admin());
