-- ============================================================
-- QUINTAL RAÇÕES E PET SHOP — Schema do banco
-- ============================================================

-- ============================================================
-- 1) TABELAS DE DADOS
-- ============================================================

-- Categorias (círculos da home: cão, gato, peixe, etc)
create table if not exists public.categorias (
  id          bigserial primary key,
  nome        text not null,
  slug        text not null unique,
  icone_url   text,
  ordem       int  not null default 0,
  ativo       bool not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Marcas (Premier, Golden, Royal Canin, Comigo, etc)
create table if not exists public.marcas (
  id          bigserial primary key,
  nome        text not null unique,
  slug        text not null unique,
  logo_url    text,
  cor         text,
  ordem       int  not null default 0,
  ativo       bool not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Produtos
create table if not exists public.produtos (
  id                bigserial primary key,
  nome              text not null,
  slug              text unique,
  descricao         text,
  categoria_id      bigint references public.categorias(id) on delete set null,
  marca_id          bigint references public.marcas(id) on delete set null,
  foto_url          text,
  unidade           text default 'kg',           -- kg, un, saco, pacote
  preco_normal      numeric(10,2),
  preco_pix         numeric(10,2),
  preco_promocional numeric(10,2),
  promo_inicio      timestamptz,
  promo_fim         timestamptz,
  estoque           int  default 0,
  destaque          bool not null default false, -- aparece na grid principal
  ativo             bool not null default true,
  ordem             int  not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.produtos (categoria_id);
create index on public.produtos (marca_id);
create index on public.produtos (ativo, destaque, ordem);

-- Banners do hero (4 slides do carrossel)
create table if not exists public.banners_hero (
  id          bigserial primary key,
  titulo      text not null,
  foto_url    text not null,
  alt         text,
  link        text,
  ordem       int  not null default 0,
  ativo       bool not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Histórico de preços (auditoria de toda mudança)
create table if not exists public.historico_precos (
  id                  bigserial primary key,
  produto_id          bigint not null references public.produtos(id) on delete cascade,
  preco_normal_old    numeric(10,2),
  preco_normal_new    numeric(10,2),
  preco_pix_old       numeric(10,2),
  preco_pix_new       numeric(10,2),
  preco_promo_old     numeric(10,2),
  preco_promo_new     numeric(10,2),
  alterado_por        uuid references auth.users(id),
  alterado_em         timestamptz not null default now()
);
create index on public.historico_precos (produto_id, alterado_em desc);

-- Perfis (vincula usuário Auth ao role)
create table if not exists public.perfis (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  email       text,
  role        text not null default 'vendedor' check (role in ('admin','vendedor')),
  ativo       bool not null default true,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- 2) TRIGGERS
-- ============================================================

-- updated_at automático
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_upd_categorias on public.categorias;
create trigger trg_upd_categorias before update on public.categorias
  for each row execute function public.set_updated_at();

drop trigger if exists trg_upd_marcas on public.marcas;
create trigger trg_upd_marcas before update on public.marcas
  for each row execute function public.set_updated_at();

drop trigger if exists trg_upd_produtos on public.produtos;
create trigger trg_upd_produtos before update on public.produtos
  for each row execute function public.set_updated_at();

drop trigger if exists trg_upd_banners on public.banners_hero;
create trigger trg_upd_banners before update on public.banners_hero
  for each row execute function public.set_updated_at();

-- log automático de mudança de preço
create or replace function public.log_preco_change()
returns trigger language plpgsql security definer as $$
begin
  if (coalesce(old.preco_normal,-1)      <> coalesce(new.preco_normal,-1))
  or (coalesce(old.preco_pix,-1)         <> coalesce(new.preco_pix,-1))
  or (coalesce(old.preco_promocional,-1) <> coalesce(new.preco_promocional,-1)) then
    insert into public.historico_precos (
      produto_id,
      preco_normal_old, preco_normal_new,
      preco_pix_old,    preco_pix_new,
      preco_promo_old,  preco_promo_new,
      alterado_por
    ) values (
      new.id,
      old.preco_normal, new.preco_normal,
      old.preco_pix,    new.preco_pix,
      old.preco_promocional, new.preco_promocional,
      auth.uid()
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_log_preco on public.produtos;
create trigger trg_log_preco after update on public.produtos
  for each row execute function public.log_preco_change();

-- Cria perfil automaticamente quando usuário é criado no Auth
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.perfis (id, nome, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', new.email), new.email, 'vendedor')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 3) HELPERS DE PERMISSÃO
-- ============================================================

create or replace function public.is_admin() returns bool
language sql stable security definer as $$
  select exists(
    select 1 from public.perfis
    where id = auth.uid() and role = 'admin' and ativo = true
  );
$$;

create or replace function public.is_vendedor() returns bool
language sql stable security definer as $$
  select exists(
    select 1 from public.perfis
    where id = auth.uid() and role in ('admin','vendedor') and ativo = true
  );
$$;

-- ============================================================
-- 4) ROW LEVEL SECURITY
-- ============================================================

alter table public.categorias       enable row level security;
alter table public.marcas           enable row level security;
alter table public.produtos         enable row level security;
alter table public.banners_hero     enable row level security;
alter table public.historico_precos enable row level security;
alter table public.perfis           enable row level security;

-- LEITURA PÚBLICA (apenas registros ativos)
create policy "categorias publicas" on public.categorias
  for select using (ativo = true);

create policy "marcas publicas" on public.marcas
  for select using (ativo = true);

create policy "produtos publicos" on public.produtos
  for select using (ativo = true);

create policy "banners publicos" on public.banners_hero
  for select using (ativo = true);

-- ADMIN: tudo
create policy "admin tudo categorias"  on public.categorias       for all using (is_admin()) with check (is_admin());
create policy "admin tudo marcas"      on public.marcas           for all using (is_admin()) with check (is_admin());
create policy "admin tudo produtos"    on public.produtos         for all using (is_admin()) with check (is_admin());
create policy "admin tudo banners"     on public.banners_hero     for all using (is_admin()) with check (is_admin());
create policy "admin tudo perfis"      on public.perfis           for all using (is_admin()) with check (is_admin());

-- VENDEDOR: ler tudo (mesmo inativo) e UPDATE só de preço/estoque
create policy "vendedor ler categorias" on public.categorias   for select using (is_vendedor());
create policy "vendedor ler marcas"     on public.marcas       for select using (is_vendedor());
create policy "vendedor ler produtos"   on public.produtos     for select using (is_vendedor());
create policy "vendedor ler banners"    on public.banners_hero for select using (is_vendedor());

create policy "vendedor edita preco/estoque" on public.produtos
  for update using (is_vendedor())
  with check (is_vendedor());

-- HISTÓRICO: só admin lê
create policy "admin ve historico" on public.historico_precos
  for select using (is_admin());

-- PERFIS: cada um vê o próprio
create policy "perfil ver proprio" on public.perfis
  for select using (auth.uid() = id);
