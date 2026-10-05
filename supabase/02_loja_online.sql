-- ============================================================
-- QUINTAL RAÇÕES — Módulo Loja Online + Entregas + Marketplaces
-- Migração ADITIVA: não altera nem remove nada do schema 01.
-- O site atual (home) continua lendo apenas destaque=true.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Colunas novas em produtos (todas opcionais)
-- ------------------------------------------------------------
alter table public.produtos add column if not exists sku              text;
alter table public.produtos add column if not exists gtin             text;
alter table public.produtos add column if not exists peso_kg          numeric(8,3);
alter table public.produtos add column if not exists vende_online     bool not null default false;
alter table public.produtos add column if not exists controla_estoque bool not null default false;
alter table public.produtos add column if not exists preco_revisar    bool not null default false;
create unique index if not exists produtos_sku_uq on public.produtos (sku) where sku is not null;

-- Custo do produto fica em tabela separada (não é exposto ao público)
create table if not exists public.produtos_custos (
  produto_id  bigint primary key references public.produtos(id) on delete cascade,
  custo       numeric(10,2) not null default 0,
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2) Configuração da loja (linha única id=1)
-- ------------------------------------------------------------
create table if not exists public.config_loja (
  id                 int primary key default 1 check (id = 1),
  loja_aberta        bool not null default false,       -- false = homologação
  whatsapp           text not null default '5567999638298',
  pix_chave          text,
  pix_nome           text default 'QUINTAL RACOES',
  pix_cidade         text default 'CHAPADAO DO SUL',
  pedido_minimo      numeric(10,2) not null default 30,
  frete_gratis_acima numeric(10,2) default 250,
  retirada_ativa     bool not null default true,
  cartao_online_ativo bool not null default false,      -- liga quando o token Mercado Pago for configurado
  aviso_topo         text default 'Entrega no mesmo dia em Chapadão do Sul para pedidos até 16h',
  updated_at         timestamptz not null default now()
);
insert into public.config_loja (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 3) Zonas de entrega (bairros) e parceiros
-- ------------------------------------------------------------
create table if not exists public.zonas_entrega (
  id             bigserial primary key,
  nome           text not null,
  bairros        text[] not null default '{}',
  taxa_cliente   numeric(10,2) not null default 0,   -- quanto o cliente paga
  prazo_min      int not null default 60,            -- prazo prometido ao cliente
  ordem          int not null default 0,
  ativo          bool not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists public.parceiros_entrega (
  id              bigserial primary key,
  nome            text not null,
  tipo            text not null default 'motoboy' check (tipo in ('motoboy','app','proprio','retirada')),
  telefone        text,
  pix_chave       text,
  custo_padrao    numeric(10,2) not null default 0,     -- custo quando não há tabela por zona
  adicional_parada numeric(10,2) not null default 0,    -- custo por entrega extra na mesma rota
  capacidade_kg   numeric(8,1),                          -- moto ~ 30kg, carro maior
  token_acesso    uuid not null default gen_random_uuid() unique,
  ativo           bool not null default true,
  observacoes     text,
  created_at      timestamptz not null default now()
);

create table if not exists public.parceiro_zona (
  parceiro_id  bigint not null references public.parceiros_entrega(id) on delete cascade,
  zona_id      bigint not null references public.zonas_entrega(id) on delete cascade,
  custo        numeric(10,2) not null,
  prazo_min    int not null default 40,
  primary key (parceiro_id, zona_id)
);

-- ------------------------------------------------------------
-- 4) Canais de venda (site, marketplaces, apps de delivery)
-- ------------------------------------------------------------
create table if not exists public.canais_venda (
  id                bigserial primary key,
  slug              text not null unique,
  nome              text not null,
  tipo              text not null default 'marketplace' check (tipo in ('proprio','marketplace','delivery')),
  comissao_pct      numeric(5,2) not null default 0,
  tarifa_fixa       numeric(10,2) not null default 0,
  custo_frete_medio numeric(10,2) not null default 0,
  margem_alvo_pct   numeric(5,2) not null default 20,
  status            text not null default 'planejado' check (status in ('planejado','cadastrando','ativo','pausado')),
  url_loja          text,
  observacoes       text,
  ordem             int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.produto_canal (
  produto_id   bigint not null references public.produtos(id) on delete cascade,
  canal_id     bigint not null references public.canais_venda(id) on delete cascade,
  preco_canal  numeric(10,2),
  anuncio_id   text,
  ativo        bool not null default true,
  updated_at   timestamptz not null default now(),
  primary key (produto_id, canal_id)
);

-- ------------------------------------------------------------
-- 5) Pedidos
-- ------------------------------------------------------------
create sequence if not exists public.pedidos_numero_seq start 1001;

