// Recebe notificações do Mercado Pago. Nunca confia no corpo da notificação:
// consulta o pagamento na API, confere referência e valor e só então marca o pedido como pago.
// Segredos: MP_ACCESS_TOKEN. Deploy com --no-verify-jwt (o Mercado Pago não envia JWT).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    let id = url.searchParams.get("data.id") ?? url.searchParams.get("id");
    let tipo = url.searchParams.get("type") ?? url.searchParams.get("topic");
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      id = b?.data?.id ?? id;
      tipo = b?.type ?? tipo;
    }
    if (tipo !== "payment" || !id) return new Response("ignorado", { status: 200 });

    const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${Deno.env.get("MP_ACCESS_TOKEN")}` },
    });
    if (!r.ok) return new Response("pagamento não encontrado", { status: 200 });
    const pg = await r.json();

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: p } = await db.from("pedidos").select("id, total, pagamento_status")
      .eq("token", pg.external_reference).single();
    if (!p) return new Response("pedido não encontrado", { status: 200 });

    const valorOk = Math.abs(Number(pg.transaction_amount) - Number(p.total)) < 0.01;
    if (pg.status === "approved" && valorOk && p.pagamento_status === "pendente") {
      await db.from("pedidos").update({ pagamento_status: "pago", mp_payment_id: String(pg.id) }).eq("id", p.id);
      await db.from("pedido_eventos").insert({ pedido_id: p.id, tipo: "pagamento", de: "pendente", para: "pago", ator: "mercadopago", obs: `MP ${pg.id} · ${pg.payment_method_id}` });
    } else if (pg.status === "approved" && !valorOk) {
      await db.from("pedido_eventos").insert({ pedido_id: p.id, tipo: "alerta", para: "valor_divergente", ator: "mercadopago", obs: `Pago ${pg.transaction_amount} x pedido ${p.total}` });
    }
    return new Response("ok", { status: 200 });
  } catch (_e) {
    return new Response("erro", { status: 200 });
  }
});
