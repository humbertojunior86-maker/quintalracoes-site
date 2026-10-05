// Quintal — Loja online (vitrine, carrinho e checkout)
import { sb, SUPABASE_URL, SUPABASE_KEY, asset, brl, esc, fmtQtd, store, precoBase, precoPara, pixPayload, PAGTO, toast } from './common.js';

const S = {
  cfg: null, cats: [], prods: [], zonas: [],
  filtro: 'todos', busca: '', ordem: 'relevancia',
  cart: store.get('quintal_cart', []),          // [{id, q}]
  ck: store.get('quintal_cliente', {}),         // dados do cliente lembrados
  etapa: 'carrinho',                            // carrinho | dados | entrega | pagamento | feito
  enviando: false, resultado: null,
};
const $ = (s) => document.querySelector(s);
const prod = (id) => S.prods.find(p => p.id === id);
const passo = (p) => p.unidade === 'kg' ? 0.5 : 1;
const unLabel = (p) => p.unidade === 'kg' ? '/kg' : '';

// ---------------- carga ----------------
async function carregar() {
  const [cfg, cats, prods, zonas] = await Promise.all([
    sb.from('config_loja').select('*').eq('id', 1).single(),
    sb.from('categorias').select('id,nome,slug,icone_url').eq('ativo', true).order('ordem'),
    sb.from('produtos').select('id,nome,slug,descricao,foto_url,unidade,preco_normal,preco_pix,preco_promocional,promo_inicio,promo_fim,estoque,controla_estoque,categoria_id,ordem,marcas(nome)')
      .eq('ativo', true).eq('vende_online', true).order('ordem'),
    sb.from('zonas_entrega').select('id,nome,bairros,taxa_cliente,prazo_min').eq('ativo', true).order('ordem'),
  ]);
  if (prods.error) throw prods.error;
  S.cfg = cfg.data || { pedido_minimo: 0, retirada_ativa: true };
  S.cats = cats.data || [];
  S.prods = prods.data || [];
  S.zonas = zonas.data || [];
  S.cart = S.cart.filter(i => prod(i.id));
  if (!S.cfg.loja_aberta) $('#homolog').hidden = false;
  if (S.cfg.aviso_topo) $('#aviso-topo').textContent = S.cfg.aviso_topo;
}

// ---------------- vitrine ----------------
function renderChips() {
  const usadas = new Set(S.prods.map(p => p.categoria_id));
  const cats = S.cats.filter(c => usadas.has(c.id));
  $('#chips').innerHTML = [`<button class="lj-chip ${S.filtro === 'todos' ? 'is-on' : ''}" data-cat="todos">Todos</button>`]
    .concat(cats.map(c => `<button class="lj-chip ${S.filtro == c.id ? 'is-on' : ''}" data-cat="${c.id}">
      ${c.icone_url ? `<img src="${esc(asset(c.icone_url))}" alt="" width="26" height="26">` : ''}${esc(c.nome)}</button>`)).join('');
}

