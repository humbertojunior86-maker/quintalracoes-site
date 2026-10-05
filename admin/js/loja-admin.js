// Utilidades do módulo Loja Online no admin
export const STATUS = {
  novo: { t: 'Novo', cor: '#B3261E', bg: '#FDECEA' },
  confirmado: { t: 'Confirmado', cor: '#8a6a1a', bg: '#FEF3D4' },
  separando: { t: 'Separando', cor: '#8a6a1a', bg: '#FEF3D4' },
  pronto: { t: 'Pronto', cor: '#1F5FA8', bg: '#E5EEF9' },
  em_rota: { t: 'Em rota', cor: '#1F5FA8', bg: '#E5EEF9' },
  entregue: { t: 'Entregue', cor: '#1E8449', bg: '#E6F4EC' },
  cancelado: { t: 'Cancelado', cor: '#6B6B6B', bg: '#EEE' },
};
export const FLUXO = ['novo', 'confirmado', 'separando', 'pronto', 'em_rota', 'entregue'];
export const PROX = { novo: 'confirmado', confirmado: 'separando', separando: 'pronto', pronto: 'em_rota', em_rota: 'entregue' };
export const ACAO = { novo: 'Confirmar', confirmado: 'Separar', separando: 'Marcar pronto', pronto: 'Saiu p/ entrega', em_rota: 'Entregue' };
export const PAGTO = {
  pix_online: 'Pix online', cartao_online: 'Cartão online', pix_entrega: 'Pix na entrega',
  cartao_entrega: 'Cartão na entrega', dinheiro: 'Dinheiro', marketplace: 'Pago no canal',
};
export const PAG_ST = {
  pendente: { t: 'Pendente', c: 'tag--danger' }, pago: { t: 'Pago', c: 'tag--success' },
  recebido_entregador: { t: 'Com entregador', c: 'tag--mostarda' }, conferido: { t: 'Conferido', c: 'tag--success' },
  estornado: { t: 'Estornado', c: '' },
};
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const tel = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.startsWith('55') ? d : '55' + d; };
export const wa = (t, msg) => `https://wa.me/${tel(t)}?text=${encodeURIComponent(msg)}`;
export const minutos = (d) => Math.max(0, Math.round((Date.now() - new Date(d)) / 60000));
export const tempo = (d) => { const m = minutos(d); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${Math.floor(m / 1440)}d`; };
// raiz pública do site (para links de cliente e entregador)
export const SITE = location.origin;
export const linkPedido = (token) => `${SITE}/loja/pedido.html?t=${token}`;
export const linkEntregador = (token) => `${SITE}/entregador/?t=${token}`;
export const statusTag = (s) => `<span class="tag" style="background:${STATUS[s].bg};color:${STATUS[s].cor}">${STATUS[s].t}</span>`;

export function msgCliente(p) {
  const n = p.cliente_nome.split(' ')[0];
  const link = linkPedido(p.token);
  return {
    novo: `Olá, ${n}! Recebemos seu pedido #${p.numero} no Quintal Rações. Já vamos conferir. Acompanhe: ${link}`,
    confirmado: `Olá, ${n}! Seu pedido #${p.numero} foi confirmado (${brl(p.total)}). Acompanhe: ${link}`,
    separando: `${n}, estamos separando seu pedido #${p.numero}.`,
    pronto: p.modalidade === 'retirada'
      ? `${n}, seu pedido #${p.numero} está pronto para retirar na R. Corumbá, 180. Até já!`
      : `${n}, seu pedido #${p.numero} está pronto e sai em instantes.`,
    em_rota: `${n}, seu pedido #${p.numero} saiu para entrega. Acompanhe: ${link}`,
    entregue: `${n}, pedido #${p.numero} entregue. Obrigado pela preferência! Se puder, avalie a gente no Google.`,
    cancelado: `${n}, seu pedido #${p.numero} foi cancelado. Qualquer dúvida, estamos por aqui.`,
  }[p.status];
}

// ranking de parceiros para uma zona: mais barato e mais rápido
export function rankParceiros(parceiros, tabela, zonaId, paradas = 1, pesoKg = 0) {
  return parceiros.filter(p => p.ativo && p.tipo !== 'retirada').map(p => {
    const t = tabela.find(x => x.parceiro_id === p.id && x.zona_id === zonaId);
    const base = t ? +t.custo : +p.custo_padrao;
    const custo = base + Math.max(0, paradas - 1) * +p.adicional_parada;
    const cabe = !p.capacidade_kg || pesoKg <= +p.capacidade_kg;
    return { ...p, custo, prazo: t ? t.prazo_min : 60, cabe };
  }).sort((a, b) => (b.cabe - a.cabe) || (a.custo - b.custo) || (a.prazo - b.prazo));
}
