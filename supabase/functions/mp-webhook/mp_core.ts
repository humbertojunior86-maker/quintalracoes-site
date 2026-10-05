// Núcleo compartilhado da integração Mercado Pago (copiado em cada função no deploy).
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

export const MP = "https://api.mercadopago.com";
export const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// token: primeiro o segredo do Supabase, depois o cofre privado gravado pela tela do dono
export async function mpToken(db: SupabaseClient): Promise<string> {
  const env = Deno.env.get("MP_ACCESS_TOKEN");
  if (env) return env;
  const { data, error } = await db.rpc("mp_token");
  if (error || !data) throw new Error("Mercado Pago não está ligado. Peça ao dono para ligar em Gestão > Mercado Pago.");
  return data as string;
}

export async function mpFetch(token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(MP + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body?.message || body?.error || `Erro ${r.status} no Mercado Pago`;
    if (r.status === 401) throw new Error("O token do Mercado Pago foi recusado. Confira o Access Token de produção.");
    throw new Error(String(msg));
  }
  return body;
}

// Traduz um pagamento do MP para os campos da cobrança
export function camposDoPagamento(p: any) {
  const valor = Number(p.transaction_amount || 0);
  const feeMp = (p.fee_details || []).filter((f: any) => f.type === "mercadopago_fee")
    .reduce((s: number, f: any) => s + Number(f.amount || 0), 0);
  const net = Number(p.transaction_details?.net_received_amount ?? NaN);
  const taxa = Math.round((feeMp > 0 ? feeMp : (Number.isFinite(net) ? Math.max(valor - net, 0) : 0)) * 100) / 100;
  const st = String(p.status);
  const status = st === "approved" ? "aprovado"
    : ["refunded", "charged_back"].includes(st) ? "estornado"
    : ["cancelled", "expired"].includes(st) ? "cancelado"
    : st === "rejected" ? "recusado" : "pendente";
  return {
    mp_payment_id: String(p.id),
    status,
    valor_pago: valor,
    taxa_mp: taxa,
    valor_liquido: Math.round((valor - taxa) * 100) / 100,
    meio: p.payment_method_id || p.payment_type_id || null,
    pago_em: p.date_approved || null,
    liberacao_em: p.money_release_date || null,
  };
}

// Aplica um pagamento do MP numa cobrança e baixa no financeiro quando aprovado
export async function aplicarPagamento(db: SupabaseClient, cobId: number, p: any) {
  const { data: c } = await db.from("cobrancas_mp").select("*").eq("id", cobId).single();
  if (!c) return null;
  const f = camposDoPagamento(p);
  // valor tem que bater; senão não baixa e deixa anotado
  if (f.status === "aprovado" && Math.abs(f.valor_pago - Number(c.valor)) > 0.009) {
    await db.from("cobrancas_mp").update({ ...f, status: "pendente", descricao: c.descricao + " [VALOR DIVERGENTE: pago " + f.valor_pago + "]" }).eq("id", cobId);
    return { ...c, ...f, status: "pendente" };
  }
  // link: um pagamento recusado não encerra o link (o cliente pode tentar de novo)
  if (c.tipo === "link" && f.status === "recusado") return c;
  // não volta um aprovado para pendente
  if (c.status === "aprovado" && f.status !== "estornado") return c;
  const { data: novo } = await db.from("cobrancas_mp").update(f).eq("id", cobId).select("*").single();
  if (f.status === "aprovado") await db.rpc("mp_baixar", { p_id: cobId });
  return novo;
}

export const cobRef = (id: number) => `cob-${id}`;
export const idDaRef = (ref: string | null | undefined) => {
  const m = /^cob-(\d+)$/.exec(String(ref || ""));
  return m ? Number(m[1]) : null;
};