function listaFiltrada() {
  const q = S.busca.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let l = S.prods.filter(p => (S.filtro === 'todos' || p.categoria_id == S.filtro));
  if (q) l = l.filter(p => `${p.nome} ${p.descricao || ''} ${p.marcas?.nome || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q));
  const pr = (p) => precoBase(p) ?? Infinity;
  if (S.ordem === 'menor') l.sort((a, b) => pr(a) - pr(b));
  if (S.ordem === 'maior') l.sort((a, b) => pr(b) - pr(a));
  if (S.ordem === 'nome') l.sort((a, b) => a.nome.localeCompare(b.nome));
  return l;
}

function cardHTML(p) {
  const base = precoBase(p);
  const pix = precoPara(p, 'pix_online');
  const promo = p.preco_promocional != null && base < +p.preco_normal;
  const noCart = S.cart.find(i => i.id === p.id);
  const esgotado = p.controla_estoque && p.estoque <= 0;
  const preco = base == null
    ? `<p class="lj-card__consulta">Preço sob consulta</p>`
    : `<div class="lj-card__preco">
        ${promo ? `<s>${brl(p.preco_normal)}</s>` : ''}
        <strong>${brl(base)}<small>${unLabel(p)}</small></strong>
        ${pix != null && pix < base ? `<span class="lj-pix">${brl(pix)}${unLabel(p)} no Pix</span>` : ''}
      </div>`;
  let acao;
  if (base == null) acao = `<a class="lj-btn lj-btn--ghost" target="_blank" rel="noopener" href="https://wa.me/${S.cfg.whatsapp}?text=${encodeURIComponent('Quero saber o preço de: ' + p.nome)}">Consultar no WhatsApp</a>`;
  else if (esgotado) acao = `<button class="lj-btn" disabled>Esgotado</button>`;
  else if (noCart) acao = stepperHTML(p, noCart.q);
  else acao = `<button class="lj-btn" data-add="${p.id}">Adicionar</button>`;
  return `<article class="lj-card">
    ${promo ? '<span class="lj-card__tag">Oferta</span>' : p.unidade === 'kg' ? '<span class="lj-card__tag lj-card__tag--dark">A granel</span>' : ''}
    <div class="lj-card__img"><img src="${esc(asset(p.foto_url))}" alt="${esc(p.nome)}" loading="lazy"></div>
    ${p.marcas?.nome ? `<span class="lj-card__marca">${esc(p.marcas.nome)}</span>` : ''}
    <h3 class="lj-card__nome">${esc(p.nome)}</h3>
    ${preco}
    <div class="lj-card__acao" data-acao="${p.id}">${acao}</div>
  </article>`;
}
const stepperHTML = (p, q) => `<div class="lj-stepper" role="group" aria-label="Quantidade de ${esc(p.nome)}">
  <button data-menos="${p.id}" aria-label="Diminuir">−</button>
  <span>${fmtQtd(q, p.unidade)}</span>
  <button data-mais="${p.id}" aria-label="Aumentar">+</button></div>`;

function renderGrid() {
  const l = listaFiltrada();
  const cat = S.cats.find(c => c.id == S.filtro);
  $('#titulo-lista').textContent = S.busca ? `Resultados para “${S.busca}”` : cat ? cat.nome : 'Todos os produtos';
  $('#grid').innerHTML = l.length ? l.map(cardHTML).join('')
    : `<div class="lj-vazio"><h3>Nada encontrado</h3><p>Não achou o que procura? A loja tem muito mais no balcão.</p>
       <a class="lj-btn" target="_blank" rel="noopener" href="https://wa.me/${S.cfg.whatsapp}?text=${encodeURIComponent('Procuro: ' + S.busca)}">Perguntar no WhatsApp</a></div>`;
}

function renderZonas() {
  const fg = S.cfg.frete_gratis_acima;
  $('#zonas').innerHTML = S.zonas.map(z => `<div class="lj-zona"><div><strong>${esc(z.nome)}</strong><span>${esc(z.bairros.join(', '))}</span></div>
    <div class="lj-zona__v"><strong>${brl(z.taxa_cliente)}</strong><span>até ${z.prazo_min} min</span></div></div>`).join('')
    + (fg ? `<p class="lj-zonas__fg">Frete grátis em compras a partir de <strong>${brl(fg)}</strong>${S.cfg.retirada_ativa ? ' · Retirada na loja sem custo' : ''}</p>` : '');
}

// ---------------- carrinho ----------------
function salvarCart() { store.set('quintal_cart', S.cart); atualizarContadores(); }
function addQ(id, delta) {
  const p = prod(id); if (!p) return;
  let it = S.cart.find(i => i.id === id);
  if (!it) { it = { id, q: 0 }; S.cart.push(it); }
  it.q = Math.round((it.q + delta * passo(p)) * 10) / 10;
  if (p.controla_estoque && it.q > p.estoque) { it.q = p.estoque; toast('Quantidade máxima em estoque', 'warn'); }
  if (it.q <= 0) S.cart = S.cart.filter(i => i.id !== id);
  salvarCart();
  const slot = document.querySelector(`[data-acao="${id}"]`);
  if (slot) { const n = S.cart.find(i => i.id === id); slot.innerHTML = n ? stepperHTML(p, n.q) : `<button class="lj-btn" data-add="${id}">Adicionar</button>`; }
  if (!$('#drawer').hidden && S.etapa === 'carrinho') renderDrawer();
}
function totais(forma = S.ck.pagamento_forma || 'pix_online') {
  const sub = S.cart.reduce((s, i) => s + Math.round(precoPara(prod(i.id), forma) * i.q * 100) / 100, 0);
  const subCartao = S.cart.reduce((s, i) => s + Math.round(precoBase(prod(i.id)) * i.q * 100) / 100, 0);
  let frete = 0;
  if (S.ck.modalidade !== 'retirada') {
    const z = S.zonas.find(z => z.id == S.ck.zona_id);
    frete = z ? +z.taxa_cliente : 0;
    if (S.cfg.frete_gratis_acima && sub >= +S.cfg.frete_gratis_acima) frete = 0;
  }
  return { sub, subCartao, frete, total: sub + frete, itens: S.cart.reduce((s, i) => s + (prod(i.id).unidade === 'kg' ? 1 : i.q), 0) };
}
function atualizarContadores() {
  const t = totais('cartao_entrega');
  const n = t.itens;
  $('#cart-count').hidden = !n; $('#cart-count').textContent = n;
  $('#mobilebar').hidden = !n;
  $('#mobilebar-qtd').textContent = `${n} ${n === 1 ? 'item' : 'itens'}`;
  $('#mobilebar-total').textContent = brl(t.subCartao);
}

// ---------------- gaveta / checkout ----------------
function abrir(etapa = 'carrinho') {
  S.etapa = etapa; renderDrawer();
  $('#drawer').hidden = false; $('#drawer-bg').hidden = false;
  requestAnimationFrame(() => { $('#drawer').classList.add('is-open'); $('#drawer').setAttribute('aria-hidden', 'false'); });
  document.body.classList.add('no-scroll');
}
function fechar() {
  $('#drawer').classList.remove('is-open'); $('#drawer').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('no-scroll');
  setTimeout(() => { $('#drawer').hidden = true; $('#drawer-bg').hidden = true; if (S.etapa === 'feito') { S.etapa = 'carrinho'; S.resultado = null; } }, 250);
}
const ETAPAS = ['carrinho', 'dados', 'entrega', 'pagamento'];
const TITULOS = { carrinho: 'Seu carrinho', dados: 'Seus dados', entrega: 'Entrega', pagamento: 'Pagamento', feito: 'Pedido enviado' };

function renderDrawer() {
  const e = S.etapa;
  $('#drawer-titulo').textContent = TITULOS[e];
  $('#btn-voltar').hidden = !['dados', 'entrega', 'pagamento'].includes(e);
  const idx = ETAPAS.indexOf(e);
  $('#progress').hidden = idx < 1;
  document.querySelectorAll('#progress li').forEach(li => li.classList.toggle('is-on', +li.dataset.p <= idx));
  ({ carrinho: vCarrinho, dados: vDados, entrega: vEntrega, pagamento: vPagamento, feito: vFeito })[e]();
}

function resumoHTML(forma) {
  const t = totais(forma);
  const faltaFG = S.cfg.frete_gratis_acima && S.ck.modalidade !== 'retirada' ? +S.cfg.frete_gratis_acima - t.sub : 0;
  return `<div class="lj-resumo">
    <div><span>Produtos</span><span>${brl(t.sub)}</span></div>
    ${S.ck.modalidade === 'retirada' ? '<div><span>Retirada na loja</span><span>Grátis</span></div>'
      : S.ck.zona_id ? `<div><span>Entrega</span><span>${t.frete ? brl(t.frete) : 'Grátis'}</span></div>` : ''}
    <div class="lj-resumo__total"><span>Total</span><strong>${brl(t.total)}</strong></div>
    ${faltaFG > 0 ? `<p class="lj-resumo__fg">Faltam ${brl(faltaFG)} para frete grátis</p>` : ''}
  </div>`;
}

function vCarrinho() {
  const body = $('#drawer-body'), foot = $('#drawer-foot');
  if (!S.cart.length) {
    body.innerHTML = `<div class="lj-vazio lj-vazio--drawer"><h3>Carrinho vazio</h3><p>Adicione produtos para começar.</p></div>`;
    foot.innerHTML = `<button class="lj-btn lj-btn--block lj-btn--ghost" data-fechar>Continuar comprando</button>`;
    return;
  }
  body.innerHTML = `<ul class="lj-itens">${S.cart.map(i => {
    const p = prod(i.id);
    return `<li class="lj-item">
      <img src="${esc(asset(p.foto_url))}" alt="" width="56" height="56">
      <div class="lj-item__info"><strong>${esc(p.nome)}</strong>
        <span>${brl(precoBase(p))}${unLabel(p)}${p.preco_pix && +p.preco_pix < precoBase(p) ? ` · Pix ${brl(p.preco_pix)}${unLabel(p)}` : ''}</span>
        ${stepperHTML(p, i.q)}</div>
      <strong class="lj-item__tot">${brl(precoBase(p) * i.q)}</strong>
    </li>`;
  }).join('')}</ul>
  ${S.cart.some(i => prod(i.id).unidade === 'kg') ? '<p class="lj-nota">Itens a granel são pesados na hora. O valor final pode variar alguns gramas.</p>' : ''}`;
  const t = totais('cartao_entrega');
  const min = +S.cfg.pedido_minimo || 0;
  foot.innerHTML = `<div class="lj-resumo"><div class="lj-resumo__total"><span>Subtotal</span><strong>${brl(t.subCartao)}</strong></div>
    ${t.sub > totais('pix_online').sub ? `<p class="lj-resumo__fg">${brl(totais('pix_online').sub)} pagando no Pix</p>` : ''}</div>
    ${t.subCartao < min ? `<p class="lj-alerta">Pedido mínimo de ${brl(min)}. Faltam ${brl(min - t.subCartao)}.</p>` : ''}
    <button class="lj-btn lj-btn--block" data-ir="dados" ${t.subCartao < min ? 'disabled' : ''}>Finalizar compra</button>`;
}

function vDados() {
  const c = S.ck;
  $('#drawer-body').innerHTML = `<form id="f-dados" class="lj-form" novalidate>
    <label>Nome completo<input name="cliente_nome" required autocomplete="name" value="${esc(c.cliente_nome || '')}"></label>
    <label>WhatsApp<input name="cliente_telefone" required inputmode="tel" autocomplete="tel" placeholder="(67) 99999-9999" value="${esc(c.cliente_telefone || '')}"></label>
    <p class="lj-nota">Usamos o WhatsApp para confirmar o pedido e avisar quando sair para entrega.</p>
  </form>`;
  $('#drawer-foot').innerHTML = `<button class="lj-btn lj-btn--block" data-submit="f-dados">Continuar</button>`;
  $('#f-dados').cliente_telefone.addEventListener('input', (ev) => { ev.target.value = mascaraTel(ev.target.value); });
}
function mascaraTel(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
}

function vEntrega() {
  const c = S.ck; c.modalidade ||= 'entrega';
  $('#drawer-body').innerHTML = `<form id="f-entrega" class="lj-form" novalidate>
    <div class="lj-opcoes">
      <label class="lj-opcao"><input type="radio" name="modalidade" value="entrega" ${c.modalidade === 'entrega' ? 'checked' : ''}>
        <span><strong>Receber em casa</strong><small>Motoboy parceiro, no mesmo dia</small></span></label>
      ${S.cfg.retirada_ativa ? `<label class="lj-opcao"><input type="radio" name="modalidade" value="retirada" ${c.modalidade === 'retirada' ? 'checked' : ''}>
        <span><strong>Retirar na loja</strong><small>R. Corumbá, 180 — grátis</small></span></label>` : ''}
    </div>
    <div id="campos-end" ${c.modalidade === 'retirada' ? 'hidden' : ''}>
      <label>Bairro<select name="zona_id" required>
        <option value="">Selecione o bairro</option>
        ${S.zonas.map(z => `<optgroup label="${esc(z.nome)} · ${brl(z.taxa_cliente)} · até ${z.prazo_min} min">
          ${z.bairros.map(b => `<option value="${z.id}" data-b="${esc(b)}" ${c.zona_id == z.id && c.bairro_nome === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</optgroup>`).join('')}
      </select></label>
      <div class="lj-row"><label class="lj-grow">Rua / Avenida<input name="endereco" autocomplete="address-line1" value="${esc(c.endereco || '')}"></label>
        <label class="lj-num">Número<input name="numero_end" inputmode="numeric" value="${esc(c.numero_end || '')}"></label></div>
      <label>Complemento<input name="complemento" placeholder="Casa, apto, bloco" value="${esc(c.complemento || '')}"></label>
      <label>Ponto de referência<input name="referencia" placeholder="Ajuda o entregador a achar rápido" value="${esc(c.referencia || '')}"></label>
    </div>
  </form>`;
  $('#drawer-foot').innerHTML = resumoHTML() + `<button class="lj-btn lj-btn--block" data-submit="f-entrega">Ir para pagamento</button>`;
  const f = $('#f-entrega');
  f.addEventListener('change', () => {
    S.ck.modalidade = f.modalidade.value;
    const opt = f.zona_id.selectedOptions[0];
    S.ck.zona_id = f.zona_id.value || null; S.ck.bairro_nome = opt?.dataset.b || null;
    $('#campos-end').hidden = S.ck.modalidade === 'retirada';
    $('#drawer-foot').querySelector('.lj-resumo').outerHTML = resumoHTML();
  });
}

function vPagamento() {
  const c = S.ck;
  const opcoes = [
    ['pix_online', 'Pix agora', 'Menor preço · QR Code na tela', true],
    ['cartao_online', 'Cartão de crédito online', 'Mercado Pago · em até 3x', !!S.cfg.cartao_online_ativo],
    ['pix_entrega', 'Pix na entrega', 'Paga quando receber', c.modalidade === 'entrega'],
    ['cartao_entrega', 'Cartão na entrega', 'Débito ou crédito na maquininha', true],
    ['dinheiro', 'Dinheiro', 'Na entrega ou no balcão', true],
  ].filter(o => o[3]);
  if (!opcoes.find(o => o[0] === c.pagamento_forma)) c.pagamento_forma = 'pix_online';
  const grupo = (titulo, ids) => {
    const os = opcoes.filter(o => ids.includes(o[0])); if (!os.length) return '';
    return `<p class="lj-grupo">${titulo}</p><div class="lj-opcoes">${os.map(([v, t, d]) => {
      const tt = totais(v);
      return `<label class="lj-opcao"><input type="radio" name="pagamento_forma" value="${v}" ${c.pagamento_forma === v ? 'checked' : ''}>
        <span><strong>${t}</strong><small>${d}</small></span><em>${brl(tt.total)}</em></label>`;
    }).join('')}</div>`;
  };
  $('#drawer-body').innerHTML = `<form id="f-pag" class="lj-form" novalidate>
    ${grupo('Pagar agora', ['pix_online', 'cartao_online'])}
    ${grupo(c.modalidade === 'retirada' ? 'Pagar na retirada' : 'Pagar na entrega', ['pix_entrega', 'cartao_entrega', 'dinheiro'])}
    <label id="troco" ${c.pagamento_forma === 'dinheiro' ? '' : 'hidden'}>Troco para quanto?<input name="troco_para" inputmode="decimal" placeholder="Ex.: 200" value="${esc(c.troco_para || '')}"></label>
    <label>Observações<textarea name="observacoes" rows="2" placeholder="Ex.: pode deixar com o porteiro">${esc(c.observacoes || '')}</textarea></label>
    <div class="lj-revisao">
      <strong>${esc(c.cliente_nome)}</strong> · ${esc(c.cliente_telefone)}<br>
      ${c.modalidade === 'retirada' ? 'Retirada na loja' : `${esc(c.endereco)}, ${esc(c.numero_end || 's/n')} — ${esc(c.bairro_nome || '')}`}
    </div>
  </form>`;
  const pintar = () => {
    $('#drawer-foot').innerHTML = resumoHTML(S.ck.pagamento_forma) +
      `<button class="lj-btn lj-btn--block lj-btn--go" data-submit="f-pag" ${S.enviando ? 'disabled' : ''}>${S.enviando ? 'Enviando…' : 'Confirmar pedido · ' + brl(totais(S.ck.pagamento_forma).total)}</button>`;
  };
  pintar();
  $('#f-pag').addEventListener('change', (ev) => {
    if (ev.target.name === 'pagamento_forma') { S.ck.pagamento_forma = ev.target.value; $('#troco').hidden = ev.target.value !== 'dinheiro'; pintar(); }
  });
}

function vFeito() {
  const r = S.resultado, c = S.ck;
  const linkRastreio = new URL(`pedido.html?t=${r.token}`, location.href).href;
  const itensTxt = r.itens.map(i => `• ${fmtQtd(i.quantidade, prod(i.produto_id)?.unidade)} ${prod(i.produto_id)?.unidade === 'kg' ? '' : 'x '}${i.nome} — ${brl(i.total)}`).join('\n');
  const msg = `Olá! Fiz o pedido *#${r.numero}* pelo site.\n\n${itensTxt}\n\nTotal: *${brl(r.total)}* (${PAGTO[r.pagamento_forma]})\n${c.modalidade === 'retirada' ? 'Vou retirar na loja.' : `Entrega: ${c.endereco}, ${c.numero_end || 's/n'} — ${c.bairro_nome}`}\n\nAcompanhar: ${linkRastreio}`;
  let pix = '';
  if (r.pagamento_forma === 'pix_online') {
    if (S.cfg.pix_chave) {
      const payload = pixPayload({ chave: S.cfg.pix_chave, nome: S.cfg.pix_nome || 'QUINTAL RACOES', cidade: S.cfg.pix_cidade || 'CHAPADAO DO SUL', valor: r.total, txid: `QR${r.numero}` });
      pix = `<div class="lj-pixbox"><p class="lj-grupo">Pague com Pix · ${brl(r.total)}</p><div id="qr" class="lj-qr"></div>
        <textarea readonly id="pix-code" rows="3">${payload}</textarea>
        <button class="lj-btn lj-btn--block lj-btn--ghost" id="copiar-pix">Copiar código Pix</button>
        <p class="lj-nota">Depois de pagar, envie o comprovante no WhatsApp para agilizar a separação.</p></div>`;
      setTimeout(async () => {
        try { const QR = (await import('https://esm.sh/qrcode@1.5.4')).default; $('#qr').innerHTML = `<img alt="QR Code Pix" width="200" height="200" src="${await QR.toDataURL(payload, { margin: 1, width: 400 })}">`; } catch { $('#qr').remove(); }
      }, 0);
    } else {
      pix = `<div class="lj-pixbox"><p class="lj-nota">A loja vai enviar a chave Pix pelo WhatsApp para pagamento de <strong>${brl(r.total)}</strong>.</p></div>`;
    }
  }
  $('#drawer-body').innerHTML = `<div class="lj-ok">
    <div class="lj-ok__icon" aria-hidden="true"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17l9-10"/></svg></div>
    <h3>Pedido #${r.numero} recebido</h3>
    <p>${c.modalidade === 'retirada' ? 'Avisamos no WhatsApp quando estiver pronto para retirar.' : `Previsão de entrega: até ${r.prazo_min || 60} min após a confirmação.`}</p>
  </div>${pix}
  <a class="lj-btn lj-btn--block lj-btn--whats" target="_blank" rel="noopener" href="https://wa.me/${S.cfg.whatsapp}?text=${encodeURIComponent(msg)}">Enviar pedido no WhatsApp da loja</a>
  <a class="lj-btn lj-btn--block lj-btn--ghost" href="${linkRastreio}">Acompanhar pedido</a>`;
  $('#drawer-foot').innerHTML = '';
  $('#copiar-pix')?.addEventListener('click', async () => {
    const t = $('#pix-code'); t.select();
    try { await navigator.clipboard.writeText(t.value); } catch { document.execCommand('copy'); }
    toast('Código Pix copiado');
  });
}

// ---------------- envio do pedido ----------------
async function enviarPedido() {
  if (S.enviando) return;
  S.enviando = true; vPagamento();
  const c = S.ck;
  const payload = {
    cliente_nome: c.cliente_nome, cliente_telefone: c.cliente_telefone, modalidade: c.modalidade,
    zona_id: c.modalidade === 'entrega' ? c.zona_id : null,
    endereco: c.endereco, numero_end: c.numero_end, complemento: c.complemento,
    bairro: c.bairro_nome, referencia: c.referencia,
    pagamento_forma: c.pagamento_forma, troco_para: c.pagamento_forma === 'dinheiro' ? String(c.troco_para || '').replace(',', '.') : null,
    observacoes: c.observacoes, itens: S.cart.map(i => ({ produto_id: i.id, quantidade: i.q })),
  };
  const { data, error } = await sb.rpc('criar_pedido', { payload });
  S.enviando = false;
  if (error) { vPagamento(); return toast(error.message.replace(/^.*?:\s*/, '') || 'Não foi possível enviar', 'erro'); }
  S.resultado = data;
  const hist = store.get('quintal_pedidos', []); hist.unshift({ numero: data.numero, token: data.token, em: Date.now() }); store.set('quintal_pedidos', hist.slice(0, 10));
  const { observacoes, troco_para, ...lembrar } = c; store.set('quintal_cliente', lembrar);
  S.cart = []; salvarCart(); renderGrid();

  if (data.pagamento_forma === 'cartao_online') {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/mp-checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY }, body: JSON.stringify({ token: data.token, voltar: new URL(`pedido.html?t=${data.token}`, location.href).href }) });
      const j = await r.json();
      if (j.init_point) { location.href = j.init_point; return; }
    } catch { /* cai na tela de sucesso */ }
    toast('Pagamento online indisponível agora. A loja vai combinar com você.', 'warn');
  }
  S.etapa = 'feito'; renderDrawer();
}

