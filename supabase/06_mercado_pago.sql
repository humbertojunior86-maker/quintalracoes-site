-- ============================================================
-- 06 — Integração Mercado Pago (Pix dinâmico + link de pagamento + conciliação)
-- Só acrescenta. Não altera dados existentes.
-- ============================================================

-- 1) Conta financeira do saldo Mercado Pago
insert into public.contas_financeiras (slug, nome, tipo, ordem)
values ('mercadopago', 'Mercado Pago', 'banco', 4)
on conflict (slug) do nothing;

-- 2) Cofre privado (fora da API pública) para o token do Mercado Pago
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;
create table if not exists privado.integracoes (
  chave          text primary key,
  valor          text not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);
revoke all on privado.integracoes from public, anon, authenticated;

-- dono grava o token pela tela "Ligar Mercado Pago" (o valor nunca volta para o navegador)
create or replace function public.mp_salvar_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public, privado as $$
declare t text := btrim(coalesce(p_token,''));
begin
  if not public.is_admin() then raise exception 'Só o dono pode ligar o Mercado Pago'; end if;
  if t = '' then
    delete from privado.integracoes where chave = 'mp_access_token';
    return jsonb_build_object('ok', true, 'configurado', false);
  end if;
  if t !~ '^(APP_USR|TEST)-[A-Za-z0-9-]{20,}$' then
    raise exception 'Esse não parece o Access Token. Ele começa com APP_USR-';
  end if;
  insert into privado.integracoes (chave, valor, atualizado_por) values ('mp_access_token', t, public.nome_usuario())
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = now(), atualizado_por = excluded.atualizado_por;
  return jsonb_build_object('ok', true, 'configurado', true, 'final', right(t, 4));
end $$;

create or replace function public.mp_status()
returns jsonb language sql stable security definer set search_path = public, privado as $$
  select jsonb_build_object(
    'configurado', exists (select 1 from privado.integracoes where chave = 'mp_access_token'),
    'teste', coalesce((select valor like 'TEST-%' from privado.integracoes where chave = 'mp_access_token'), false),
    'final', (select right(valor, 4) from privado.integracoes where chave = 'mp_access_token' and public.is_admin()),
    'atualizado_em', (select atualizado_em from privado.integracoes where chave = 'mp_access_token'));
$$;

-- só as funções do servidor (service_role) leem o token
create or replace function public.mp_token()
returns text language sql stable security definer set search_path = public, privado as $$
  select valor from privado.integracoes where chave = 'mp_access_token';
$$;
revoke all on function public.mp_token() from public, anon, authenticated;
grant execute on function public.mp_token() to service_role;
revoke all on function public.mp_salvar_token(text) from public, anon;
grant execute on function public.mp_salvar_token(text) to authenticated;
revoke all on function public.mp_status() from public, anon;
grant execute on function public.mp_status() to authenticated;

-- 3) Cobranças geradas pelo sistema
create table if not exists public.cobrancas_mp (
  id              bigserial primary key,
  tipo            text not null check (tipo in ('pix','link')),
  origem          text not null check (origem in ('balcao','fiado','pedido','avulsa')),
  descricao       text not null,
  valor           numeric(12,2) not null check (valor > 0),
  cliente_id      bigint references public.clientes(id),
  conta_receber_ids bigint[],                    -- fiado: contas que serão baixadas
  venda_id        bigint references public.vendas(id),
  pedido_id       bigint references public.pedidos(id),
  status          text not null default 'pendente' check (status in ('pendente','aprovado','cancelado','expirado','recusado','estornado')),
  mp_payment_id   text unique,
  mp_preference_id text,
  qr_code         text,
  qr_base64       text,
  link            text,
  expira_em       timestamptz,
  valor_pago      numeric(12,2),
  taxa_mp         numeric(12,2),
  valor_liquido   numeric(12,2),
  meio            text,                          -- pix, credit_card, debit_card…
  pago_em         timestamptz,
  liberacao_em    timestamptz,
  baixado         bool not null default false,   -- já lançado no financeiro
  criado_por      text,
  criado_em       timestamptz not null default now()
);
create index if not exists cobmp_status_idx on public.cobrancas_mp (status, criado_em desc);
alter table public.cobrancas_mp enable row level security;
drop policy if exists cobmp_ler on public.cobrancas_mp;
create policy cobmp_ler on public.cobrancas_mp for select to authenticated using (public.is_vendedor());
-- gravação só pelas funções (security definer) e pelas Edge Functions (service_role)
grant select on public.cobrancas_mp to authenticated;
grant all on public.cobrancas_mp to service_role;
grant usage, select on sequence public.cobrancas_mp_id_seq to service_role;