create table if not exists public.pedidos (
  id                bigserial primary key,
  numero            bigint not null unique default nextval('public.pedidos_numero_seq'),
  token             uuid not null unique default gen_random_uuid(),
  canal_id          bigint references public.canais_venda(id),
  pedido_externo    text,                                 -- nº do pedido no marketplace
  cliente_nome      text not null,
  cliente_telefone  text not null,
  modalidade        text not null default 'entrega' check (modalidade in ('entrega','retirada','envio')),
  zona_id           bigint references public.zonas_entrega(id),
  endereco          text,
  numero_end        text,
  bairro            text,
  complemento       text,
  referencia        text,
  pagamento_forma   text not null check (pagamento_forma in ('pix_online','cartao_online','pix_entrega','cartao_entrega','dinheiro','marketplace')),
  pagamento_status  text not null default 'pendente' check (pagamento_status in ('pendente','pago','recebido_entregador','conferido','estornado')),
  troco_para        numeric(10,2),
  subtotal          numeric(10,2) not null default 0,
  desconto          numeric(10,2) not null default 0,
  frete             numeric(10,2) not null default 0,
  total             numeric(10,2) not null default 0,
  status            text not null default 'novo' check (status in ('novo','confirmado','separando','pronto','em_rota','entregue','cancelado')),
  parceiro_id       bigint references public.parceiros_entrega(id),
  custo_entrega     numeric(10,2),
  rota_grupo        uuid,                                 -- pedidos agrupados na mesma saída
  observacoes       text,
  obs_interna       text,
  mp_preference_id  text,
  mp_payment_id     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  confirmado_em     timestamptz,
  saiu_em           timestamptz,
  entregue_em       timestamptz
);
create index if not exists pedidos_status_idx  on public.pedidos (status, created_at desc);
create index if not exists pedidos_parceiro_idx on public.pedidos (parceiro_id, status);
create index if not exists pedidos_tel_idx     on public.pedidos (cliente_telefone, created_at desc);

create table if not exists public.pedido_itens (
  id          bigserial primary key,
  pedido_id   bigint not null references public.pedidos(id) on delete cascade,
  produto_id  bigint references public.produtos(id) on delete set null,
  nome        text not null,
  quantidade  numeric(10,3) not null check (quantidade > 0),
  preco_unit  numeric(10,2) not null,
  total       numeric(10,2) not null
);
create index if not exists pedido_itens_pedido_idx on public.pedido_itens (pedido_id);

-- Trilha de auditoria de toda mudança de status/pagamento
create table if not exists public.pedido_eventos (
  id          bigserial primary key,
  pedido_id   bigint not null references public.pedidos(id) on delete cascade,
  tipo        text not null,             -- status | pagamento | entrega | obs
  de          text,
  para        text,
  ator        text,                      -- usuário, 'cliente', 'entregador:<nome>', 'mercadopago'
  obs         text,
  em          timestamptz not null default now()
);
create index if not exists pedido_eventos_pedido_idx on public.pedido_eventos (pedido_id, em);

-- ------------------------------------------------------------
-- 6) Triggers
-- ------------------------------------------------------------
drop trigger if exists trg_upd_pedidos on public.pedidos;
create trigger trg_upd_pedidos before update on public.pedidos
  for each row execute function public.set_updated_at();

drop trigger if exists trg_upd_canais on public.canais_venda;
create trigger trg_upd_canais before update on public.canais_venda
  for each row execute function public.set_updated_at();

