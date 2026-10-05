// Cria a preferência de pagamento (cartão/Pix) no Mercado Pago para um pedido do site.
// Segredos necessários: MP_ACCESS_TOKEN, SITE_URL (ex.: https://quintalracoes.com.br)
// Só é chamada quando config_loja.cartao_online_ativo = true.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { mpToken } from "./mp_core.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { token } = await req.json();
    if (!token) throw new Error("token obrigatório");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: cfg } = await db.from("config_loja").select("cartao_online_ativo").eq("id", 1).single();
    if (!cfg?.cartao_online_ativo) throw new Error("Pagamento online desativado");

    const { data: p, error } = await db.from("pedidos")
      .select("id, numero, token, total, pagamento_status, cliente_nome, pedido_itens(nome, quantidade, total)")
      .eq("token", token).single();
    if (error || !p) throw new Error("Pedido não encontrado");
    if (p.pagamento_status !== "pendente") throw new Error("Pedido já pago ou em conferência");

    const site = Deno.env.get("SITE_URL") ?? "https://quintalracoes.com.br";
    const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`;
    const body = {
      external_reference: p.token,
      // Um único item com o total do pedido evita divergência de arredondamento com frete/desconto.
      items: [{ title: `Pedido Quintal #${p.numero}`, quantity: 1, unit_price: Number(p.total), currency_id: "BRL" }],
      payer: { name: p.cliente_nome },
      back_urls: {
        success: `${site}/loja/pedido.html?t=${p.token}`,
        pending: `${site}/loja/pedido.html?t=${p.token}`,
        failure: `${site}/loja/pedido.html?t=${p.token}`,
      },
      auto_return: "approved",
      notification_url: fnUrl,
      statement_descriptor: "QUINTAL RACOES",
    };
    const tk = await mpToken(db);
    const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const pref = await r.json();
    if (!r.ok) throw new Error(pref?.message ?? "Erro no Mercado Pago");
    await db.from("pedidos").update({ mp_preference_id: pref.id }).eq("id", p.id);
    return new Response(JSON.stringify({ init_point: pref.init_point }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