// ---------------- eventos ----------------
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('button, [data-fechar]'); if (!t) return;
  if (t.dataset.add) { addQ(+t.dataset.add, 1); toast('Adicionado ao carrinho'); }
  else if (t.dataset.mais) addQ(+t.dataset.mais, 1);
  else if (t.dataset.menos) addQ(+t.dataset.menos, -1);
  else if (t.dataset.cat) { S.filtro = t.dataset.cat; renderChips(); renderGrid(); }
  else if (t.dataset.ir) { S.etapa = t.dataset.ir; renderDrawer(); }
  else if (t.dataset.fechar !== undefined) fechar();
  else if (t.dataset.submit) submeter(t.dataset.submit);
});
function submeter(id) {
  const f = document.getElementById(id); if (!f) return;
  const fd = Object.fromEntries(new FormData(f));
  if (id === 'f-dados') {
    if ((fd.cliente_nome || '').trim().length < 3) return toast('Informe seu nome completo', 'erro');
    if (fd.cliente_telefone.replace(/\D/g, '').length < 10) return toast('Informe um WhatsApp válido com DDD', 'erro');
    Object.assign(S.ck, fd); S.etapa = 'entrega';
  } else if (id === 'f-entrega') {
    if (S.ck.modalidade === 'entrega') {
      if (!S.ck.zona_id) return toast('Selecione o bairro', 'erro');
      if (!(fd.endereco || '').trim()) return toast('Informe a rua', 'erro');
    }
    Object.assign(S.ck, fd); S.etapa = 'pagamento';
  } else if (id === 'f-pag') {
    Object.assign(S.ck, fd); return enviarPedido();
  }
  store.set('quintal_cliente', S.ck); renderDrawer();
}
$('#btn-carrinho').onclick = () => abrir();
$('#mobilebar').onclick = () => abrir();
$('#btn-fechar').onclick = fechar;
$('#drawer-bg').onclick = fechar;
$('#btn-voltar').onclick = () => { S.etapa = ETAPAS[Math.max(0, ETAPAS.indexOf(S.etapa) - 1)]; renderDrawer(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawer').hidden) fechar(); });
$('#form-busca').onsubmit = (e) => { e.preventDefault(); S.busca = $('#busca').value; renderGrid(); };
$('#busca').oninput = (e) => { S.busca = e.target.value; renderGrid(); };
$('#ordem').onchange = (e) => { S.ordem = e.target.value; renderGrid(); };

// ---------------- init ----------------
try {
  await carregar();
  renderChips(); renderGrid(); renderZonas(); atualizarContadores();
  if (new URLSearchParams(location.search).get('carrinho')) abrir();
} catch (err) {
  console.error(err);
  $('#grid').innerHTML = `<div class="lj-vazio"><h3>Não conseguimos carregar a loja</h3><p>Verifique sua conexão ou peça pelo WhatsApp.</p>
    <a class="lj-btn" href="https://wa.me/5567999638298" target="_blank" rel="noopener">Pedir pelo WhatsApp</a></div>`;
}
