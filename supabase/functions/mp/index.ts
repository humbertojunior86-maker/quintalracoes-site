// Mercado Pago — ações chamadas pela Gestão da loja (exige usuário logado).
// acoes: status | testar | pix | link | consultar | cancelar | conciliar
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { admin, aplicarPagamento, camposDoPagamento, cobRef, cors, idDaRef, json, mpFetch, mpToken } from "./mp_core.ts";

const fnUrl = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`;
const r2 = (n: number) => Math.round(n * 100) / 100;
// horário de Brasília no formato que o MP aceita
const isoBR = (d: Date) => new Date(d.getTime() - 3 * 3600e3).toISOString().replace("Z", "-03:00");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") || "";
    const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await user.auth.getUser();
    if (!u?.user) return json({ error: "Entre no sistema de novo" }, 401);
    const { data: perfil } = await admin().from("perfis").select("id, nome, role, ativo").eq("id", u.user.id).maybeSingle();
    if (!perfil?.ativo) return json({ error: "Entre no sistema de novo" }, 401);
    const ehDono = perfil.role === "admin";

    const db = admin();
    const b = await req.json().catch(() => ({}));
    const acao = String(b.acao || "");

    if (acao === "status") {
      const { data } = await db.rpc("mp_status");
      return json({ ...(data || {}), env: !!Deno.env.get("MP_ACCESS_TOKEN") });
    }

    const token = await mpToken(db);

    if (acao === "testar") {
      if (!ehDono) throw new Error("Só o dono");
      const me = await mpFetch(token, "/users/me");
      return json({ ok: true, conta: me.nickname || me.first_name || me.email, email: me.email, id: me.id, site: me.site_id });
    }

    if (acao === "pix" || acao === "link") {
      const valor = r2(Number(b.valor));
      if (!(valor > 0)) throw new Error("Valor inválido");
      const origem = ["balcao", "fiado", "avulsa"].includes(b.origem) ? b.origem : "avulsa";
      if (origem === "avulsa" && !ehDono) throw new Error("Só o dono pode criar cobrança avulsa");
      const descricao = String(b.descricao || "Quintal Rações").slice(0, 120);
      const contas = Array.isArray(b.conta_receber_ids) ? b.conta_receber_ids.map(Number).filter(Boolean) : null;
      if (origem === "fiado") {
        if (!contas?.length) throw new Error("Escolha as contas do cliente");
        const { data: cr } = await db.from("contas_receber").select("valor, valor_recebido").in("id", contas).in("status", ["aberto", "parcial"]);
        const resta = r2((cr || []).reduce((s: number, c: any) => s + Number(c.valor) - Number(c.valor_recebido), 0));
        if (valor > resta + 0.009) throw new Error("Valor maior do que o cliente deve");
      }
      const expira = new Date(Date.now() + (acao === "pix" ? (origem === "balcao" ? 30 * 60e3 : 24 * 3600e3) : 7 * 24 * 3600e3));
      const { data: c, error } = await db.from("cobrancas_mp").insert({
        tipo: acao, origem, descricao, valor, cliente_id: b.cliente_id || null, conta_receber_ids: contas,
        expira_em: expira.toISOString(), criado_por: perfil.nome,
      }).select("*").single();
      if (error) throw error;

      if (acao === "pix") {
        const pg = await mpFetch(token, "/v1/payments", {
          method: "POST",
          headers: { "X-Idempotency-Key": cobRef(c.id) },
          body: JSON.stringify({
            transaction_amount: valor,
            description: descricao,
            payment_method_id: "pix",
            external_reference: cobRef(c.id),
            notification_url: fnUrl(),
            date_of_expiration: isoBR(expira),
            payer: { email: Deno.env.get("MP_PAYER_EMAIL") || "cliente@quintalracoes.com.br", first_name: String(b.cliente_nome || "Cliente") },
          }),
        });
        const td = pg.point_of_interaction?.transaction_data || {};
        const { data: up } = await db.from("cobrancas_mp").update({
          mp_payment_id: String(pg.id), qr_code: td.qr_code || null, qr_base64: td.qr_code_base64 || null, link: td.ticket_url || null,
        }).eq("id", c.id).select("id, valor, status, qr_code, qr_base64, link, expira_em").single();
        return json(up);
      } else {
        const site = Deno.env.get("SITE_URL") ?? "https://quintalracoes.com.br";
        const pref = await mpFetch(token, "/checkout/preferences", {
          method: "POST",
          body: JSON.stringify({
            external_reference: cobRef(c.id),
            items: [{ title: descricao, quantity: 1, unit_price: valor, currency_id: "BRL" }],
            notification_url: fnUrl(),
            statement_descriptor: "QUINTAL RACOES",
            expires: true,
            expiration_date_to: isoBR(expira),
            back_urls: { success: site, pending: site, failure: site },
          }),
        });
        const { data: up } = await db.from("cobrancas_mp").update({ mp_preference_id: pref.id, link: pref.init_point })
          .eq("id", c.id).select("id, valor, status, link, expira_em").single();
        return json(up);
      }
    }

    if (acao === "consultar") {
      const { data: c } = await db.from("cobrancas_mp").select("*").eq("id", Number(b.id)).single();
      if (!c) throw new Error("Cobrança não encontrada");
      if (c.status !== "pendente") return json(c);
      let pg: any = null;
      if (c.mp_payment_id) pg = await mpFetch(token, `/v1/payments/${c.mp_payment_id}`);
      else {
        const s = await mpFetch(token, `/v1/payments/search?external_reference=${cobRef(c.id)}&sort=date_created&criteria=desc&limit=5`);
        pg = (s.results || []).find((x: any) => x.status === "approved") || (s.results || [])[0] || null;
      }
      if (!pg) return json(c);
      return json(await aplicarPagamento(db, c.id, pg) || c);
    }

    if (acao === "cancelar") {
      const { data: c } = await db.from("cobrancas_mp").select("*").eq("id", Number(b.id)).single();
      if (!c || c.status !== "pendente") return json(c || {});
      if (c.tipo === "pix" && c.mp_payment_id) {
        const pg = await mpFetch(token, `/v1/payments/${c.mp_payment_id}`);
        if (pg.status === "approved") return json(await aplicarPagamento(db, c.id, pg));
        await mpFetch(token, `/v1/payments/${c.mp_payment_id}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) }).catch(() => null);
      }
      if (c.tipo === "link" && c.mp_preference_id) {
        await mpFetch(token, `/checkout/preferences/${c.mp_preference_id}`, { method: "PUT", body: JSON.stringify({ expires: true, expiration_date_to: isoBR(new Date()) }) }).catch(() => null);
      }
      const { data: up } = await db.from("cobrancas_mp").update({ status: "cancelado" }).eq("id", c.id).select("*").single();
      return json(up);
    }

    // Conferência com o extrato do Mercado Pago: o que caiu lá e não está no sistema (e vice-versa)
    if (acao === "conciliar") {
      if (!ehDono) throw new Error("Só o dono");
      const ini = String(b.ini), fim = String(b.fim);
      const todos: any[] = [];
      for (let off = 0; off < 1000; off += 100) {
        const s = await mpFetch(token, `/v1/payments/search?sort=date_created&criteria=desc&range=date_created&begin_date=${ini}T00:00:00.000-03:00&end_date=${fim}T23:59:59.999-03:00&limit=100&offset=${off}`);
        todos.push(...(s.results || []));
        if ((s.results || []).length < 100) break;
      }
      // atualiza cobranças do sistema que estavam pendentes
      let atualizadas = 0;
      for (const p of todos) {
        const id = idDaRef(p.external_reference);
        if (id) {
          const { data: c } = await db.from("cobrancas_mp").select("id, status, mp_payment_id").eq("id", id).single();
          if (c && (c.status === "pendente" || (p.status !== "approved" && c.status === "aprovado" && ["refunded", "charged_back"].includes(p.status)))) {
            await aplicarPagamento(db, id, p); atualizadas++;
          }
        }
      }
      // pagamentos aprovados no MP que não vieram do sistema (Pix na chave, maquininha Point etc.)
      const { data: pedidos } = await db.from("pedidos").select("mp_payment_id").not("mp_payment_id", "is", null);
      const ids = new Set((pedidos || []).map((x: any) => String(x.mp_payment_id)));
      const fora = todos.filter((p) => p.status === "approved" && !idDaRef(p.external_reference) && !ids.has(String(p.id)))
        .map((p) => ({ id: p.id, data: p.date_approved, valor: p.transaction_amount, meio: p.payment_method_id, descricao: p.description, taxa: camposDoPagamento(p).taxa_mp, ref: p.external_reference || null }));
      const aprovados = todos.filter((p) => p.status === "approved");
      const soma = (l: any[], k: string) => r2(l.reduce((s, x) => s + Number(k === "taxa" ? camposDoPagamento(x).taxa_mp : x.transaction_amount || 0), 0));
      return json({
        ok: true, atualizadas,
        mp: { qtd: aprovados.length, bruto: soma(aprovados, "v"), taxa: soma(aprovados, "taxa") },
        fora_do_sistema: fora,
      });
    }

    throw new Error("Ação inválida");
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400);
  }
});
