-- ============================================================
-- 05 — Gestão da loja: estoque, caixa (vendas no balcão),
--      contas a pagar, contas a receber e extrato.
-- Aditivo: cria tabelas novas; em produtos só amplia "estoque"
-- para aceitar kg com casas decimais e adiciona estoque mínimo.
-- Toda escrita sensível passa por funções que registram quem fez.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Produtos: estoque em kg/unidade com decimais + mínimo
-- ------------------------------------------------------------
alter table public.produtos alter column estoque type numeric(12,3) using coalesce(estoque,0)::numeric;
alter table public.produtos alter column estoque set default 0;
alter table public.produtos add column if not exists estoque_minimo numeric(12,3) not null default 0;

-- taxas da maquininha (valores de referência — revisar com o contrato)
alter table public.config_loja add column if not exists taxa_debito_pct  numeric(5,2) not null default 1.99;
alter table public.config_loja add column if not exists taxa_credito_pct numeric(5,2) not null default 4.99;
alter table public.config_loja add column if not exists prazo_debito_dias  int not null default 1;
alter table public.config_loja add column if not exists prazo_credito_dias int not null default 30;

-- ------------------------------------------------------------
-- 2) Cadastros
-- ------------------------------------------------------------
create table if not exists public.fornecedores (
  id          bigserial primary key,
  nome        text not null,
  cnpj        text,
  telefone    text,
  contato     text,
  prazo_dias  int default 28,
  observacoes text,
  ativo       bool not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists fornecedores_cnpj_uk on public.fornecedores (cnpj) where cnpj is not null and cnpj <> '';

create table if not exists public.clientes (
  id           bigserial primary key,
  nome         text not null,
  telefone     text,
  cpf          text,
  endereco     text,
  bairro       text,
  limite_fiado numeric(10,2) default 0,
  observacoes  text,
  ativo        bool not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists clientes_nome_idx on public.clientes (lower(nome));

create table if not exists public.contas_financeiras (
  id            bigserial primary key,
  slug          text unique not null,
  nome          text not null,
  tipo          text not null check (tipo in ('caixa','banco','maquininha','outro')),
  saldo_inicial numeric(12,2) not null default 0,
  ativo         bool not null default true,
  ordem         int not null default 0
);

create table if not exists public.categorias_financeiras (
  id    bigserial primary key,
  slug  text unique not null,
  nome  text not null,
  tipo  text not null check (tipo in ('receita','despesa')),
  grupo text,             -- usado no resumo do mês
  ordem int not null default 0,
  ativo bool not null default true
);

-- ------------------------------------------------------------
-- 3) Estoque: todo movimento fica registrado
-- ------------------------------------------------------------
create table if not exists public.estoque_movimentos (
  id          bigserial primary key,
  produto_id  bigint not null references public.produtos(id),
  tipo        text not null check (tipo in ('entrada','venda','pedido','cancelamento','ajuste','perda','inventario','devolucao')),
  quantidade  numeric(12,3) not null,          -- positivo entra, negativo sai
  saldo_apos  numeric(12,3),
  custo_unit  numeric(12,4),
  ref_tipo    text,                            -- compra | venda | pedido | inventario
  ref_id      bigint,
  obs         text,
  usuario     uuid default auth.uid(),
  usuario_nome text,
  em          timestamptz not null default now()
);
create index if not exists estmov_prod_idx on public.estoque_movimentos (produto_id, em desc);
create index if not exists estmov_em_idx on public.estoque_movimentos (em desc);

create or replace function public.nome_usuario()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nome, email) from public.perfis where id = auth.uid()),
                  nullif(current_setting('quintal.ator', true), ''), 'sistema');
$$;

create or replace function public.estoque_aplica()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.produtos set estoque = coalesce(estoque,0) + new.quantidade
   where id = new.produto_id
   returning estoque into new.saldo_apos;
  new.usuario_nome := coalesce(new.usuario_nome, public.nome_usuario());
  return new;
end $$;
drop trigger if exists trg_estoque_aplica on public.estoque_movimentos;
create trigger trg_estoque_aplica before insert on public.estoque_movimentos
  for each row execute function public.estoque_aplica();

-- Entrada de mercadoria (nota do fornecedor)
create table if not exists public.compras (
  id            bigserial primary key,
  fornecedor_id bigint references public.fornecedores(id),
  numero_nf     text,
  chave_nfe     text,
  emissao       date,
  total_produtos numeric(12,2) not null default 0,
  frete         numeric(12,2) not null default 0,
  desconto      numeric(12,2) not null default 0,
  total         numeric(12,2) not null default 0,
  status        text not null default 'lancada' check (status in ('lancada','cancelada')),
  observacoes   text,
  usuario_nome  text,
  created_at    timestamptz not null default now()
);
create unique index if not exists compras_chave_uk on public.compras (chave_nfe) where chave_nfe is not null and chave_nfe <> '' and status = 'lancada';

create table if not exists public.compra_itens (
  id          bigserial primary key,
  compra_id   bigint not null references public.compras(id) on delete cascade,
  produto_id  bigint not null references public.produtos(id),
  descricao_nf text,
  quantidade  numeric(12,3) not null,
  custo_unit  numeric(12,4) not null,
  total       numeric(12,2) not null
);

-- ------------------------------------------------------------
-- 4) Caixa e vendas no balcão
-- ------------------------------------------------------------
create table if not exists public.caixa_sessoes (
  id             bigserial primary key,
  aberto_em      timestamptz not null default now(),
  aberto_por     text,
  valor_abertura numeric(12,2) not null default 0,
  fechado_em     timestamptz,
  fechado_por    text,
  valor_contado  numeric(12,2),
  valor_esperado numeric(12,2),
  diferenca      numeric(12,2),
  status         text not null default 'aberto' check (status in ('aberto','fechado')),
  observacoes    text
);
create unique index if not exists caixa_um_aberto on public.caixa_sessoes ((status)) where status = 'aberto';

create table if not exists public.vendas (
  id           bigserial primary key,
  numero       bigint generated always as identity (start with 1),
  sessao_id    bigint references public.caixa_sessoes(id),
  cliente_id   bigint references public.clientes(id),
  subtotal     numeric(12,2) not null,
  desconto     numeric(12,2) not null default 0,
  total        numeric(12,2) not null,
  status       text not null default 'concluida' check (status in ('concluida','cancelada')),
  vendedor     text,
  cancelada_em timestamptz,
  cancelada_por text,
  motivo_cancel text,
  created_at   timestamptz not null default now()
);
create index if not exists vendas_data_idx on public.vendas (created_at desc);

