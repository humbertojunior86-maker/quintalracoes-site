-- ============================================================
-- Controle: só administrador confere/estorna pagamento.
-- Vendedor e entregador não conseguem marcar "conferido".
-- ============================================================
create or replace function public.guarda_pagamento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pagamento_status is distinct from old.pagamento_status
     and new.pagamento_status in ('conferido','estornado')
     and not public.is_admin()
     and coalesce(current_setting('quintal.ator', true), '') <> 'mercadopago' then
    raise exception 'Somente o administrador pode conferir ou estornar pagamentos';
  end if;
  -- valores do pedido do site não podem ser alterados depois de criado (exceto por admin)
  if (new.total, new.subtotal, new.frete) is distinct from (old.total, old.subtotal, old.frete)
     and not public.is_admin() then
    raise exception 'Somente o administrador pode alterar valores do pedido';
  end if;
  return new;
end $$;

drop trigger if exists trg_guarda_pagamento on public.pedidos;
create trigger trg_guarda_pagamento before update on public.pedidos
  for each row execute function public.guarda_pagamento();

-- Higiene apontada pelo Security Advisor (somente objetos do módulo novo)
alter function public.preco_efetivo(public.produtos, text) set search_path = public;
revoke execute on function public.pedido_audit() from public, anon, authenticated;
revoke execute on function public.guarda_pagamento() from public, anon, authenticated;


-- ============================================================
-- Itens a granel exibidos em kg (rastreio e painel do entregador)
-- ============================================================
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