create or replace function public.pedido_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ator text := coalesce(current_setting('quintal.ator', true), '');
begin
  if v_ator = '' then
    select coalesce(nome, email) into v_ator from public.perfis where id = auth.uid();
    v_ator := coalesce(v_ator, 'sistema');
  end if;

  if tg_op = 'INSERT' then
    insert into public.pedido_eventos (pedido_id, tipo, de, para, ator)
    values (new.id, 'status', null, new.status, v_ator);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.pedido_eventos (pedido_id, tipo, de, para, ator)
    values (new.id, 'status', old.status, new.status, v_ator);
    if new.status = 'confirmado' and new.confirmado_em is null then new.confirmado_em := now(); end if;
    if new.status = 'em_rota'    and new.saiu_em      is null then new.saiu_em      := now(); end if;
    if new.status = 'entregue'   and new.entregue_em  is null then new.entregue_em  := now(); end if;

    -- devolve estoque ao cancelar
    if new.status = 'cancelado' then
      update public.produtos p set estoque = p.estoque + ceil(i.quantidade)::int
        from public.pedido_itens i
       where i.pedido_id = new.id and i.produto_id = p.id and p.controla_estoque;
    end if;
  end if;

  if new.pagamento_status is distinct from old.pagamento_status then
    insert into public.pedido_eventos (pedido_id, tipo, de, para, ator)
    values (new.id, 'pagamento', old.pagamento_status, new.pagamento_status, v_ator);
  end if;

  if new.parceiro_id is distinct from old.parceiro_id then
    insert into public.pedido_eventos (pedido_id, tipo, de, para, ator)
    values (new.id, 'entrega', old.parceiro_id::text, new.parceiro_id::text, v_ator);
  end if;
  return new;
end $$;

drop trigger if exists trg_pedido_audit_ins on public.pedidos;
create trigger trg_pedido_audit_ins after insert on public.pedidos
  for each row execute function public.pedido_audit();
drop trigger if exists trg_pedido_audit_upd on public.pedidos;
create trigger trg_pedido_audit_upd before update on public.pedidos
  for each row execute function public.pedido_audit();

-- ------------------------------------------------------------
-- 7) Preço efetivo (mesma regra no site e no servidor)
-- ------------------------------------------------------------
create or replace function public.preco_efetivo(p public.produtos, forma text)
returns numeric language sql stable as $$
  select case
    when base is null then null
    when forma in ('pix_online','pix_entrega','dinheiro') and p.preco_pix is not null then least(p.preco_pix, base)
    else base end
  from (select case
          when p.preco_promocional is not null
           and (p.promo_inicio is null or p.promo_inicio <= now())
           and (p.promo_fim    is null or p.promo_fim    >= now())
          then least(p.preco_promocional, coalesce(p.preco_normal, p.preco_promocional))
          else p.preco_normal end as base) b;
$$;

