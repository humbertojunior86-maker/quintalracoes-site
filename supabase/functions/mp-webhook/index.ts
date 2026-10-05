// Recebe notificações do Mercado Pago. Nunca confia no corpo da notificação:
// consulta o pagamento na API, confere referência e valor e só então baixa.
// Deploy sem verificação de JWT (o Mercado Pago não envia JWT).
import { admin, aplicarPagamento, idDaRef, mpFetch, mpToken } from "./mp_core.ts";

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    let id = url.searchParams.get("data.id") ?? url.searchParams.get("id");
    let tipo = url.searchParams.get("type") ?? url.searchParams.get("topic");
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      id = b?.data?.id ?? id;
      tipo = b?.type ?? b?.topic ?? tipo;
    }
    if (tipo !== "payment" || !id || !/^\d+$/.test(String(id))) return new Response("ignorado", { status: 200 });

    const db = admin();
    const token = await mpToken(db);
    const pg = await mpFetch(token, `/v1/payments/${id}`);

    // 1) cobranças geradas pela Gestão da loja
    const cob = idDaRef(pg.external_reference);
    if (cob) {
      await aplicarPagamento(db, cob, pg);
      return new Response("ok", { status: 200 });
    }

    // 2) pedidos do site (external_reference = token do pedido)
    const { data: p } = await db.from("pedidos").select("id, total, pagamento_status").eq("token", pg.external_reference).maybeSingle();
    if (!p) return new Response("sem vínculo", { status: 200 });
    const valorOk = Math.abs(Number(pg.transaction_amount) - Number(p.total)) < 0.01;
    if (pg.status === "approved" && valorOk && p.pagamento_status === "pendente") {
      await db.from("pedidos").update({ pagamento_status: "pago", mp_payment_id: String(pg.id) }).eq("id", p.id);
    } else if (pg.status === "approved" && !valorOk) {
      await db.from("pedido_eventos").insert({ pedido_id: p.id, tipo: "obs", para: "valor_divergente", ator: "mercadopago", obs: `Pago ${pg.transaction_amount} x pedido ${p.total}` });
    }
    return new Response("ok", { status: 200 });
  } catch (_e) {
    return new Response("erro", { status: 500 }); // o MP tenta de novo
  }
});