create table if not exists public.venda_itens (
  id         bigserial primary key,
  venda_id   bigint not null references public.vendas(id) on delete cascade,
  produto_id bigint references public.produtos(id),
  nome       text not null,
  quantidade numeric(12,3) not null,
  preco_unit numeric(12,2) not null,
  total      numeric(12,2) not null,
  custo_unit numeric(12,4)
);

create table if not exists public.venda_pagamentos (
  id       bigserial primary key,
  venda_id bigint not null references public.vendas(id) on delete cascade,
  forma    text not null check (forma in ('dinheiro','pix','debito','credito','fiado')),
  valor    numeric(12,2) not null,      -- valor que abate da venda (sem troco)
  recebido numeric(12,2),               -- dinheiro entregue pelo cliente
  troco    numeric(12,2) not null default 0,
  taxa     numeric(12,2) not null default 0
);

-- ------------------------------------------------------------
-- 5) Financeiro
-- ------------------------------------------------------------
create table if not exists public.contas_pagar (
  id            bigserial primary key,
  descricao     text not null,
  fornecedor_id bigint references public.fornecedores(id),
  categoria_id  bigint references public.categorias_financeiras(id),
  compra_id     bigint references public.compras(id),
  documento     text,
  parcela       int not null default 1,
  total_parcelas int not null default 1,
  vencimento    date not null,
  valor         numeric(12,2) not null check (valor > 0),
  valor_pago    numeric(12,2) not null default 0,
  pago_em       date,
  conta_id      bigint references public.contas_financeiras(id),
  status        text not null default 'aberto' check (status in ('aberto','parcial','pago','cancelado')),
  observacoes   text,
  criado_por    text,
  created_at    timestamptz not null default now()
);
create index if not exists cpagar_venc_idx on public.contas_pagar (status, vencimento);

create table if not exists public.contas_receber (
  id            bigserial primary key,
  descricao     text not null,
  cliente_id    bigint references public.clientes(id),
  categoria_id  bigint references public.categorias_financeiras(id),
  origem        text not null default 'outro' check (origem in ('fiado','cartao','pedido','marketplace','outro')),
  venda_id      bigint references public.vendas(id),
  pedido_id     bigint references public.pedidos(id),
  vencimento    date not null,
  valor         numeric(12,2) not null check (valor > 0),
  valor_recebido numeric(12,2) not null default 0,
  recebido_em   date,
  conta_id      bigint references public.contas_financeiras(id),
  status        text not null default 'aberto' check (status in ('aberto','parcial','recebido','cancelado')),
  observacoes   text,
  criado_por    text,
  created_at    timestamptz not null default now()
);
create index if not exists creceber_venc_idx on public.contas_receber (status, vencimento);

create table if not exists public.movimentos_financeiros (
  id           bigserial primary key,
  conta_id     bigint not null references public.contas_financeiras(id),
  sessao_id    bigint references public.caixa_sessoes(id),
  tipo         text not null check (tipo in ('entrada','saida')),
  valor        numeric(12,2) not null check (valor > 0),
  forma        text,
  categoria_id bigint references public.categorias_financeiras(id),
  descricao    text not null,
  origem       text not null,   -- venda | pedido | recebimento | pagamento | colocar | retirar | transferencia | estorno | abertura
  ref_id       bigint,
  usuario_nome text,
  em           timestamptz not null default now()
);
create index if not exists movfin_conta_idx on public.movimentos_financeiros (conta_id, em desc);
create index if not exists movfin_sessao_idx on public.movimentos_financeiros (sessao_id);

-- marca para não lançar o mesmo pedido online duas vezes
alter table public.pedidos add column if not exists financeiro_lancado bool not null default false;

-- ------------------------------------------------------------
-- 6) Dados iniciais
-- ------------------------------------------------------------
insert into public.contas_financeiras (slug, nome, tipo, ordem) values
  ('caixa', 'Dinheiro do caixa', 'caixa', 1),
  ('banco', 'Banco / Pix', 'banco', 2),
  ('maquininha', 'Maquininha de cartão', 'maquininha', 3)
on conflict (slug) do nothing;

insert into public.categorias_financeiras (slug, nome, tipo, grupo, ordem) values
  ('venda-balcao',      'Vendas no balcão',       'receita', 'Vendas', 1),
  ('venda-online',      'Vendas do site',         'receita', 'Vendas', 2),
  ('venda-marketplace', 'Vendas em aplicativos',  'receita', 'Vendas', 3),
  ('outras-receitas',   'Outras entradas',        'receita', 'Outras', 4),
  ('mercadoria',        'Compra de mercadoria',   'despesa', 'Mercadoria', 10),
  ('aluguel',           'Aluguel',                'despesa', 'Despesas da loja', 11),
  ('energia-agua',      'Luz, água e internet',   'despesa', 'Despesas da loja', 12),
  ('funcionarios',      'Funcionários',           'despesa', 'Pessoal', 13),
  ('entregas',          'Entregas (motoboy)',     'despesa', 'Entregas', 14),
  ('impostos',          'Impostos',               'despesa', 'Impostos', 15),
  ('taxas-cartao',      'Taxas de cartão e apps', 'despesa', 'Taxas', 16),
  ('manutencao',        'Manutenção e limpeza',   'despesa', 'Despesas da loja', 17),
  ('outras-despesas',   'Outras despesas',        'despesa', 'Outras', 18)
on conflict (slug) do nothing;