-- ------------------------------------------------------------
-- 8) RPC pública: criar pedido (preço SEMPRE recalculado no servidor)
-- ------------------------------------------------------------
create or replace function public.criar_pedido(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg        public.config_loja;
  z          public.zonas_entrega;
  prod       public.produtos;
  item       jsonb;
  v_forma    text := payload->>'pagamento_forma';
  v_modal    text := coalesce(payload->>'modalidade','entrega');
  v_tel      text := regexp_replace(coalesce(payload->>'cliente_telefone',''), '\D', '', 'g');
  v_nome     text := btrim(coalesce(payload->>'cliente_nome',''));
  v_qtd      numeric;
  v_preco    numeric;
  v_subtotal numeric := 0;
  v_frete    numeric := 0;
  v_ped      public.pedidos;
  v_canal    bigint;
  v_itens    jsonb := '[]'::jsonb;
  v_n        int := 0;
begin
  select * into cfg from public.config_loja where id = 1;

  if length(v_nome) < 2 then raise exception 'Informe seu nome'; end if;
  if length(v_tel) < 10 or length(v_tel) > 13 then raise exception 'Telefone/WhatsApp inválido'; end if;
  if v_forma not in ('pix_online','cartao_online','pix_entrega','cartao_entrega','dinheiro') then
    raise exception 'Forma de pagamento inválida';
  end if;
  if v_forma = 'cartao_online' and not cfg.cartao_online_ativo then
    raise exception 'Cartão online ainda não está disponível';
  end if;
  if v_modal not in ('entrega','retirada') then raise exception 'Modalidade inválida'; end if;
  if v_modal = 'retirada' and not cfg.retirada_ativa then raise exception 'Retirada indisponível'; end if;

  -- antiabuso simples: até 8 pedidos por telefone por hora
  if (select count(*) from public.pedidos where cliente_telefone = v_tel and created_at > now() - interval '1 hour') >= 8 then
    raise exception 'Muitos pedidos em sequência. Fale com a loja pelo WhatsApp.';
  end if;

  if jsonb_typeof(payload->'itens') <> 'array' or jsonb_array_length(payload->'itens') = 0 then
    raise exception 'Carrinho vazio';
  end if;
  if jsonb_array_length(payload->'itens') > 40 then raise exception 'Carrinho com itens demais'; end if;

  -- valida itens e calcula subtotal
  for item in select * from jsonb_array_elements(payload->'itens') loop
    v_qtd := (item->>'quantidade')::numeric;
    if v_qtd is null or v_qtd <= 0 or v_qtd > 200 then raise exception 'Quantidade inválida'; end if;
    select * into prod from public.produtos where id = (item->>'produto_id')::bigint and ativo and vende_online;
    if not found then raise exception 'Produto indisponível: %', item->>'produto_id'; end if;
    v_preco := public.preco_efetivo(prod, v_forma);
    if v_preco is null then raise exception 'Produto sem preço: %', prod.nome; end if;
    if prod.controla_estoque and prod.estoque < v_qtd then
      raise exception 'Estoque insuficiente de %', prod.nome;
    end if;
    v_subtotal := v_subtotal + round(v_preco * v_qtd, 2);
    v_itens := v_itens || jsonb_build_object('produto_id', prod.id, 'nome', prod.nome, 'quantidade', v_qtd, 'preco_unit', v_preco, 'total', round(v_preco * v_qtd, 2));
  end loop;

  if v_subtotal < cfg.pedido_minimo then
    raise exception 'Pedido mínimo de R$ %', to_char(cfg.pedido_minimo, 'FM999G990D00');
  end if;

  if v_modal = 'entrega' then
    select * into z from public.zonas_entrega where id = (payload->>'zona_id')::bigint and ativo;
    if not found then raise exception 'Selecione o bairro de entrega'; end if;
    if coalesce(btrim(payload->>'endereco'),'') = '' then raise exception 'Informe o endereço'; end if;
    v_frete := z.taxa_cliente;
    if cfg.frete_gratis_acima is not null and v_subtotal >= cfg.frete_gratis_acima then v_frete := 0; end if;
  end if;

  select id into v_canal from public.canais_venda where slug = 'site';

  perform set_config('quintal.ator', 'cliente', true);
  insert into public.pedidos (
    canal_id, cliente_nome, cliente_telefone, modalidade, zona_id, endereco, numero_end, bairro,
    complemento, referencia, pagamento_forma, troco_para, subtotal, frete, total, observacoes
  ) values (
    v_canal, left(v_nome,120), v_tel, v_modal, case when v_modal='entrega' then z.id end,
    left(payload->>'endereco',200), left(payload->>'numero_end',20),
    case when v_modal='entrega' then coalesce(case when payload->>'bairro' = any(z.bairros) then payload->>'bairro' end, z.nome) end,
    left(payload->>'complemento',120), left(payload->>'referencia',200),
    v_forma, nullif(payload->>'troco_para','')::numeric,
    v_subtotal, v_frete, v_subtotal + v_frete, left(payload->>'observacoes',500)
  ) returning * into v_ped;

  for item in select * from jsonb_array_elements(v_itens) loop
    insert into public.pedido_itens (pedido_id, produto_id, nome, quantidade, preco_unit, total)
    values (v_ped.id, (item->>'produto_id')::bigint, item->>'nome', (item->>'quantidade')::numeric,
            (item->>'preco_unit')::numeric, (item->>'total')::numeric);
    update public.produtos set estoque = estoque - ceil((item->>'quantidade')::numeric)::int
     where id = (item->>'produto_id')::bigint and controla_estoque;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object(
    'numero', v_ped.numero, 'token', v_ped.token,
    'subtotal', v_ped.subtotal, 'frete', v_ped.frete, 'total', v_ped.total,
    'pagamento_forma', v_ped.pagamento_forma, 'itens', v_itens,
    'prazo_min', case when v_modal='entrega' then z.prazo_min end
  );
end $$;

-- ------------------------------------------------------------
-- 9) RPC pública: acompanhar pedido pelo token
-- ------------------------------------------------------------
create or replace function public.consultar_pedido(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'numero', p.numero, 'status', p.status, 'modalidade', p.modalidade,
    'pagamento_forma', p.pagamento_forma, 'pagamento_status', p.pagamento_status,
    'subtotal', p.subtotal, 'frete', p.frete, 'total', p.total,
    'bairro', p.bairro, 'criado_em', p.created_at, 'confirmado_em', p.confirmado_em,
    'saiu_em', p.saiu_em, 'entregue_em', p.entregue_em,
    'cliente_nome', split_part(p.cliente_nome,' ',1),
    'entregador', (select split_part(nome,' ',1) from public.parceiros_entrega where id = p.parceiro_id),
    'prazo_min', (select prazo_min from public.zonas_entrega where id = p.zona_id),
    'itens', (select coalesce(jsonb_agg(jsonb_build_object('nome',i.nome,'quantidade',i.quantidade,'total',i.total,'unidade',pr.unidade) order by i.id),'[]') from public.pedido_itens i left join public.produtos pr on pr.id = i.produto_id where i.pedido_id = p.id)
  ) from public.pedidos p where p.token = p_token;
