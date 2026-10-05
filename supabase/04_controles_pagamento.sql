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
