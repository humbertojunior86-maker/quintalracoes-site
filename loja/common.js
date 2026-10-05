// Quintal — utilidades compartilhadas da loja, rastreio e entregador
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export const SUPABASE_URL = 'https://bpoibjulaxeohwhthkid.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_IjM03moAsKNJUp253AaIXA_RjHvJtuN';
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// raiz do site (funciona no domínio e em pré-visualização em subpasta)
export const ROOT = new URL('../', import.meta.url).href;
export const asset = (u) => !u ? '' : (/^https?:/.test(u) ? u : ROOT + u.replace(/^\//, ''));

export const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmtQtd = (q, un) => un === 'kg' ? `${String(+q).replace('.', ',')} kg` : `${+q}`;

export const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* iframe sem storage */ } },
};

// ---------- Regra de preço (espelho da função preco_efetivo do banco) ----------
export function precoBase(p) {
  const hoje = new Date();
  const promoOk = p.preco_promocional != null
    && (!p.promo_inicio || new Date(p.promo_inicio) <= hoje)
    && (!p.promo_fim || new Date(p.promo_fim) >= hoje);
  if (promoOk) return Math.min(+p.preco_promocional, +(p.preco_normal ?? p.preco_promocional));
  return p.preco_normal != null ? +p.preco_normal : null;
}
export function precoPara(p, forma) {
  const base = precoBase(p);
  if (base == null) return null;
  if (['pix_online', 'pix_entrega', 'dinheiro'].includes(forma) && p.preco_pix != null) return Math.min(+p.preco_pix, base);
  return base;
}

// ---------- Pix copia-e-cola (BR Code estático, padrão EMV do Banco Central) ----------
function tlv(id, v) { return id + String(v.length).padStart(2, '0') + v; }
function crc16(s) {
  let crc = 0xFFFF;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
const semAcento = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ]/g, '').toUpperCase();
export function pixPayload({ chave, nome, cidade, valor, txid }) {
  const gui = tlv('00', 'br.gov.bcb.pix') + tlv('01', chave.trim());
  let p = tlv('00', '01') + tlv('01', '12') + tlv('26', gui) + tlv('52', '0000') + tlv('53', '986');
  if (valor) p += tlv('54', Number(valor).toFixed(2));
  p += tlv('58', 'BR') + tlv('59', semAcento(nome).slice(0, 25)) + tlv('60', semAcento(cidade).slice(0, 15));
  p += tlv('62', tlv('05', (txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'));
  p += '6304';
  return p + crc16(p);
}

export const STATUS = {
  novo:       { t: 'Recebido',          d: 'A loja recebeu seu pedido.' },
  confirmado: { t: 'Confirmado',        d: 'Pedido conferido pela loja.' },
  separando:  { t: 'Separando',         d: 'Estamos pesando e separando seus produtos.' },
  pronto:     { t: 'Pronto',            d: 'Aguardando o entregador sair.' },
  em_rota:    { t: 'Saiu para entrega', d: 'O entregador está a caminho.' },
  entregue:   { t: 'Entregue',          d: 'Pedido entregue. Obrigado!' },
  cancelado:  { t: 'Cancelado',         d: 'Este pedido foi cancelado.' },
};
export const PAGTO = {
  pix_online: 'Pix agora', cartao_online: 'Cartão online', pix_entrega: 'Pix na entrega',
  cartao_entrega: 'Cartão na entrega (maquininha)', dinheiro: 'Dinheiro na entrega', marketplace: 'Pago no marketplace',
};

export function toast(msg, tipo = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return alert(msg);
  el.textContent = msg;
  el.className = `toast-lj toast-lj--${tipo} is-on`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('is-on'), 3800);
}