$$;

-- ------------------------------------------------------------
-- 10) RPCs do entregador (link pessoal com token, sem login)
-- ------------------------------------------------------------
create or replace function public.entregador_painel(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'parceiro', jsonb_build_object('nome', e.nome, 'tipo', e.tipo),
    'pedidos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'numero', p.numero, 'status', p.status,
        'cliente', p.cliente_nome, 'telefone', p.cliente_telefone,
        'endereco', concat_ws(', ', p.endereco, p.numero_end), 'bairro', p.bairro,
        'complemento', p.complemento, 'referencia', p.referencia,
        'pagamento_forma', p.pagamento_forma, 'pagamento_status', p.pagamento_status,
        'total', p.total, 'troco_para', p.troco_para, 'custo_entrega', p.custo_entrega,
        'itens', (select coalesce(jsonb_agg(concat(replace(trim(to_char(i.quantidade,'FM999990.###')),'.',','), case when pr.unidade = 'kg' then ' kg ' else 'x ' end, i.nome)),'[]') from public.pedido_itens i left join public.produtos pr on pr.id = i.produto_id where i.pedido_id = p.id)
      ) order by p.rota_grupo nulls last, p.numero), '[]')
      from public.pedidos p
      where p.parceiro_id = e.id
        and (p.status in ('pronto','em_rota') or (p.status = 'entregue' and p.entregue_em > now() - interval '12 hours'))
    )
  ) from public.parceiros_entrega e where e.token_acesso = p_token and e.ativo;
$$;

create or replace function public.entregador_atualizar(p_token uuid, p_pedido bigint, p_status text, p_recebido bool default false, p_obs text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e public.parceiros_entrega;
  p public.pedidos;
begin
  select * into e from public.parceiros_entrega where token_acesso = p_token and ativo;
  if not found then raise exception 'Link de entregador inválido'; end if;
  select * into p from public.pedidos where id = p_pedido and parceiro_id = e.id;
  if not found then raise exception 'Pedido não atribuído a você'; end if;
  if p_status not in ('em_rota','entregue') then raise exception 'Status inválido'; end if;
  if p_status = 'em_rota'  and p.status <> 'pronto'  then raise exception 'Pedido não está pronto para sair'; end if;
  if p_status = 'entregue' and p.status not in ('pronto','em_rota') then raise exception 'Pedido não está em rota'; end if;

  perform set_config('quintal.ator', 'entregador:' || e.nome, true);
  update public.pedidos set
    status = p_status,
    pagamento_status = case
      when p_status = 'entregue' and p_recebido and pagamento_forma in ('pix_entrega','cartao_entrega','dinheiro') and pagamento_status = 'pendente'
      then 'recebido_entregador' else pagamento_status end
  where id = p.id;

  if p_obs is not null and btrim(p_obs) <> '' then
    insert into public.pedido_eventos (pedido_id, tipo, ator, obs) values (p.id, 'obs', 'entregador:' || e.nome, left(p_obs, 300));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------
-- 11) RLS
-- ------------------------------------------------------------
alter table public.produtos_custos   enable row level security;
alter table public.config_loja       enable row level security;
alter table public.zonas_entrega     enable row level security;
alter table public.parceiros_entrega enable row level security;
alter table public.parceiro_zona     enable row level security;
alter table public.canais_venda      enable row level security;
alter table public.produto_canal     enable row level security;
alter table public.pedidos           enable row level security;
alter table public.pedido_itens      enable row level security;
alter table public.pedido_eventos    enable row level security;