-- ------------------------------------------------------------
-- 7) Funções auxiliares
-- ------------------------------------------------------------
create or replace function public.conta_id(p_slug text) returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.contas_financeiras where slug = p_slug;
$$;
create or replace function public.categoria_id(p_slug text) returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.categorias_financeiras where slug = p_slug;
$$;
create or replace function public.caixa_aberto() returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.caixa_sessoes where status = 'aberto' limit 1;
$$;
create or replace function public.custo_produto(p_id bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select custo from public.produtos_custos where produto_id = p_id;
$$;

-- ------------------------------------------------------------
-- 8) Caixa: abrir, colocar/retirar dinheiro, fechar
-- ------------------------------------------------------------
create or replace function public.caixa_abrir(p_valor numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.caixa_sessoes;
begin
  if not public.is_vendedor() then raise exception 'Sem permissão'; end if;
  if public.caixa_aberto() is not null then raise exception 'O caixa já está aberto'; end if;
  if p_valor is null or p_valor < 0 then raise exception 'Valor inválido'; end if;
  insert into public.caixa_sessoes (valor_abertura, aberto_por) values (round(p_valor,2), public.nome_usuario())
  returning * into s;
  return to_jsonb(s);
end $$;

create or replace function public.caixa_movimentar(p_tipo text, p_valor numeric, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s bigint := public.caixa_aberto(); v_id bigint;
begin
  if not public.is_vendedor() then raise exception 'Sem permissão'; end if;
  if v_s is null then raise exception 'Abra o caixa primeiro'; end if;
  if p_tipo not in ('colocar','retirar') then raise exception 'Tipo inválido'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor'; end if;
  if coalesce(btrim(p_motivo),'') = '' then raise exception 'Diga o motivo'; end if;
  insert into public.movimentos_financeiros (conta_id, sessao_id, tipo, valor, forma, descricao, origem, usuario_nome)
  values (public.conta_id('caixa'), v_s, case when p_tipo='colocar' then 'entrada' else 'saida' end,
          round(p_valor,2), 'dinheiro', left(p_motivo,200), p_tipo, public.nome_usuario())
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- resumo do caixa aberto (o valor esperado só aparece depois da contagem)
create or replace function public.caixa_resumo(p_sessao bigint default null, p_mostrar_esperado bool default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.caixa_sessoes; r jsonb; v_esp numeric;
begin
  if not public.is_vendedor() then raise exception 'Sem permissão'; end if;
  select * into s from public.caixa_sessoes where id = coalesce(p_sessao, public.caixa_aberto());
  if not found then return null; end if;
  v_esp := s.valor_abertura + coalesce((
    select sum(case when tipo='entrada' then valor else -valor end)
      from public.movimentos_financeiros where sessao_id = s.id and conta_id = public.conta_id('caixa')), 0);
  select jsonb_build_object(
    'sessao', to_jsonb(s),
    'vendas_qtd', (select count(*) from public.vendas where sessao_id = s.id and status='concluida'),
    'vendas_total', coalesce((select sum(total) from public.vendas where sessao_id = s.id and status='concluida'),0),
    'por_forma', coalesce((select jsonb_object_agg(forma, v) from (
        select vp.forma, sum(vp.valor) v from public.venda_pagamentos vp join public.vendas v on v.id = vp.venda_id
         where v.sessao_id = s.id and v.status='concluida' group by vp.forma) x), '{}'::jsonb),
    'colocado', coalesce((select sum(valor) from public.movimentos_financeiros where sessao_id=s.id and origem='colocar'),0),
    'retirado', coalesce((select sum(valor) from public.movimentos_financeiros where sessao_id=s.id and origem='retirar'),0),
    'pagamentos_dinheiro', coalesce((select sum(valor) from public.movimentos_financeiros where sessao_id=s.id and origem='pagamento'),0),
    'recebimentos_dinheiro', coalesce((select sum(valor) from public.movimentos_financeiros where sessao_id=s.id and origem in ('recebimento','pedido')),0),
    'esperado', case when p_mostrar_esperado or s.status='fechado' then round(v_esp,2) end
  ) into r;
  return r;
end $$;

create or replace function public.caixa_fechar(p_contado numeric, p_obs text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s bigint := public.caixa_aberto(); r jsonb; v_esp numeric;
begin
  if not public.is_vendedor() then raise exception 'Sem permissão'; end if;
  if v_s is null then raise exception 'Não há caixa aberto'; end if;
  if p_contado is null or p_contado < 0 then raise exception 'Informe quanto dinheiro tem na gaveta'; end if;
  r := public.caixa_resumo(v_s, true);
  v_esp := (r->>'esperado')::numeric;
  update public.caixa_sessoes set status='fechado', fechado_em=now(), fechado_por=public.nome_usuario(),
         valor_contado=round(p_contado,2), valor_esperado=v_esp, diferenca=round(p_contado - v_esp,2),
         observacoes=left(p_obs,300)
   where id = v_s;
  return public.caixa_resumo(v_s, true);
end $$;

-- dinheiro na gaveta: caixa aberto = abertura + movimentos; fechado = o que foi contado
create or replace function public.saldo_gaveta() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.valor_abertura + coalesce((select sum(case when m.tipo='entrada' then m.valor else -m.valor end)
        from public.movimentos_financeiros m where m.sessao_id = s.id and m.conta_id = public.conta_id('caixa')),0)
       from public.caixa_sessoes s where s.status = 'aberto'),
    (select valor_contado from public.caixa_sessoes where status = 'fechado' order by fechado_em desc limit 1), 0);
$$;

-- ------------------------------------------------------------
-- 9) Venda no balcão
-- payload: {cliente_id?, desconto?, itens:[{produto_id, quantidade, preco_unit?}],
--           pagamentos:[{forma, valor, recebido?}], vencimento_fiado?}
-- ------------------------------------------------------------
create or replace function public.registrar_venda(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg public.config_loja;
  v_s bigint := public.caixa_aberto();
  prod public.produtos;
  item jsonb; pg jsonb;
  v_qtd numeric; v_preco numeric; v_sub numeric := 0; v_desc numeric := coalesce((payload->>'desconto')::numeric,0);
  v_total numeric; v_pago numeric := 0; v_val numeric; v_rec numeric; v_troco numeric; v_taxa numeric;
  v_forma text; v_cli bigint := nullif(payload->>'cliente_id','')::bigint;
  v_venda public.vendas; v_nome text := public.nome_usuario();
  v_itens jsonb := '[]'; v_ref text;
begin
  if not public.is_vendedor() then raise exception 'Sem permissão'; end if;
  if v_s is null then raise exception 'Abra o caixa antes de vender'; end if;
  -- dinheiro e Pix pagam o preço à vista; cartão e fiado pagam o preço normal
  v_ref := case when exists (select 1 from jsonb_array_elements(coalesce(payload->'pagamentos','[]')) x
                              where x->>'forma' in ('debito','credito','fiado') and (x->>'valor')::numeric > 0)
                then 'cartao' else 'dinheiro' end;
  select * into cfg from public.config_loja where id = 1;
  if jsonb_typeof(payload->'itens') <> 'array' or jsonb_array_length(payload->'itens') = 0 then raise exception 'Nenhum produto na venda'; end if;

  for item in select * from jsonb_array_elements(payload->'itens') loop
    v_qtd := (item->>'quantidade')::numeric;
    if v_qtd is null or v_qtd <= 0 then raise exception 'Quantidade inválida'; end if;
    select * into prod from public.produtos where id = (item->>'produto_id')::bigint;
    if not found then raise exception 'Produto não encontrado'; end if;
    v_preco := coalesce(nullif(item->>'preco_unit','')::numeric, public.preco_efetivo(prod, v_ref));
    if v_preco is null or v_preco <= 0 then raise exception 'Produto sem preço: %', prod.nome; end if;
    -- vendedor não pode vender abaixo de 85% do preço de tabela; admin pode
    if not public.is_admin() and v_preco < round(coalesce(public.preco_efetivo(prod, v_ref), v_preco) * 0.85, 2) then
      raise exception 'Preço de % abaixo do permitido', prod.nome;
    end if;
    v_sub := v_sub + round(v_qtd * v_preco, 2);
    v_itens := v_itens || jsonb_build_object('produto_id', prod.id, 'nome', prod.nome, 'quantidade', v_qtd,
                 'preco_unit', v_preco, 'total', round(v_qtd * v_preco, 2), 'custo', public.custo_produto(prod.id));
  end loop;

  if v_desc < 0 or v_desc > v_sub then raise exception 'Desconto inválido'; end if;
  if not public.is_admin() and v_desc > round(v_sub * 0.10, 2) then raise exception 'Desconto acima de 10%% precisa do dono'; end if;
  v_total := v_sub - v_desc;

  for pg in select * from jsonb_array_elements(payload->'pagamentos') loop
    v_pago := v_pago + (pg->>'valor')::numeric;
  end loop;
  if round(v_pago,2) <> round(v_total,2) then
    raise exception 'Pagamento (R$ %) diferente do total (R$ %)', to_char(v_pago,'FM999G990D00'), to_char(v_total,'FM999G990D00');
  end if;

  insert into public.vendas (sessao_id, cliente_id, subtotal, desconto, total, vendedor)
  values (v_s, v_cli, v_sub, v_desc, v_total, v_nome) returning * into v_venda;

  for item in select * from jsonb_array_elements(v_itens) loop
    insert into public.venda_itens (venda_id, produto_id, nome, quantidade, preco_unit, total, custo_unit)
    values (v_venda.id, (item->>'produto_id')::bigint, item->>'nome', (item->>'quantidade')::numeric,
            (item->>'preco_unit')::numeric, (item->>'total')::numeric, nullif(item->>'custo','')::numeric);
    insert into public.estoque_movimentos (produto_id, tipo, quantidade, ref_tipo, ref_id, obs, usuario_nome)
    values ((item->>'produto_id')::bigint, 'venda', -(item->>'quantidade')::numeric, 'venda', v_venda.id,
            'Venda balcão #' || v_venda.numero, v_nome);
  end loop;

  for pg in select * from jsonb_array_elements(payload->'pagamentos') loop
    v_forma := pg->>'forma'; v_val := round((pg->>'valor')::numeric,2);
    if v_val <= 0 then continue; end if;
    v_rec := nullif(pg->>'recebido','')::numeric; v_troco := 0; v_taxa := 0;
    if v_forma = 'dinheiro' then
      v_troco := greatest(coalesce(v_rec, v_val) - v_val, 0);
      insert into public.movimentos_financeiros (conta_id, sessao_id, tipo, valor, forma, categoria_id, descricao, origem, ref_id, usuario_nome)
      values (public.conta_id('caixa'), v_s, 'entrada', v_val, 'dinheiro', public.categoria_id('venda-balcao'),
              'Venda #' || v_venda.numero, 'venda', v_venda.id, v_nome);
    elsif v_forma = 'pix' then
      insert into public.movimentos_financeiros (conta_id, sessao_id, tipo, valor, forma, categoria_id, descricao, origem, ref_id, usuario_nome)
      values (public.conta_id('banco'), v_s, 'entrada', v_val, 'pix', public.categoria_id('venda-balcao'),
              'Venda #' || v_venda.numero || ' (Pix)', 'venda', v_venda.id, v_nome);
    elsif v_forma in ('debito','credito') then
      v_taxa := round(v_val * (case when v_forma='debito' then cfg.taxa_debito_pct else cfg.taxa_credito_pct end) / 100, 2);
      insert into public.contas_receber (descricao, categoria_id, origem, venda_id, vencimento, valor, conta_id, criado_por)
      values ('Cartão ' || case when v_forma='debito' then 'débito' else 'crédito' end || ' — venda #' || v_venda.numero
              || ' (R$ ' || to_char(v_val,'FM999G990D00') || ' − taxa)',
              public.categoria_id('venda-balcao'), 'cartao', v_venda.id,
              current_date + case when v_forma='debito' then cfg.prazo_debito_dias else cfg.prazo_credito_dias end,
              v_val - v_taxa, public.conta_id('maquininha'), v_nome);
    elsif v_forma = 'fiado' then
      if v_cli is null then raise exception 'Para vender fiado, escolha o cliente'; end if;
      insert into public.contas_receber (descricao, cliente_id, categoria_id, origem, venda_id, vencimento, valor, criado_por)
      values ('Fiado — venda #' || v_venda.numero, v_cli, public.categoria_id('venda-balcao'), 'fiado', v_venda.id,
              coalesce(nullif(payload->>'vencimento_fiado','')::date, current_date + 30), v_val, v_nome);
    else
      raise exception 'Forma de pagamento inválida';
    end if;
    insert into public.venda_pagamentos (venda_id, forma, valor, recebido, troco, taxa)
    values (v_venda.id, v_forma, v_val, v_rec, v_troco, v_taxa);
  end loop;

  return jsonb_build_object('id', v_venda.id, 'numero', v_venda.numero, 'total', v_total,
    'troco', coalesce((select sum(troco) from public.venda_pagamentos where venda_id = v_venda.id),0),
    'itens', v_itens, 'em', v_venda.created_at, 'vendedor', v_nome);
end $$;

create or replace function public.cancelar_venda(p_id bigint, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.vendas; it record; mv record; v_nome text := public.nome_usuario();
begin
  if not public.is_admin() then raise exception 'Só o dono pode cancelar venda'; end if;
  if coalesce(btrim(p_motivo),'') = '' then raise exception 'Diga o motivo'; end if;
  select * into v from public.vendas where id = p_id for update;
  if not found or v.status <> 'concluida' then raise exception 'Venda não encontrada ou já cancelada'; end if;
  update public.vendas set status='cancelada', cancelada_em=now(), cancelada_por=v_nome, motivo_cancel=left(p_motivo,200) where id = p_id;
  for it in select * from public.venda_itens where venda_id = p_id and produto_id is not null loop
    insert into public.estoque_movimentos (produto_id, tipo, quantidade, ref_tipo, ref_id, obs, usuario_nome)
    values (it.produto_id, 'cancelamento', it.quantidade, 'venda', p_id, 'Cancelamento venda #' || v.numero, v_nome);
  end loop;
  for mv in select * from public.movimentos_financeiros where origem='venda' and ref_id = p_id loop
    insert into public.movimentos_financeiros (conta_id, sessao_id, tipo, valor, forma, categoria_id, descricao, origem, ref_id, usuario_nome)
    values (mv.conta_id, case when mv.conta_id = public.conta_id('caixa') then public.caixa_aberto() end,
            'saida', mv.valor, mv.forma, mv.categoria_id, 'Estorno venda #' || v.numero, 'estorno', p_id, v_nome);
  end loop;
  update public.contas_receber set status='cancelado', observacoes = 'Venda cancelada'
   where venda_id = p_id and status in ('aberto','parcial');
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------
-- 10) Pagar e receber contas
-- ------------------------------------------------------------
create or replace function public.pagar_conta(p_id bigint, p_valor numeric, p_conta text, p_data date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.contas_pagar; v_conta bigint := public.conta_id(p_conta); v_sess bigint;
begin
  if not public.is_admin() then raise exception 'Só o dono pode pagar contas'; end if;
  select * into c from public.contas_pagar where id = p_id for update;
  if not found or c.status in ('pago','cancelado') then raise exception 'Conta já paga ou cancelada'; end if;
  if v_conta is null then raise exception 'Escolha de onde saiu o dinheiro'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor pago'; end if;
  if p_conta = 'caixa' then
    v_sess := public.caixa_aberto();
    if v_sess is null then raise exception 'Para pagar com dinheiro do caixa, abra o caixa'; end if;
  end if;
  insert into public.movimentos_financeiros (conta_id, sessao_id, tipo, valor, forma, categoria_id, descricao, origem, ref_id, usuario_nome)
  values (v_conta, v_sess, 'saida', round(p_valor,2), p_conta, c.categoria_id, c.descricao, 'pagamento', c.id, public.nome_usuario());
  update public.contas_pagar set valor_pago = valor_pago + round(p_valor,2), pago_em = p_data, conta_id = v_conta,
         status = case when valor_pago + round(p_valor,2) >= valor then 'pago' else 'parcial' end
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.receber_conta(p_id bigint, p_valor numeric, p_conta text, p_data date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.contas_receber; v_conta bigint := public.conta_id(p_conta); v_sess bigint;
begin
  if not public.is_vendedor() then raise exception 'Sem permissão'; end if;
  select * into c from public.contas_receber where id = p_id for update;
  if not found or c.status in ('recebido','cancelado') then raise exception 'Conta já recebida ou cancelada'; end if;
  if c.origem <> 'fiado' and not public.is_admin() then raise exception 'Só o dono confirma esse recebimento'; end if;
  if v_conta is null then raise exception 'Escolha onde o dinheiro entrou'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor recebido'; end if;
  if p_conta = 'caixa' then
    v_sess := public.caixa_aberto();
    if v_sess is null then raise exception 'Para receber em dinheiro, abra o caixa'; end if;
  end if;
  insert into public.movimentos_financeiros (conta_id, sessao_id, tipo, valor, forma, categoria_id, descricao, origem, ref_id, usuario_nome)
  values (v_conta, v_sess, 'entrada', round(p_valor,2), p_conta, c.categoria_id, 'Recebido: ' || c.descricao, 'recebimento', c.id, public.nome_usuario());
  update public.contas_receber set valor_recebido = valor_recebido + round(p_valor,2), recebido_em = p_data, conta_id = v_conta,
         status = case when valor_recebido + round(p_valor,2) >= valor then 'recebido' else 'parcial' end
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- nova conta a pagar (com parcelas mensais ou repetição)
create or replace function public.nova_conta_pagar(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int := greatest(1, least(coalesce((payload->>'parcelas')::int,1), 36)); i int; v_val numeric := (payload->>'valor')::numeric;
  v_venc date := (payload->>'vencimento')::date; v_parc numeric; v_ids jsonb := '[]';
  v_rep bool := coalesce((payload->>'repetir')::bool, false); v_id bigint;
begin
  if not public.is_admin() then raise exception 'Só o dono lança contas a pagar'; end if;
  if coalesce(btrim(payload->>'descricao'),'') = '' then raise exception 'Diga o que é a conta'; end if;
  if v_val is null or v_val <= 0 then raise exception 'Informe o valor'; end if;
  if v_venc is null then raise exception 'Informe o vencimento'; end if;
  for i in 1..n loop
    -- repetir = mesma conta todo mês (ex.: aluguel); senão divide o valor em parcelas
    v_parc := case when v_rep then v_val when i < n then round(v_val / n, 2) else v_val - round(v_val / n, 2) * (n - 1) end;
    insert into public.contas_pagar (descricao, fornecedor_id, categoria_id, documento, parcela, total_parcelas, vencimento, valor, observacoes, criado_por)
    values (left(payload->>'descricao',150), nullif(payload->>'fornecedor_id','')::bigint,
            coalesce(nullif(payload->>'categoria_id','')::bigint, public.categoria_id('outras-despesas')),
            left(payload->>'documento',60), i, n, (v_venc + make_interval(months => i - 1))::date, v_parc,
            left(payload->>'observacoes',300), public.nome_usuario())
    returning id into v_id;
    v_ids := v_ids || to_jsonb(v_id);
  end loop;
  return jsonb_build_object('ids', v_ids);
end $$;

-- ------------------------------------------------------------
-- 11) Entrada de mercadoria (com nota) e ajustes de estoque
-- payload: {fornecedor_id? | fornecedor:{nome,cnpj}, numero_nf, chave_nfe, emissao, frete, desconto,
--           itens:[{produto_id, quantidade, custo_unit, descricao_nf}],
--           pagamento: {tipo:'prazo', parcelas:[{vencimento, valor}]} | {tipo:'pago', conta:'caixa|banco'}}
-- ------------------------------------------------------------
create or replace function public.lancar_entrada(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_forn bigint := nullif(payload->>'fornecedor_id','')::bigint;
  item jsonb; parc jsonb; v_c public.compras; v_tot numeric := 0; v_frete numeric := coalesce((payload->>'frete')::numeric,0);
  v_desc numeric := coalesce((payload->>'desconto')::numeric,0); v_qtd numeric; v_custo numeric;
  v_ant_qtd numeric; v_ant_custo numeric; v_rateio numeric; v_nome text := public.nome_usuario(); n int; i int := 0; v_cp bigint;
begin
  if not public.is_admin() then raise exception 'Só o dono lança entrada de mercadoria'; end if;
  if jsonb_typeof(payload->'itens') <> 'array' or jsonb_array_length(payload->'itens') = 0 then raise exception 'Nenhum produto na entrada'; end if;
  if v_forn is null and coalesce(btrim(payload->'fornecedor'->>'nome'),'') <> '' then
    select id into v_forn from public.fornecedores
     where cnpj = nullif(regexp_replace(coalesce(payload->'fornecedor'->>'cnpj',''),'\D','','g'),'') limit 1;
    if v_forn is null then
      insert into public.fornecedores (nome, cnpj) values (left(payload->'fornecedor'->>'nome',150),
        nullif(regexp_replace(coalesce(payload->'fornecedor'->>'cnpj',''),'\D','','g'),'')) returning id into v_forn;
    end if;
  end if;
  for item in select * from jsonb_array_elements(payload->'itens') loop
    v_tot := v_tot + round((item->>'quantidade')::numeric * (item->>'custo_unit')::numeric, 2);
  end loop;

  insert into public.compras (fornecedor_id, numero_nf, chave_nfe, emissao, total_produtos, frete, desconto, total, observacoes, usuario_nome)
  values (v_forn, left(payload->>'numero_nf',20), nullif(payload->>'chave_nfe',''), nullif(payload->>'emissao','')::date,
          v_tot, v_frete, v_desc, v_tot + v_frete - v_desc, left(payload->>'observacoes',300), v_nome)
  returning * into v_c;

  for item in select * from jsonb_array_elements(payload->'itens') loop
    v_qtd := (item->>'quantidade')::numeric; v_custo := (item->>'custo_unit')::numeric;
    if v_qtd is null or v_qtd <= 0 or v_custo is null or v_custo < 0 then raise exception 'Quantidade ou custo inválido'; end if;
    -- frete e desconto da nota entram no custo de cada item, proporcional ao valor
    v_rateio := case when v_tot > 0 then (v_frete - v_desc) * (v_qtd * v_custo) / v_tot / v_qtd else 0 end;
    v_custo := v_custo + v_rateio;
    insert into public.compra_itens (compra_id, produto_id, descricao_nf, quantidade, custo_unit, total)
    values (v_c.id, (item->>'produto_id')::bigint, left(item->>'descricao_nf',200), v_qtd, v_custo, round(v_qtd*v_custo,2));
    -- custo médio ponderado
    select greatest(coalesce(estoque,0),0) into v_ant_qtd from public.produtos where id = (item->>'produto_id')::bigint;
    v_ant_custo := public.custo_produto((item->>'produto_id')::bigint);
    insert into public.produtos_custos (produto_id, custo, updated_at)
    values ((item->>'produto_id')::bigint,
            round(case when v_ant_custo is null or v_ant_qtd = 0 then v_custo
                       else (v_ant_qtd * v_ant_custo + v_qtd * v_custo) / (v_ant_qtd + v_qtd) end, 4), now())
    on conflict (produto_id) do update set custo = excluded.custo, updated_at = now();
    insert into public.estoque_movimentos (produto_id, tipo, quantidade, custo_unit, ref_tipo, ref_id, obs, usuario_nome)
    values ((item->>'produto_id')::bigint, 'entrada', v_qtd, v_custo, 'compra', v_c.id,
            'Nota ' || coalesce(v_c.numero_nf,'s/n'), v_nome);
  end loop;

  if payload->'pagamento'->>'tipo' = 'pago' then
    insert into public.contas_pagar (descricao, fornecedor_id, categoria_id, compra_id, documento, vencimento, valor, criado_por)
    values ('Mercadoria — nota ' || coalesce(v_c.numero_nf,'s/n'), v_forn, public.categoria_id('mercadoria'), v_c.id,
            v_c.numero_nf, current_date, v_c.total, v_nome) returning id into v_cp;
    perform public.pagar_conta(v_cp, v_c.total, coalesce(payload->'pagamento'->>'conta','banco'));
  elsif jsonb_typeof(payload->'pagamento'->'parcelas') = 'array' then
    n := jsonb_array_length(payload->'pagamento'->'parcelas');
    for parc in select * from jsonb_array_elements(payload->'pagamento'->'parcelas') loop
      i := i + 1;
      insert into public.contas_pagar (descricao, fornecedor_id, categoria_id, compra_id, documento, parcela, total_parcelas, vencimento, valor, criado_por)
      values ('Mercadoria — nota ' || coalesce(v_c.numero_nf,'s/n'), v_forn, public.categoria_id('mercadoria'), v_c.id,
              v_c.numero_nf, i, n, (parc->>'vencimento')::date, (parc->>'valor')::numeric, v_nome);
    end loop;
  end if;
  return jsonb_build_object('id', v_c.id, 'total', v_c.total, 'fornecedor_id', v_forn);
end $$;

-- ajuste simples: "contei e tem X" ou "perdi/estragou X"
create or replace function public.ajustar_estoque(p_produto bigint, p_tipo text, p_quantidade numeric, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_atual numeric; v_delta numeric;
begin
  if not public.is_vendedor() then raise exception 'Sem permissão'; end if;
  if p_quantidade is null or p_quantidade < 0 then raise exception 'Quantidade inválida'; end if;
  select coalesce(estoque,0) into v_atual from public.produtos where id = p_produto;
  if not found then raise exception 'Produto não encontrado'; end if;
  if p_tipo = 'contagem' then v_delta := p_quantidade - v_atual;
  elsif p_tipo = 'perda' then v_delta := -p_quantidade;
  else raise exception 'Tipo inválido'; end if;
  if v_delta = 0 then return jsonb_build_object('saldo', v_atual); end if;
  insert into public.estoque_movimentos (produto_id, tipo, quantidade, obs)
  values (p_produto, case when p_tipo='contagem' then 'inventario' else 'perda' end, v_delta,
          left(coalesce(nullif(btrim(p_motivo),''), case when p_tipo='contagem' then 'Contagem' else 'Perda' end),200));
  return jsonb_build_object('saldo', v_atual + v_delta);
end $$;

-- ------------------------------------------------------------
-- 12) Pedidos online entram no financeiro automaticamente
-- ------------------------------------------------------------
create or replace function public.pedido_financeiro()
returns trigger language plpgsql security definer set search_path = public as $$
declare cfg public.config_loja; ch public.canais_venda; v_desc text := 'Pedido #' || new.numero; v_cat bigint; v_taxa numeric;
begin
  if new.financeiro_lancado or new.status = 'cancelado' then return new; end if;
  select * into ch from public.canais_venda where id = new.canal_id;
  v_cat := public.categoria_id(case when ch.tipo = 'proprio' or ch.tipo is null then 'venda-online' else 'venda-marketplace' end);

  if new.pagamento_forma in ('pix_online','pix_entrega','cartao_online')
     and new.pagamento_status in ('pago','conferido') then
    insert into public.movimentos_financeiros (conta_id, tipo, valor, forma, categoria_id, descricao, origem, ref_id, usuario_nome)
    values (public.conta_id('banco'), 'entrada', new.total, new.pagamento_forma, v_cat, v_desc, 'pedido', new.id, public.nome_usuario());
    new.financeiro_lancado := true;
  elsif new.pagamento_forma = 'dinheiro' and new.pagamento_status = 'conferido' then
    insert into public.movimentos_financeiros (conta_id, sessao_id, tipo, valor, forma, categoria_id, descricao, origem, ref_id, usuario_nome)
    values (public.conta_id('caixa'), public.caixa_aberto(), 'entrada', new.total, 'dinheiro', v_cat, v_desc, 'pedido', new.id, public.nome_usuario());
    new.financeiro_lancado := true;
  elsif new.pagamento_forma = 'cartao_entrega' and new.pagamento_status = 'conferido' then
    select * into cfg from public.config_loja where id = 1;
    v_taxa := round(new.total * cfg.taxa_credito_pct / 100, 2);
    insert into public.contas_receber (descricao, categoria_id, origem, pedido_id, vencimento, valor, conta_id, criado_por)
    values ('Cartão — ' || v_desc, v_cat, 'cartao', new.id, current_date + cfg.prazo_credito_dias, new.total - v_taxa,
            public.conta_id('maquininha'), public.nome_usuario());
    new.financeiro_lancado := true;
  elsif new.pagamento_forma = 'marketplace' and new.status = 'entregue' then
    v_taxa := round(new.total * coalesce(ch.comissao_pct,0) / 100 + coalesce(ch.tarifa_fixa,0), 2);
    insert into public.contas_receber (descricao, categoria_id, origem, pedido_id, vencimento, valor, conta_id, criado_por)
    values (coalesce(ch.nome,'App') || ' — ' || v_desc || coalesce(' (' || new.pedido_externo || ')',''), v_cat, 'marketplace', new.id,
            current_date + 30, greatest(new.total - v_taxa, 0.01), public.conta_id('banco'), public.nome_usuario());
    new.financeiro_lancado := true;
  end if;
  return new;
end $$;
drop trigger if exists trg_pedido_financeiro on public.pedidos;
create trigger trg_pedido_financeiro before update on public.pedidos
  for each row execute function public.pedido_financeiro();

-- ------------------------------------------------------------
-- 13) Resumo do dia / do período (tela inicial)
-- ------------------------------------------------------------
create or replace function public.resumo_loja(p_ini date default current_date, p_fim date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_admin bool := public.is_admin();
begin
  if not public.is_vendedor() then raise exception 'Sem permissão'; end if;
  select jsonb_build_object(
    'vendas_balcao', coalesce((select sum(total) from public.vendas where status='concluida' and created_at::date between p_ini and p_fim),0),
    'vendas_balcao_qtd', (select count(*) from public.vendas where status='concluida' and created_at::date between p_ini and p_fim),
    'vendas_online', coalesce((select sum(total) from public.pedidos where status <> 'cancelado' and created_at::date between p_ini and p_fim),0),
    'vendas_online_qtd', (select count(*) from public.pedidos where status <> 'cancelado' and created_at::date between p_ini and p_fim),
    'pedidos_abertos', (select count(*) from public.pedidos where status in ('novo','confirmado','separando','pronto','em_rota')),
    'estoque_baixo', (select count(*) from public.produtos where ativo and estoque_minimo > 0 and estoque <= estoque_minimo),
    'estoque_negativo', (select count(*) from public.produtos where ativo and estoque < 0),
    'caixa_aberto', public.caixa_aberto() is not null,
    'fiado_aberto', coalesce((select sum(valor - valor_recebido) from public.contas_receber where origem='fiado' and status in ('aberto','parcial')),0),
    'pagar_hoje',    case when v_admin then coalesce((select sum(valor - valor_pago) from public.contas_pagar where status in ('aberto','parcial') and vencimento = current_date),0) end,
    'pagar_vencido', case when v_admin then coalesce((select sum(valor - valor_pago) from public.contas_pagar where status in ('aberto','parcial') and vencimento < current_date),0) end,
    'pagar_7dias',   case when v_admin then coalesce((select sum(valor - valor_pago) from public.contas_pagar where status in ('aberto','parcial') and vencimento between current_date and current_date + 7),0) end,
    'receber_7dias', case when v_admin then coalesce((select sum(valor - valor_recebido) from public.contas_receber where status in ('aberto','parcial') and vencimento <= current_date + 7),0) end,
    'saldos', case when v_admin then (select jsonb_agg(jsonb_build_object('slug', c.slug, 'nome', c.nome,
                'saldo', case when c.slug = 'caixa' then public.saldo_gaveta()
                         else c.saldo_inicial + coalesce((select sum(case when m.tipo='entrada' then m.valor else -m.valor end)
                                                     from public.movimentos_financeiros m where m.conta_id = c.id),0) end)
                order by c.ordem) from public.contas_financeiras c where c.ativo) end,
    -- resultado do período (só dono)
    'custo_mercadoria', case when v_admin then coalesce((select sum(vi.quantidade * vi.custo_unit) from public.venda_itens vi join public.vendas v on v.id = vi.venda_id
                          where v.status='concluida' and v.created_at::date between p_ini and p_fim),0)
                        + coalesce((select sum(pi.quantidade * pc.custo) from public.pedido_itens pi join public.pedidos p on p.id = pi.pedido_id
                          join public.produtos_custos pc on pc.produto_id = pi.produto_id
                          where p.status <> 'cancelado' and p.created_at::date between p_ini and p_fim),0) end,
    'sem_custo', (select count(distinct vi.produto_id) from public.venda_itens vi join public.vendas v on v.id = vi.venda_id
                   where v.status='concluida' and v.created_at::date between p_ini and p_fim and vi.custo_unit is null),
    'taxas', case when v_admin then coalesce((select sum(vp.taxa) from public.venda_pagamentos vp join public.vendas v on v.id = vp.venda_id
               where v.status='concluida' and v.created_at::date between p_ini and p_fim),0) end,
    'entregas_custo', case when v_admin then coalesce((select sum(custo_entrega) from public.pedidos where status='entregue' and created_at::date between p_ini and p_fim),0) end,
    'despesas', case when v_admin then (select coalesce(jsonb_agg(jsonb_build_object('grupo', grupo, 'valor', v) order by v desc),'[]') from (
                  select cf.grupo, sum(m.valor) v from public.movimentos_financeiros m join public.categorias_financeiras cf on cf.id = m.categoria_id
                   where m.tipo='saida' and m.origem='pagamento' and cf.slug <> 'mercadoria' and m.em::date between p_ini and p_fim group by cf.grupo) x) end
  ) into r;
  return r;
end $$;

-- ------------------------------------------------------------
-- 14) Estoque dos pedidos online passa a usar o registro de movimentos
-- ------------------------------------------------------------
-- (as funções criar_pedido e pedido_audit são recriadas no fim deste arquivo)

-- ------------------------------------------------------------
-- 15) Segurança (RLS): leitura conforme o papel, escrita pelas funções
-- ------------------------------------------------------------
alter table public.fornecedores           enable row level security;
alter table public.clientes               enable row level security;
alter table public.contas_financeiras     enable row level security;
alter table public.categorias_financeiras enable row level security;
alter table public.estoque_movimentos     enable row level security;
alter table public.compras                enable row level security;
alter table public.compra_itens           enable row level security;
alter table public.caixa_sessoes          enable row level security;
alter table public.vendas                 enable row level security;
alter table public.venda_itens            enable row level security;
alter table public.venda_pagamentos       enable row level security;
alter table public.contas_pagar           enable row level security;
alter table public.contas_receber         enable row level security;
alter table public.movimentos_financeiros enable row level security;

create policy "equipe ler fornecedores" on public.fornecedores for select using (is_vendedor());
create policy "admin fornecedores"      on public.fornecedores for all using (is_admin()) with check (is_admin());
create policy "equipe clientes"         on public.clientes for all using (is_vendedor()) with check (is_vendedor());
create policy "equipe ler contas"       on public.contas_financeiras for select using (is_vendedor());
create policy "admin contas"            on public.contas_financeiras for all using (is_admin()) with check (is_admin());
create policy "equipe ler categorias fin" on public.categorias_financeiras for select using (is_vendedor());
create policy "admin categorias fin"    on public.categorias_financeiras for all using (is_admin()) with check (is_admin());
create policy "equipe ler estoque mov"  on public.estoque_movimentos for select using (is_vendedor());
create policy "admin ler compras"       on public.compras for select using (is_admin());
create policy "admin ler compra itens"  on public.compra_itens for select using (is_admin());
create policy "equipe ler caixa"        on public.caixa_sessoes for select using (is_vendedor());
create policy "equipe ler vendas"       on public.vendas for select using (is_vendedor());
create policy "equipe ler venda itens"  on public.venda_itens for select using (is_vendedor());
create policy "equipe ler venda pagtos" on public.venda_pagamentos for select using (is_vendedor());
create policy "admin contas pagar"      on public.contas_pagar for all using (is_admin()) with check (is_admin());
create policy "equipe ler fiado"        on public.contas_receber for select using (is_vendedor() and (origem = 'fiado' or is_admin()));
create policy "admin contas receber"    on public.contas_receber for all using (is_admin()) with check (is_admin());
create policy "admin extrato"           on public.movimentos_financeiros for select using (is_admin());
create policy "equipe ler mov caixa"    on public.movimentos_financeiros for select using (is_vendedor() and sessao_id is not null and conta_id = public.conta_id('caixa'));

-- funções internas de gatilho não ficam expostas
revoke execute on function public.estoque_aplica() from public, anon, authenticated;
revoke execute on function public.pedido_financeiro() from public, anon, authenticated;
revoke execute on function public.custo_produto(bigint) from public, anon, authenticated;
-- funções de operação: só usuários logados (a permissão é checada dentro)
do $$ declare f text; begin
  foreach f in array array[
    'caixa_abrir(numeric)','caixa_movimentar(text,numeric,text)','caixa_resumo(bigint,boolean)','caixa_fechar(numeric,text)',
    'registrar_venda(jsonb)','cancelar_venda(bigint,text)','pagar_conta(bigint,numeric,text,date)','receber_conta(bigint,numeric,text,date)',
    'nova_conta_pagar(jsonb)','lancar_entrada(jsonb)','ajustar_estoque(bigint,text,numeric,text)','resumo_loja(date,date)',
    'nome_usuario()','saldo_gaveta()','conta_id(text)','categoria_id(text)','caixa_aberto()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 16) Pedidos online: estoque registrado como movimento
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
    insert into public.estoque_movimentos (produto_id, tipo, quantidade, ref_tipo, ref_id, obs, usuario_nome)
    values ((item->>'produto_id')::bigint, 'pedido', -(item->>'quantidade')::numeric, 'pedido', v_ped.id,
            'Pedido site #' || v_ped.numero, 'cliente');
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object(
    'numero', v_ped.numero, 'token', v_ped.token,
    'subtotal', v_ped.subtotal, 'frete', v_ped.frete, 'total', v_ped.total,
    'pagamento_forma', v_ped.pagamento_forma, 'itens', v_itens,
    'prazo_min', case when v_modal='entrega' then z.prazo_min end
  );
end $$;

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
      insert into public.estoque_movimentos (produto_id, tipo, quantidade, ref_tipo, ref_id, obs, usuario_nome)
      select i.produto_id, 'cancelamento', i.quantidade, 'pedido', new.id, 'Cancelamento pedido #' || new.numero, v_ator
        from public.pedido_itens i where i.pedido_id = new.id and i.produto_id is not null;
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
revoke execute on function public.pedido_audit() from public, anon, authenticated;
