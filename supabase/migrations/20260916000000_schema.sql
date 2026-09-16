-- =====================================================================
-- Caerleon Profit — esquema de Supabase
--
-- Cómo usarlo en tu proyecto real:
--   Supabase → SQL Editor → New query → pega TODO este archivo → Run.
-- Se puede ejecutar más de una vez sin romper nada.
--
-- Modelo: la página (GitHub Pages) habla directo con Supabase desde el
-- navegador usando la clave pública (anon). Eso es seguro porque cada tabla
-- tiene RLS: Postgres solo devuelve y acepta filas cuyo user_id sea el del
-- usuario que inició sesión. Sin sesión, no se ve nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------

-- Preferencias del usuario (antes: state.premium y state.theme en localStorage)
create table if not exists public.profiles (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  premium    boolean not null default true,
  theme      text    not null default 'light' check (theme in ('light', 'dark')),
  updated_at timestamptz not null default now()
);

-- Precios de runa / alma / reliquia por tier (antes: state.precios)
create table if not exists public.material_prices (
  user_id    uuid     not null default auth.uid() references auth.users (id) on delete cascade,
  tier       smallint not null check (tier between 4 and 8),
  runa       numeric not null default 0,
  alma       numeric not null default 0,
  relic      numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, tier)
);

-- Precio del Sello Real por tier (antes: state.sellos)
create table if not exists public.sigil_prices (
  user_id    uuid     not null default auth.uid() references auth.users (id) on delete cascade,
  tier       smallint not null check (tier between 4 and 6),
  price      numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, tier)
);

-- Registro de operaciones (antes: state.registro)
--
-- Los importes son numeric (decimal exacto) a propósito. El navegador envía
-- cada número con todos sus dígitos (p. ej. 145854.28000000003) y numeric
-- los devuelve tal cual; double precision los recorta a 15 dígitos al leer,
-- y la app vería cada guardado propio como un "cambio desde otro dispositivo".
create table if not exists public.operations (
  id             uuid primary key,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  orden          double precision not null default 0,  -- orden de inserción en el registro
  fecha          date not null,
  tipo           text not null,
  tier           smallint not null,
  ench_ini       smallint,
  ench_fin       smallint,
  calidad        text,
  qty            integer not null default 1,
  p_compra       numeric,
  p_venta        numeric,
  p_dir          numeric,
  mat_unit       numeric,
  inversion      numeric,
  rev_neto       numeric,
  profit         numeric,
  roi            numeric,               -- fracción: 0.25 = 25%
  profit_unit    numeric,
  estado         text,
  notas          text,
  icon           text,
  -- Solo para crafteo con Sellos Reales
  royal_slot     text check (royal_slot in ('helmet', 'chest', 'boots')),
  royal_material text check (royal_material in ('cloth', 'leather', 'plate')),
  sigil_price    numeric,
  sigil_count    integer,
  craft_fee      numeric,
  sigil_cost     numeric,
  -- ID con el que venía del formato viejo (r_1789..., etc.), por trazabilidad
  legacy_id      text,
  -- Cualquier campo del formato viejo que no tenga columna propia
  extra          jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists operations_user_fecha on public.operations (user_id, fecha);
create index if not exists operations_user_orden on public.operations (user_id, orden);

-- Intentos de venta de cada operación (antes: op.ventas[])
create table if not exists public.sales (
  id           uuid primary key,
  operation_id uuid not null references public.operations (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  orden        integer not null default 0,        -- orden dentro de la operación
  fecha        date not null,
  hora         text not null default '12:00',
  precio       numeric not null default 0,
  comprador    text not null default 'bm' check (comprador in ('bm', 'player', 'guild', 'direct')),
  estado       text not null default 'pendiente' check (estado in ('pendiente', 'vendido', 'fallido')),
  notas        text,
  legacy_id    text,
  extra        jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists sales_operation on public.sales (operation_id);
create index if not exists sales_user on public.sales (user_id);

-- ---------------------------------------------------------------------
-- 2. updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'material_prices', 'sigil_prices', 'operations', 'sales'] loop
    execute format('drop trigger if exists touch_updated_at on public.%I', t);
    execute format(
      'create trigger touch_updated_at before update on public.%I
         for each row execute function public.touch_updated_at()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Seguridad por usuario (RLS)
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.material_prices enable row level security;
alter table public.sigil_prices    enable row level security;
alter table public.operations      enable row level security;
alter table public.sales           enable row level security;

-- `(select auth.uid())` en vez de `auth.uid()`: Postgres lo evalúa una sola
-- vez por consulta en lugar de una vez por fila (recomendación de Supabase).
do $$
declare t text;
begin
  foreach t in array array['profiles', 'material_prices', 'sigil_prices', 'operations'] loop
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format(
      'create policy owner_all on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- Una venta solo se puede colgar de una operación propia.
drop policy if exists owner_all on public.sales;
create policy owner_all on public.sales for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.operations o
      where o.id = operation_id and o.user_id = (select auth.uid())
    )
  );

-- Sin sesión (rol anon) no se puede leer ni escribir nada.
revoke all on public.profiles, public.material_prices, public.sigil_prices,
              public.operations, public.sales from anon;

grant select, insert, update, delete
  on public.profiles, public.material_prices, public.sigil_prices,
     public.operations, public.sales
  to authenticated;

-- ---------------------------------------------------------------------
-- 4. Tiempo real (cambios en un dispositivo aparecen en los demás)
-- ---------------------------------------------------------------------
-- Realtime respeta RLS para inserts y updates. Para los deletes solo
-- transmite la clave primaria (uuid) de la fila borrada, sin datos.
do $$
declare t text;
begin
  foreach t in array array['profiles', 'material_prices', 'sigil_prices', 'operations', 'sales'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Alta de usuario: perfil y precios por defecto
-- ---------------------------------------------------------------------
-- Los valores son DEFAULT_PRECIOS y DEFAULT_SELLOS del app.js.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;

  insert into public.material_prices (user_id, tier, runa, alma, relic) values
    (new.id, 4, 10,    66,     405),
    (new.id, 5, 500,   2500,   10000),
    (new.id, 6, 2500,  12000,  50000),
    (new.id, 7, 10000, 50000,  200000),
    (new.id, 8, 40000, 200000, 800000)
  on conflict (user_id, tier) do nothing;

  insert into public.sigil_prices (user_id, tier, price) values
    (new.id, 4, 4500),
    (new.id, 5, 25000),
    (new.id, 6, 150000)
  on conflict (user_id, tier) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Usuarios que ya existían antes de correr este script también reciben
-- su perfil y precios por defecto.
insert into public.profiles (user_id)
  select id from auth.users
  on conflict (user_id) do nothing;

insert into public.material_prices (user_id, tier, runa, alma, relic)
  select u.id, p.tier, p.runa, p.alma, p.relic
  from auth.users u
  cross join (values
    (4, 10, 66, 405), (5, 500, 2500, 10000), (6, 2500, 12000, 50000),
    (7, 10000, 50000, 200000), (8, 40000, 200000, 800000)
  ) as p (tier, runa, alma, relic)
  on conflict (user_id, tier) do nothing;

insert into public.sigil_prices (user_id, tier, price)
  select u.id, s.tier, s.price
  from auth.users u
  cross join (values (4, 4500), (5, 25000), (6, 150000)) as s (tier, price)
  on conflict (user_id, tier) do nothing;