-- 4) Baixa automática quando o Mercado Pago aprova (chamada pelo webhook)
create or replace function public.mp_baixar(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.cobrancas_mp; v_mp bigint := public.conta_id('mercadopago'); cr record; v_rest numeric; v_parte numeric;
begin
  select * into c from public.cobrancas_mp where id = p_id for update;
  if not found then raise exception 'Cobrança não encontrada'; end if;
  if c.status <> 'aprovado' or c.baixado then return jsonb_build_object('ok', true, 'nada', true); end if;

  if c.origem = 'fiado' then
    v_rest := coalesce(c.valor_pago, c.valor);
    for cr in select * from public.contas_receber where id = any(coalesce(c.conta_receber_ids,'{}'))
               and status in ('aberto','parcial') order by vencimento loop
      exit when v_rest <= 0;
      v_parte := least(v_rest, cr.valor - cr.valor_recebido);
      insert into public.movimentos_financeiros (conta_id, tipo, valor, forma, categoria_id, descricao, origem, ref_id, usuario_nome)
      values (v_mp, 'entrada', v_parte, 'mercadopago', cr.categoria_id, 'Recebido (link MP): ' || cr.descricao, 'recebimento', cr.id, 'Mercado Pago');
      update public.contas_receber set valor_recebido = valor_recebido + v_parte, recebido_em = current_date, conta_id = v_mp,
             status = case when valor_recebido + v_parte >= valor then 'recebido' else 'parcial' end
       where id = cr.id;
      v_rest := v_rest - v_parte;
    end loop;
    if v_rest > 0.009 then  -- pagou a mais ou conta já baixada à mão
      insert into public.movimentos_financeiros (conta_id, tipo, valor, forma, categoria_id, descricao, origem, ref_id, usuario_nome)
      values (v_mp, 'entrada', v_rest, 'mercadopago', public.categoria_id('outras-receitas'), 'Sobra da cobrança MP #' || c.id, 'recebimento', c.id, 'Mercado Pago');
    end if;
  elsif c.origem = 'avulsa' then
    insert into public.movimentos_financeiros (conta_id, tipo, valor, forma, categoria_id, descricao, origem, ref_id, usuario_nome)
    values (v_mp, 'entrada', coalesce(c.valor_pago, c.valor), 'mercadopago', public.categoria_id('outras-receitas'), c.descricao, 'recebimento', c.id, 'Mercado Pago');
  elsif c.origem = 'balcao' then
    -- a venda é registrada pela tela de venda (registrar_venda); aqui só lança se a venda já existir
    if c.venda_id is null then return jsonb_build_object('ok', true, 'aguardando_venda', true); end if;
  end if;

  if coalesce(c.taxa_mp,0) > 0 then
    insert into public.movimentos_financeiros (conta_id, tipo, valor, forma, categoria_id, descricao, origem, ref_id, usuario_nome)
    values (v_mp, 'saida', c.taxa_mp, 'mercadopago', public.categoria_id('taxas-cartao'), 'Taxa Mercado Pago — cobrança #' || c.id, 'pagamento', c.id, 'Mercado Pago');
  end if;
  update public.cobrancas_mp set baixado = true where id = c.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.mp_baixar(bigint) from public, anon, authenticated;
grant execute on function public.mp_baixar(bigint) to service_role;

-- 5) Venda no balcão com Pix do Mercado Pago:
--    registrar_venda recebe {forma:'pix', valor, cobranca_mp_id}. O dinheiro entra na conta Mercado Pago.
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
  v_itens jsonb := '[]'; v_ref text; v_cob public.cobrancas_mp;