-- leitura pública só do necessário para a vitrine/checkout
drop policy if exists "config publica" on public.config_loja;
create policy "config publica" on public.config_loja for select using (true);
drop policy if exists "zonas publicas" on public.zonas_entrega;
create policy "zonas publicas" on public.zonas_entrega for select using (ativo = true);

-- equipe (admin + vendedor) opera pedidos e entregas
drop policy if exists "equipe pedidos" on public.pedidos;
create policy "equipe pedidos" on public.pedidos for all using (is_vendedor()) with check (is_vendedor());
drop policy if exists "equipe itens" on public.pedido_itens;
create policy "equipe itens" on public.pedido_itens for all using (is_vendedor()) with check (is_vendedor());
drop policy if exists "equipe eventos ler" on public.pedido_eventos;
create policy "equipe eventos ler" on public.pedido_eventos for select using (is_vendedor());
drop policy if exists "equipe eventos obs" on public.pedido_eventos;
create policy "equipe eventos obs" on public.pedido_eventos for insert with check (is_vendedor() and tipo = 'obs');
drop policy if exists "equipe ler parceiros" on public.parceiros_entrega;
create policy "equipe ler parceiros" on public.parceiros_entrega for select using (is_vendedor());
drop policy if exists "equipe ler parceiro_zona" on public.parceiro_zona;
create policy "equipe ler parceiro_zona" on public.parceiro_zona for select using (is_vendedor());
drop policy if exists "equipe ler canais" on public.canais_venda;
create policy "equipe ler canais" on public.canais_venda for select using (is_vendedor());
drop policy if exists "equipe ler produto_canal" on public.produto_canal;
create policy "equipe ler produto_canal" on public.produto_canal for select using (is_vendedor());

-- só admin configura custos, tabelas de frete, parceiros, canais e loja
drop policy if exists "admin custos" on public.produtos_custos;
create policy "admin custos" on public.produtos_custos for all using (is_admin()) with check (is_admin());
drop policy if exists "admin config" on public.config_loja;
create policy "admin config" on public.config_loja for update using (is_admin()) with check (is_admin());
drop policy if exists "admin zonas" on public.zonas_entrega;
create policy "admin zonas" on public.zonas_entrega for all using (is_admin()) with check (is_admin());
drop policy if exists "admin parceiros" on public.parceiros_entrega;
create policy "admin parceiros" on public.parceiros_entrega for all using (is_admin()) with check (is_admin());
drop policy if exists "admin parceiro_zona" on public.parceiro_zona;
create policy "admin parceiro_zona" on public.parceiro_zona for all using (is_admin()) with check (is_admin());
drop policy if exists "admin canais" on public.canais_venda;
create policy "admin canais" on public.canais_venda for all using (is_admin()) with check (is_admin());
drop policy if exists "admin produto_canal" on public.produto_canal;
create policy "admin produto_canal" on public.produto_canal for all using (is_admin()) with check (is_admin());

-- RPCs: execução pública controlada
revoke all on function public.criar_pedido(jsonb) from public;
revoke all on function public.consultar_pedido(uuid) from public;
revoke all on function public.entregador_painel(uuid) from public;
revoke all on function public.entregador_atualizar(uuid, bigint, text, bool, text) from public;
grant execute on function public.criar_pedido(jsonb) to anon, authenticated;
grant execute on function public.consultar_pedido(uuid) to anon, authenticated;
grant execute on function public.entregador_painel(uuid) to anon, authenticated;
grant execute on function public.entregador_atualizar(uuid, bigint, text, bool, text) to anon, authenticated;