begin
  if not public.is_vendedor() then raise exception 'Sem permissão'; end if;
  if v_s is null then raise exception 'Abra o caixa antes de vender'; end if;
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
    elsif v_forma = 'pix' and nullif(pg->>'cobranca_mp_id','') is not null then
      -- Pix gerado pelo Mercado Pago: só aceita se o MP já aprovou e a cobrança não foi usada
      select * into v_cob from public.cobrancas_mp where id = (pg->>'cobranca_mp_id')::bigint for update;
      if not found or v_cob.status <> 'aprovado' then raise exception 'O Pix ainda não foi aprovado pelo Mercado Pago'; end if;
      if v_cob.venda_id is not null then raise exception 'Esse Pix já foi usado na venda'; end if;
      if abs(coalesce(v_cob.valor_pago, v_cob.valor) - v_val) > 0.009 then raise exception 'Valor do Pix diferente da venda'; end if;
      v_taxa := coalesce(v_cob.taxa_mp, 0);
      insert into public.movimentos_financeiros (conta_id, sessao_id, tipo, valor, forma, categoria_id, descricao, origem, ref_id, usuario_nome)
      values (public.conta_id('mercadopago'), v_s, 'entrada', v_val, 'pix', public.categoria_id('venda-balcao'),
              'Venda #' || v_venda.numero || ' (Pix Mercado Pago)', 'venda', v_venda.id, v_nome);
      update public.cobrancas_mp set venda_id = v_venda.id, cliente_id = coalesce(cliente_id, v_cli) where id = v_cob.id;
      perform public.mp_baixar(v_cob.id);
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

-- 6) Pedidos do site pagos pelo Mercado Pago entram na conta Mercado Pago
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
    values (public.conta_id(case when new.mp_payment_id is not null then 'mercadopago' else 'banco' end),
            'entrada', new.total, new.pagamento_forma, v_cat, v_desc, 'pedido', new.id, public.nome_usuario());
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

-- 7) Conciliação: resumo por dia (bruto, taxa, líquido, a liberar)
create or replace function public.mp_conciliacao(p_ini date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Só o dono vê a conciliação'; end if;
  return jsonb_build_object(
    'totais', (select jsonb_build_object(
        'aprovado', coalesce(sum(coalesce(valor_pago,valor)) filter (where status='aprovado'),0),
        'taxa', coalesce(sum(taxa_mp) filter (where status='aprovado'),0),
        'liquido', coalesce(sum(valor_liquido) filter (where status='aprovado'),0),
        'a_liberar', coalesce(sum(valor_liquido) filter (where status='aprovado' and liberacao_em > now()),0),
        'pendente', coalesce(sum(valor) filter (where status='pendente'),0),
        'sem_venda', count(*) filter (where status='aprovado' and origem='balcao' and venda_id is null))
      from public.cobrancas_mp where criado_em::date between p_ini and p_fim),
    'lista', coalesce((select jsonb_agg(to_jsonb(x) order by x.criado_em desc) from (
        select c.id, c.tipo, c.origem, c.descricao, c.valor, c.valor_pago, c.taxa_mp, c.valor_liquido, c.status, c.meio,
               c.criado_em, c.pago_em, c.liberacao_em, c.mp_payment_id, c.venda_id, v.numero as venda_numero, cl.nome as cliente
          from public.cobrancas_mp c left join public.vendas v on v.id = c.venda_id left join public.clientes cl on cl.id = c.cliente_id
         where c.criado_em::date between p_ini and p_fim limit 500) x), '[]'::jsonb));
end $$;
grant execute on function public.mp_conciliacao(date, date) to authenticated;
