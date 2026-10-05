// Quintal — Gestão simples da loja (vender, caixa, estoque, contas)
import { supabase } from '../admin/js/supabase-client.js';
import { precoPara, pixPayload } from '../loja/common.js';

// ============================================================
// Utilidades
// ============================================================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (s) => {
  if (typeof s === 'number') return s;
  let t = String(s ?? '').replace(/[^\d,.-]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(t); return Number.isFinite(n) ? n : NaN;
};
const r2 = (n) => Math.round(n * 100) / 100;
const hojeISO = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const somaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return hojeISO(d); };
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const dataBR = (iso) => { if (!iso) return ''; const d = new Date(String(iso).slice(0, 10) + 'T12:00:00'); return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} (${DIAS[d.getDay()]})`; };
const hora = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const UN = { kg: ['kg', 'kg'], saco: ['saco', 'sacos'], un: ['unidade', 'unidades'], pacote: ['pacote', 'pacotes'], cx: ['caixa', 'caixas'] };
const qtdTxt = (q, un) => {
  const n = +q; const u = UN[un] || ['unidade', 'unidades'];
  if (un === 'kg') return `${String(r2(n)).replace('.', ',')} kg`;
  const v = Number.isInteger(n) ? n : String(r2(n)).replace('.', ',');
  return `${v} ${Math.abs(n) === 1 ? u[0] : u[1]}`;
};
const foto = (u) => !u ? '../assets/logo.png' : (/^https?:/.test(u) ? u : '..' + (u.startsWith('/') ? u : '/' + u));
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const ICO = {
  vender: '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
  caixa: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="12" cy="14.5" r="2"/>',
  estoque: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  caminhao: '<path d="M2 6h11v10H2zM13 10h4l3 3v3h-7"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  conta: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/>',
  mao: '<path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11m0-1V5a1.5 1.5 0 0 1 3 0v6m0-4.5a1.5 1.5 0 0 1 3 0V12m0-2.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5A6.5 6.5 0 0 1 5 16.2L3.6 13a1.5 1.5 0 0 1 2.6-1.4L7 13"/>',
  grafico: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  site: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  ok: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  okc: '<circle cx="12" cy="12" r="10"/><path d="m7 12.5 3.2 3.2L17 9"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  lixo: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  imp: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z"/>',
  whats: '<path d="M4 20l1.3-3.8A8 8 0 1 1 8 19z"/><path d="M9 9.5c.3 2 2.3 4.2 4.6 4.8l1.2-1.2 1.7.8-.4 1.6c-3.5.4-7.6-3.6-7.2-7.2l1.6-.4.8 1.7z"/>',
};
const ico = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k]}</svg>`;

function recado(msg, tipo = 'ok') {
  $$('.recado').forEach(e => e.remove());
  const el = document.createElement('div');
  el.className = `recado recado--${tipo}`; el.setAttribute('role', 'status'); el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 6000 : 2000);
}
const msgErro = (e) => {
  const m = e?.message || String(e);
  if (/JWT|session|auth/i.test(m)) return 'Sua sessão terminou. Entre de novo.';
  if (/fetch|network/i.test(m)) return 'Sem internet. Confira a conexão e tente de novo.';
  return m.replace(/^.*?:\s*(?=[A-ZÀ-Ú])/, '');
};
async function rpc(nome, args) {
  const { data, error } = await supabase.rpc(nome, args);
  if (error) throw error;
  return data;
}
async function q(promessa) { const { data, error } = await promessa; if (error) throw error; return data; }

// janela (caixa de diálogo)
const fundo = $('#janela-fundo'), jan = $('#janela');
function abrirJanela(html) {
  jan.innerHTML = html; fundo.hidden = false;
  setTimeout(() => (jan.querySelector('[autofocus]') || jan.querySelector('input,button'))?.focus(), 30);
  return jan;
}
function fecharJanela() { fundo.hidden = true; jan.innerHTML = ''; }
fundo.addEventListener('click', (e) => { if (e.target === fundo) fecharJanela(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !fundo.hidden) fecharJanela(); });
jan.addEventListener('click', (e) => { if (e.target.closest('[data-fechar]')) fecharJanela(); });

// botão de ação que trava enquanto processa
async function acao(btn, fn) {
  if (btn.disabled) return;
  const txt = btn.innerHTML; btn.disabled = true; btn.textContent = 'Aguarde…';
  try { await fn(); } catch (e) { recado(msgErro(e), 'erro'); btn.disabled = false; btn.innerHTML = txt; }
}

// campo de dinheiro: aceita "12,50"
const campoDinheiro = (id, rotulo, valor = '', extra = '') => `
  <label class="campo campo--dinheiro"><span>${rotulo}</span>
    <input id="${id}" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${valor === '' ? '' : String(r2(valor).toFixed(2)).replace('.', ',')}" ${extra}>
  </label>`;

// ============================================================
// Tamanho da letra
// ============================================================
const TAMS = ['', 'g', 'gg'];
const guarda = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } } };
let tam = Math.max(0, TAMS.indexOf(guarda.get('qg-tam') || ''));
const aplicaTam = () => { document.documentElement.dataset.tam = TAMS[tam]; $('#tam').textContent = ['A+', 'A++', 'A'][tam]; };
$('#tam').addEventListener('click', () => { tam = (tam + 1) % 3; guarda.set('qg-tam', TAMS[tam]); aplicaTam(); });
aplicaTam();

// ============================================================
// Estado e navegação
// ============================================================
const S = { perfil: null, admin: false, cfg: {}, produtos: null, venda: [], desconto: 0, clientes: null };
const tela = $('#tela');
const TELAS = {};
const TITULOS = { inicio: 'Gestão da loja', vender: 'Vender', caixa: 'Caixa', estoque: 'Estoque', mercadoria: 'Chegou mercadoria', pagar: 'Contas para pagar', receber: 'Quem me deve', resumo: 'Como está a loja' };
$('#voltar').addEventListener('click', () => { location.hash = '#inicio'; });

async function ir() {
  fecharJanela();
  const nome = (location.hash.slice(1) || 'inicio').split('?')[0];
  const fn = TELAS[nome] || TELAS.inicio;
  document.body.classList.toggle('na-inicio', !TELAS[nome] || nome === 'inicio');
  $('#titulo').textContent = TITULOS[nome] || TITULOS.inicio;
  document.title = `Quintal — ${TITULOS[nome] || 'Gestão'}`;
  tela.innerHTML = '<div class="carregando">Carregando…</div>';
  window.scrollTo(0, 0);
  try { await fn(); } catch (e) { tela.innerHTML = `<div class="aviso aviso--vermelho">${esc(msgErro(e))}</div><button class="btn btn--cheio" onclick="location.reload()">Tentar de novo</button>`; }
  tela.focus({ preventScroll: true });
}
window.addEventListener('hashchange', ir);

async function carregaProdutos(forcar = false) {
  if (S.produtos && !forcar) return S.produtos;
  S.produtos = await q(supabase.from('produtos')
    .select('id, nome, unidade, preco_normal, preco_pix, preco_promocional, promo_inicio, promo_fim, foto_url, gtin, sku, estoque, estoque_minimo, peso_kg, ativo')
    .eq('ativo', true).order('nome'));
  return S.produtos;
}
const buscaProdutos = (lista, termo) => {
  const t = semAcento(termo).trim();
  if (!t) return lista;
  const partes = t.split(/\s+/);
  return lista.filter(p => { const n = semAcento(`${p.nome} ${p.sku || ''} ${p.gtin || ''}`); return partes.every(x => n.includes(x)); });
};

// ============================================================
// Entrar
// ============================================================
function telaLogin(msg = '') {
  document.body.classList.add('na-inicio');
  tela.innerHTML = `
    <form class="login" id="f-login">
      <img src="../assets/logo.png" alt="Quintal Rações">
      <h1 style="text-align:center">Entrar</h1>
      ${msg ? `<div class="aviso aviso--vermelho">${esc(msg)}</div>` : ''}
      <label class="campo"><span>E-mail</span><input id="l-email" type="email" autocomplete="username" required autofocus></label>
      <label class="campo"><span>Senha</span><input id="l-senha" type="password" autocomplete="current-password" required></label>
      <button class="btn btn--sim btn--cheio" type="submit">Entrar</button>
    </form>`;
  $('#f-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = e.submitter || $('#f-login button');
    await acao(b, async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: $('#l-email').value.trim(), password: $('#l-senha').value });
      if (error) throw new Error('E-mail ou senha não conferem.');
      location.reload();
    });
  });
}

// ============================================================
// INÍCIO
// ============================================================
TELAS.inicio = async () => {
  const r = await rpc('resumo_loja', {});
  const h = new Date().getHours();
  const saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const nome = (S.perfil.nome || '').split(' ')[0];
  const av = [];
  if (!r.caixa_aberto) av.push(`<div class="aviso aviso--amarelo">O caixa está fechado. Abra o caixa para vender. <a class="btn btn--mostarda" href="#caixa">Abrir</a></div>`);
  if (S.admin && +r.pagar_vencido > 0) av.push(`<div class="aviso aviso--vermelho">Tem conta atrasada: ${brl(r.pagar_vencido)} <a class="btn btn--perigo" href="#pagar">Ver</a></div>`);
  if (S.admin && +r.pagar_hoje > 0) av.push(`<div class="aviso aviso--amarelo">Vence hoje: ${brl(r.pagar_hoje)} <a class="btn btn--mostarda" href="#pagar">Ver</a></div>`);
  if (+r.estoque_baixo > 0) av.push(`<div class="aviso aviso--amarelo">${r.estoque_baixo} ${r.estoque_baixo == 1 ? 'produto está acabando' : 'produtos estão acabando'} <a class="btn btn--mostarda" href="#estoque?acabando">Ver</a></div>`);
  if (+r.pedidos_abertos > 0) av.push(`<div class="aviso aviso--azul">${r.pedidos_abertos} ${r.pedidos_abertos == 1 ? 'pedido do site esperando' : 'pedidos do site esperando'} <a class="btn btn--escuro" href="../admin/pedidos.html">Ver</a></div>`);

  const bt = (href, icone, titulo, sub, cls = '', selo = '') => `
    <a class="botao-menu ${cls}" href="${href}">
      <span class="botao-menu__ico">${ico(icone)}</span>
      <span><strong>${titulo}</strong><small>${sub}</small>${selo ? `<span class="selo">${selo}</span>` : ''}</span>
    </a>`;
  tela.innerHTML = `
    <p class="ola">${saud}${nome ? ', ' + esc(nome) : ''}.</p>
    <p class="data">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })} · Vendido hoje: <strong>${brl(+r.vendas_balcao + +r.vendas_online)}</strong></p>
    ${av.join('')}
    <nav class="menu" aria-label="O que você quer fazer">
      ${bt('#vender', 'vender', 'Vender', 'Registrar uma venda no balcão', 'botao-menu--destaque')}
      ${bt('#caixa', 'caixa', 'Caixa', r.caixa_aberto ? 'Colocar, tirar ou fechar o caixa' : 'Abrir o caixa do dia')}
      ${bt('#estoque', 'estoque', 'Estoque', 'Ver o que tem e o que está acabando', '', +r.estoque_baixo > 0 ? `${r.estoque_baixo} acabando` : '')}
      ${S.admin ? bt('#mercadoria', 'caminhao', 'Chegou mercadoria', 'Lançar a nota do fornecedor') : ''}
      ${S.admin ? bt('#pagar', 'conta', 'Contas para pagar', 'Boletos, aluguel, luz, fornecedor', '', +r.pagar_vencido > 0 ? 'Tem atrasada' : +r.pagar_hoje > 0 ? 'Vence hoje' : '') : ''}
      ${bt('#receber', 'mao', 'Quem me deve', 'Fiado e valores a receber', '', +r.fiado_aberto > 0 ? `Fiado: ${brl(r.fiado_aberto)}` : '')}
      ${bt('#resumo', 'grafico', 'Como está a loja', 'Vendas, gastos e quanto sobrou')}
      ${bt('../admin/pedidos.html', 'site', 'Pedidos do site', 'Pedidos e entregas da loja online')}
    </nav>
    <div class="linha-btns" style="margin-top:28px"><button class="btn" id="sair">Sair do sistema</button></div>`;
  $('#sair').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });
};

// ============================================================
// VENDER
// ============================================================
const precoVista = (p) => precoPara(p, 'dinheiro');
const precoPrazo = (p) => precoPara(p, 'cartao');
const totais = () => {
  const vista = r2(S.venda.reduce((s, i) => s + r2(i.qtd * precoVista(i.p)), 0));
  const prazo = r2(S.venda.reduce((s, i) => s + r2(i.qtd * precoPrazo(i.p)), 0));
  return { vista, prazo };
};

TELAS.vender = async () => {
  const [res] = await Promise.all([rpc('caixa_resumo', {}), carregaProdutos()]);
  if (!res) {
    tela.innerHTML = `<div class="aviso aviso--amarelo">Para vender, primeiro abra o caixa.</div><a class="btn btn--mostarda btn--cheio" href="#caixa">Abrir o caixa</a>`;
    return;
  }
  tela.innerHTML = `
    <p class="ajuda">Procure o produto pelo nome ou passe o leitor no código de barras. Toque no produto para colocar na venda.</p>
    <div id="carrinho" class="carrinho"></div>
    <h2 id="tit-busca">Procurar produto</h2>
    <input class="busca" id="busca" type="search" placeholder="Digite o nome do produto" autocomplete="off" aria-labelledby="tit-busca">
    <div class="lista" id="resultados" style="margin-top:14px"></div>
    <div class="barra-total" id="barra"></div>`;
  const busca = $('#busca');
  const desenhaBusca = () => {
    const lista = buscaProdutos(S.produtos, busca.value).filter(p => precoVista(p) != null).slice(0, 40);
    $('#resultados').innerHTML = lista.length ? lista.map(p => `
      <button class="item" data-add="${p.id}">
        <img src="${esc(foto(p.foto_url))}" alt="" loading="lazy">
        <span class="item__txt"><span class="item__nome">${esc(p.nome)}</span>
          <span class="item__sub">${p.unidade === 'kg' ? 'Vendido por kg' : 'Tem: ' + qtdTxt(p.estoque, p.unidade)}</span></span>
        <span class="item__valor">${brl(precoVista(p))}${p.unidade === 'kg' ? '<small>o kg</small>' : ''}${precoPrazo(p) !== precoVista(p) ? `<small>cartão ${brl(precoPrazo(p))}</small>` : ''}</span>
      </button>`).join('') : `<div class="vazio">Nenhum produto com esse nome. Tente outra palavra.</div>`;
  };
  busca.addEventListener('input', desenhaBusca);
  busca.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = busca.value.trim();
    const p = S.produtos.find(x => (x.gtin && x.gtin === t) || (x.sku && x.sku.toLowerCase() === t.toLowerCase()));
    if (p) { e.preventDefault(); colocar(p, p.unidade === 'kg' ? null : 1); busca.value = ''; desenhaBusca(); }
  });
  $('#resultados').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    pedirQtd(S.produtos.find(p => p.id == b.dataset.add));
  });
  desenhaBusca(); desenhaVenda();
  if (!S.venda.length) busca.focus();
};

function colocar(p, qtd) {
  if (qtd == null) return pedirQtd(p);
  const ex = S.venda.find(i => i.p.id === p.id);
  if (ex) ex.qtd = r2(ex.qtd + qtd); else S.venda.push({ p, qtd });
  desenhaVenda();
  recado(`${p.nome} colocado na venda`);
}

function pedirQtd(p) {
  const kg = p.unidade === 'kg';
  let qtd = kg ? 1 : 1;
  const j = abrirJanela(`
    <h2>${esc(p.nome)}</h2>
    <p class="ajuda">${kg ? 'Quantos quilos?' : 'Quantos?'} Preço: <strong>${brl(precoVista(p))}${kg ? ' o kg' : ''}</strong></p>
    ${kg ? `
      <div class="notas">${[0.5, 1, 2, 3, 5, 10].map(v => `<button type="button" data-kg="${v}">${String(v).replace('.', ',')} kg</button>`).join('')}</div>
      <label class="campo campo--dinheiro"><span>Ou digite o peso (kg)</span><input id="q-kg" inputmode="decimal" value="1" autofocus></label>
    ` : `
      <div class="qtd" style="justify-content:center;margin:10px 0 18px">
        <button type="button" data-d="-1" aria-label="Diminuir">−</button>
        <output id="q-n" style="font-size:2.4rem;min-width:110px">1</output>
        <button type="button" data-d="1" aria-label="Aumentar">+</button>
      </div>`}
    <p style="font-size:1.3rem;text-align:center">Fica: <strong id="q-tot">${brl(precoVista(p))}</strong></p>
    <div class="linha-btns">
      <button class="btn btn--nao" data-fechar>Voltar</button>
      <button class="btn btn--sim" id="q-ok">${ico('ok')} Colocar na venda</button>
    </div>`);
  const atual = () => { $('#q-tot', j).textContent = Number.isFinite(qtd) && qtd > 0 ? brl(r2(qtd * precoVista(p))) : '—'; };
  if (kg) {
    const inp = $('#q-kg', j);
    inp.select();
    inp.addEventListener('input', () => { qtd = num(inp.value); atual(); });
    $$('[data-kg]', j).forEach(b => b.addEventListener('click', () => { qtd = +b.dataset.kg; inp.value = String(qtd).replace('.', ','); atual(); }));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#q-ok', j).click(); });
  } else {
    $$('[data-d]', j).forEach(b => b.addEventListener('click', () => { qtd = Math.max(1, qtd + +b.dataset.d); $('#q-n', j).textContent = qtd; atual(); }));
  }
  $('#q-ok', j).addEventListener('click', () => {
    if (!Number.isFinite(qtd) || qtd <= 0) return recado('Digite uma quantidade válida', 'erro');
    fecharJanela(); colocar(p, r2(qtd)); $('#busca')?.focus();
  });
}

function desenhaVenda() {
  const box = $('#carrinho'); const barra = $('#barra'); if (!box) return;
  const t = totais();
  box.innerHTML = S.venda.length ? `
    <h2 style="margin-top:0">Na venda (${S.venda.length})</h2>
    <div class="lista">${S.venda.map((i, k) => `
      <div class="item item--venda">
        <span class="item__txt"><span class="item__nome">${esc(i.p.nome)}</span>
          <span class="item__sub">${qtdTxt(i.qtd, i.p.unidade)} × ${brl(precoVista(i.p))}</span></span>
        ${i.p.unidade === 'kg' ? `<button class="btn" data-editar="${k}">Mudar</button>` : `
        <span class="qtd"><button data-m="${k}" aria-label="Menos um">−</button><output>${i.qtd}</output><button data-p="${k}" aria-label="Mais um">+</button></span>`}
        <span class="item__valor">${brl(r2(i.qtd * precoVista(i.p)))}</span>
        <button class="btn btn--nao" data-tirar="${k}" aria-label="Tirar ${esc(i.p.nome)} da venda">${ico('lixo')}</button>
      </div>`).join('')}
    </div>` : `<div class="vazio">Nenhum produto na venda ainda.</div>`;
  barra.innerHTML = `<div class="barra-total__in">
      <div class="barra-total__val">
        <div>Dinheiro ou Pix</div><strong>${brl(t.vista)}</strong>
        ${t.prazo !== t.vista ? `<div>No cartão ou fiado: ${brl(t.prazo)}</div>` : ''}
      </div>
      <button class="btn btn--mostarda" id="receber" ${S.venda.length ? '' : 'disabled'}>Receber</button>
    </div>`;
  $$('[data-tirar]', box).forEach(b => b.addEventListener('click', () => { S.venda.splice(+b.dataset.tirar, 1); desenhaVenda(); }));
  $$('[data-m]', box).forEach(b => b.addEventListener('click', () => { const i = S.venda[+b.dataset.m]; i.qtd = Math.max(1, i.qtd - 1); desenhaVenda(); }));
  $$('[data-p]', box).forEach(b => b.addEventListener('click', () => { S.venda[+b.dataset.p].qtd += 1; desenhaVenda(); }));
  $$('[data-editar]', box).forEach(b => b.addEventListener('click', () => { const i = S.venda[+b.dataset.editar]; S.venda.splice(+b.dataset.editar, 1); pedirQtd(i.p); desenhaVenda(); }));
  $('#receber', barra)?.addEventListener('click', escolherPagamento);
}

function escolherPagamento() {
  const t = totais();
  const j = abrirJanela(`
    <h2>Como o cliente vai pagar?</h2>
    <div class="grade-escolha">
      <button class="btn" data-f="dinheiro">Dinheiro<small>${brl(t.vista)}</small></button>
      <button class="btn" data-f="pix">Pix<small>${brl(t.vista)}</small></button>
      <button class="btn" data-f="debito">Cartão de débito<small>${brl(t.prazo)}</small></button>
      <button class="btn" data-f="credito">Cartão de crédito<small>${brl(t.prazo)}</small></button>
      <button class="btn" data-f="fiado" style="grid-column:1/-1">Fiado (anotar para o cliente)<small>${brl(t.prazo)}</small></button>
    </div>
    <div class="linha-btns">
      <button class="btn btn--nao" data-fechar>Voltar</button>
      <button class="btn" id="desc">Dar desconto${S.desconto ? ` (${brl(S.desconto)})` : ''}</button>
    </div>`);
  $$('[data-f]', j).forEach(b => b.addEventListener('click', () => pagarCom(b.dataset.f)));
  $('#desc', j).addEventListener('click', () => {
    const jj = abrirJanela(`
      <h2>Desconto</h2>
      <p class="ajuda">Quanto de desconto em reais? ${S.admin ? '' : 'Até 10% da venda.'}</p>
      ${campoDinheiro('d-val', 'Desconto (R$)', S.desconto || '', 'autofocus')}
      <div class="linha-btns"><button class="btn btn--nao" id="d-zero">Sem desconto</button><button class="btn btn--sim" id="d-ok">Aplicar</button></div>`);
    $('#d-zero', jj).addEventListener('click', () => { S.desconto = 0; escolherPagamento(); });
    $('#d-ok', jj).addEventListener('click', () => {
      const v = num($('#d-val', jj).value);
      if (!Number.isFinite(v) || v < 0) return recado('Digite um valor válido', 'erro');
      S.desconto = r2(v); escolherPagamento();
    });
  });
}

function pagarCom(forma) {
  const t = totais();
  const bruto = ['dinheiro', 'pix'].includes(forma) ? t.vista : t.prazo;
  const total = r2(Math.max(0, bruto - (S.desconto || 0)));
  const voltar = `<button class="btn btn--nao" id="pg-voltar">Voltar</button>`;
  let corpo = '';
  if (forma === 'dinheiro') {
    const sobe = (m) => Math.ceil(total / m) * m;
    const notas = [...new Set([total, sobe(5), sobe(10), sobe(20), sobe(50), sobe(100), sobe(100) + 100].filter(v => v >= total))].slice(0, 6);
    corpo = `
      <h2>Dinheiro</h2>
      <p class="ajuda">Valor da venda</p><div class="grande-valor">${brl(total)}</div>
      <p class="ajuda" style="margin-top:14px">Quanto o cliente deu?</p>
      <div class="notas">${notas.map(v => `<button type="button" data-n="${v}">${v === total ? 'Valor certo' : brl(v)}</button>`).join('')}</div>
      ${campoDinheiro('pg-rec', 'Ou digite quanto recebeu', total, 'autofocus')}
      <div id="pg-troco"></div>
      <div class="linha-btns">${voltar}<button class="btn btn--sim" id="pg-ok">${ico('ok')} Confirmar venda</button></div>`;
  } else if (forma === 'pix') {
    corpo = `
      <h2>Pix</h2>
      <p class="ajuda">Valor da venda</p><div class="grande-valor">${brl(total)}</div>
      ${S.cfg.pix_chave ? `<p class="ajuda">Mostre este código para o cliente ler no celular.</p><div class="qr" id="pg-qr">Gerando código…</div>`
        : `<div class="aviso aviso--amarelo">A chave Pix da loja ainda não foi cadastrada. Passe a chave para o cliente.</div>`}
      <div class="aviso aviso--azul" style="margin-top:14px">Antes de confirmar, olhe no celular da loja se o Pix caiu.</div>
      <div class="linha-btns">${voltar}<button class="btn btn--sim" id="pg-ok">${ico('ok')} O Pix caiu — confirmar</button></div>`;
  } else if (forma === 'debito' || forma === 'credito') {
    corpo = `
      <h2>Cartão de ${forma === 'debito' ? 'débito' : 'crédito'}</h2>
      <p class="ajuda">Digite este valor na maquininha:</p><div class="grande-valor">${brl(total)}</div>
      <div class="aviso aviso--azul">Confirme somente depois que a maquininha aprovar.</div>
      <div class="linha-btns">${voltar}<button class="btn btn--sim" id="pg-ok">${ico('ok')} Aprovou — confirmar</button></div>`;
  } else {
    corpo = `
      <h2>Fiado</h2>
      <p class="ajuda">Valor que o cliente vai ficar devendo</p><div class="grande-valor">${brl(total)}</div>
      <h2>Para quem?</h2>
      <input class="busca" id="cli-busca" placeholder="Nome do cliente" autocomplete="off" autofocus>
      <div class="lista" id="cli-lista" style="margin:12px 0"></div>
      <button class="btn btn--cheio" id="cli-novo">${ico('mais')} Cliente novo</button>
      <label class="campo" style="margin-top:16px"><span>Quando vai pagar?</span><input id="pg-venc" type="date" value="${somaDias(hojeISO(), 30)}"></label>
      <div class="linha-btns">${voltar}<button class="btn btn--sim" id="pg-ok" disabled>${ico('ok')} Anotar fiado</button></div>`;
  }
  const j = abrirJanela(corpo);
  $('#pg-voltar', j).addEventListener('click', escolherPagamento);
  let recebido = total, cliente = null;

  if (forma === 'dinheiro') {
    const inp = $('#pg-rec', j);
    const mostra = () => {
      recebido = num(inp.value);
      const tr = r2(recebido - total);
      $('#pg-troco', j).innerHTML = !Number.isFinite(recebido) ? '' : tr < 0
        ? `<div class="aviso aviso--vermelho">Faltam ${brl(-tr)}</div>`
        : `<div class="troco"><span>Troco para devolver</span><strong>${brl(tr)}</strong></div>`;
      $('#pg-ok', j).disabled = !Number.isFinite(recebido) || tr < 0;
    };
    inp.addEventListener('input', mostra); inp.select();
    $$('[data-n]', j).forEach(b => b.addEventListener('click', () => { inp.value = String((+b.dataset.n).toFixed(2)).replace('.', ','); mostra(); }));
    mostra();
  }
  if (forma === 'pix' && S.cfg.pix_chave) {
    (async () => {
      try {
        const QR = (await import('https://esm.sh/qrcode@1.5.4')).default;
        const payload = pixPayload({ chave: S.cfg.pix_chave, nome: S.cfg.pix_nome || 'QUINTAL RACOES', cidade: S.cfg.pix_cidade || 'CHAPADAO DO SUL', valor: total, txid: 'BALCAO' + Date.now().toString().slice(-8) });
        $('#pg-qr', j).innerHTML = `<img alt="Código Pix de ${brl(total)}" src="${await QR.toDataURL(payload, { margin: 1, width: 520 })}">`;
      } catch { $('#pg-qr', j).textContent = 'Não foi possível gerar o código. Passe a chave Pix.'; }
    })();
  }
  if (forma === 'fiado') {
    const desenha = async () => {
      if (!S.clientes) S.clientes = await q(supabase.from('clientes').select('id, nome, telefone').eq('ativo', true).order('nome'));
      const t = semAcento($('#cli-busca', j).value);
      const l = S.clientes.filter(c => semAcento(c.nome).includes(t)).slice(0, 8);
      $('#cli-lista', j).innerHTML = l.map(c => `<button class="item ${cliente?.id === c.id ? 'item--verde' : ''}" data-cli="${c.id}"><span class="item__txt"><span class="item__nome">${esc(c.nome)}</span><span class="item__sub">${esc(c.telefone || 'sem telefone')}</span></span>${cliente?.id === c.id ? ico('ok') : ''}</button>`).join('')
        || `<div class="vazio">Nenhum cliente com esse nome.</div>`;
      $$('[data-cli]', j).forEach(b => b.addEventListener('click', () => { cliente = S.clientes.find(c => c.id == b.dataset.cli); $('#pg-ok', j).disabled = false; desenha(); }));
    };
    $('#cli-busca', j).addEventListener('input', desenha); desenha();
    $('#cli-novo', j).addEventListener('click', () => novoCliente((c) => { cliente = c; pagarComFiadoVolta(); }));
    const pagarComFiadoVolta = () => { pagarCom('fiado'); setTimeout(() => { const b = $(`[data-cli="${cliente.id}"]`); b?.click(); }, 300); };
  }

  $('#pg-ok', j).addEventListener('click', (e) => acao(e.currentTarget, async () => {
    const pag = { forma, valor: total };
    if (forma === 'dinheiro') pag.recebido = r2(recebido);
    const payload = {
      itens: S.venda.map(i => ({ produto_id: i.p.id, quantidade: i.qtd })),
      pagamentos: [pag], desconto: S.desconto || 0,
    };
    if (forma === 'fiado') { if (!cliente) throw new Error('Escolha o cliente'); payload.cliente_id = cliente.id; payload.vencimento_fiado = $('#pg-venc', j).value; }
    const r = await rpc('registrar_venda', { payload });
    vendaFeita(r, forma, cliente);
  }));
}

function novoCliente(depois) {
  const j = abrirJanela(`
    <h2>Cliente novo</h2>
    <label class="campo"><span>Nome</span><input id="c-nome" autocomplete="off" autofocus></label>
    <label class="campo"><span>Telefone / WhatsApp</span><input id="c-tel" inputmode="tel" autocomplete="off"></label>
    <div class="linha-btns"><button class="btn btn--nao" data-fechar>Voltar</button><button class="btn btn--sim" id="c-ok">Salvar cliente</button></div>`);
  $('#c-ok', j).addEventListener('click', (e) => acao(e.currentTarget, async () => {
    const nome = $('#c-nome', j).value.trim();
    if (nome.length < 2) throw new Error('Digite o nome do cliente');
    const c = await q(supabase.from('clientes').insert({ nome, telefone: $('#c-tel', j).value.replace(/\D/g, '') || null }).select('id, nome, telefone').single());
    S.clientes = null; recado('Cliente salvo'); depois(c);
  }));
}

function vendaFeita(r, forma, cliente) {
  const itens = S.venda.map(i => ({ ...i }));
  S.venda = []; S.desconto = 0; S.produtos = null;
  const nomes = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Cartão de débito', credito: 'Cartão de crédito', fiado: 'Fiado' };
  const j = abrirJanela(`
    <div class="feito">${ico('okc')}<h1>Venda feita</h1>
      <p style="font-size:1.2rem">Venda nº ${r.numero} · ${nomes[forma]} · <strong>${brl(r.total)}</strong></p>
      ${+r.troco > 0 ? `<div class="troco"><span>Troco</span><strong>${brl(r.troco)}</strong></div>` : ''}
      ${cliente ? `<p>Anotado para <strong>${esc(cliente.nome)}</strong>.</p>` : ''}
    </div>
    <div class="linha-btns">
      <button class="btn" id="imp">${ico('imp')} Imprimir</button>
      <button class="btn btn--sim" id="nova">Nova venda</button>
    </div>`);
  $('#imp', j).addEventListener('click', () => imprimir(r, forma, itens, cliente));
  $('#nova', j).addEventListener('click', () => { fecharJanela(); TELAS.vender(); });
}

function imprimir(r, forma, itens, cliente) {
  $('#comprovante').innerHTML = `
    <h3>QUINTAL RAÇÕES</h3>
    <div style="text-align:center">R. Corumbá, 180 · (67) 99963-8298<br>Chapadão do Sul/MS</div>
    <p>Venda nº ${r.numero} · ${new Date(r.em).toLocaleString('pt-BR')}<br>Atendente: ${esc(r.vendedor)}</p>
    <table>${(r.itens || []).map(i => `<tr><td>${esc(i.nome)}<br>${String(+i.quantidade).replace('.', ',')} × ${brl(i.preco_unit)}</td><td>${brl(i.total)}</td></tr>`).join('')}</table>
    <hr><table><tr><td><b>TOTAL</b></td><td><b>${brl(r.total)}</b></td></tr>
    <tr><td>Pagamento</td><td>${forma}</td></tr>${+r.troco > 0 ? `<tr><td>Troco</td><td>${brl(r.troco)}</td></tr>` : ''}</table>
    ${cliente ? `<p>Fiado: ${esc(cliente.nome)}</p>` : ''}
    <p style="text-align:center">Não é documento fiscal.<br>Obrigado pela preferência!</p>`;
  window.print();
}

// ============================================================
// CAIXA
// ============================================================
TELAS.caixa = async () => {
  const r = await rpc('caixa_resumo', {});
  if (!r) {
    tela.innerHTML = `
      <h1>Abrir o caixa</h1>
      <p class="ajuda">Conte o dinheiro que tem na gaveta agora (o troco do dia) e digite abaixo.</p>
      ${campoDinheiro('cx-ab', 'Dinheiro na gaveta agora', '', 'autofocus')}
      <button class="btn btn--sim btn--cheio" id="cx-abrir">${ico('ok')} Abrir o caixa</button>`;
    $('#cx-abrir').addEventListener('click', (e) => acao(e.currentTarget, async () => {
      const v = num($('#cx-ab').value);
      if (!Number.isFinite(v) || v < 0) throw new Error('Digite quanto dinheiro tem na gaveta (pode ser 0)');
      await rpc('caixa_abrir', { p_valor: v });
      recado('Caixa aberto. Boas vendas!'); TELAS.caixa();
    }));
    return;
  }
  const s = r.sessao, f = r.por_forma || {};
  tela.innerHTML = `
    <div class="aviso aviso--verde">Caixa aberto às ${hora(s.aberto_em)} por ${esc(s.aberto_por)} com ${brl(s.valor_abertura)}</div>
    <div class="placar">
      <div class="placar__box placar__box--verde"><span>Vendas de hoje</span><strong>${brl(r.vendas_total)}</strong><small>${r.vendas_qtd} ${r.vendas_qtd == 1 ? 'venda' : 'vendas'}</small></div>
      <div class="placar__box"><span>Recebido por forma</span>
        <small style="font-size:1.05rem;color:var(--ink)">Dinheiro: <b>${brl(f.dinheiro)}</b><br>Pix: <b>${brl(f.pix)}</b><br>Cartão: <b>${brl((+f.debito || 0) + (+f.credito || 0))}</b><br>Fiado: <b>${brl(f.fiado)}</b></small></div>
    </div>
    <div class="linha-btns">
      <button class="btn" id="cx-colocar">${ico('mais')} Colocar dinheiro</button>
      <button class="btn" id="cx-tirar">Tirar dinheiro</button>
    </div>
    <div class="linha-btns"><button class="btn btn--escuro btn--cheio" id="cx-fechar">Fechar o caixa</button></div>`;
  const mov = (tipo) => {
    const j = abrirJanela(`
      <h2>${tipo === 'colocar' ? 'Colocar dinheiro no caixa' : 'Tirar dinheiro do caixa'}</h2>
      ${campoDinheiro('m-val', 'Quanto?', '', 'autofocus')}
      <label class="campo"><span>Por quê?</span><input id="m-mot" autocomplete="off" placeholder="${tipo === 'colocar' ? 'Ex.: troco' : 'Ex.: depositar no banco'}"></label>
      <div class="chips">${(tipo === 'colocar' ? ['Troco', 'Dinheiro do banco'] : ['Depositar no banco', 'Pagar despesa', 'Retirada do dono']).map(t => `<button class="chip" data-m="${t}">${t}</button>`).join('')}</div>
      <div class="linha-btns"><button class="btn btn--nao" data-fechar>Voltar</button><button class="btn btn--sim" id="m-ok">Confirmar</button></div>`);
    $$('[data-m]', j).forEach(b => b.addEventListener('click', () => { $('#m-mot', j).value = b.dataset.m; }));
    $('#m-ok', j).addEventListener('click', (e) => acao(e.currentTarget, async () => {
      const v = num($('#m-val', j).value);
      if (!Number.isFinite(v) || v <= 0) throw new Error('Digite o valor');
      await rpc('caixa_movimentar', { p_tipo: tipo, p_valor: v, p_motivo: $('#m-mot', j).value.trim() });
      recado('Anotado'); TELAS.caixa();
    }));
  };
  $('#cx-colocar').addEventListener('click', () => mov('colocar'));
  $('#cx-tirar').addEventListener('click', () => mov('retirar'));
  $('#cx-fechar').addEventListener('click', () => {
    const j = abrirJanela(`
      <h2>Fechar o caixa</h2>
      <p class="ajuda">Conte todo o dinheiro da gaveta (notas e moedas) e digite o total. Não conte Pix nem cartão.</p>
      ${campoDinheiro('f-val', 'Dinheiro contado na gaveta', '', 'autofocus')}
      <label class="campo"><span>Algum recado? (opcional)</span><input id="f-obs" autocomplete="off"></label>
      <div class="linha-btns"><button class="btn btn--nao" data-fechar>Voltar</button><button class="btn btn--escuro" id="f-ok">Fechar o caixa</button></div>`);
    $('#f-ok', j).addEventListener('click', (e) => acao(e.currentTarget, async () => {
      const v = num($('#f-val', j).value);
      if (!Number.isFinite(v) || v < 0) throw new Error('Digite quanto dinheiro tem na gaveta');
      const res = await rpc('caixa_fechar', { p_contado: v, p_obs: $('#f-obs', j).value.trim() || null });
      fecharJanela(); caixaFechado(res);
    }));
  });
};

function caixaFechado(r) {
  const s = r.sessao, d = +s.diferenca, f = r.por_forma || {};
  tela.innerHTML = `
    ${d === 0 ? `<div class="aviso aviso--verde">Tudo certo. O dinheiro bate.</div>`
      : d > 0 ? `<div class="aviso aviso--amarelo">Sobrou ${brl(d)} na gaveta.</div>`
      : `<div class="aviso aviso--vermelho">Faltou ${brl(-d)} na gaveta.</div>`}
    <h2>Resumo do caixa</h2>
    <table class="contas">
      <tr><td>Abriu com</td><td>${brl(s.valor_abertura)}</td></tr>
      <tr><td>Vendas em dinheiro</td><td>${brl(f.dinheiro)}</td></tr>
      <tr><td>Recebido em dinheiro (fiado e pedidos)</td><td>${brl(r.recebimentos_dinheiro)}</td></tr>
      <tr><td>Colocou</td><td>${brl(r.colocado)}</td></tr>
      <tr class="menos"><td>Tirou</td><td>− ${brl(r.retirado)}</td></tr>
      <tr class="menos"><td>Pagou contas com o caixa</td><td>− ${brl(r.pagamentos_dinheiro)}</td></tr>
      <tr class="total"><td>Deveria ter</td><td>${brl(s.valor_esperado)}</td></tr>
      <tr class="total"><td>Você contou</td><td>${brl(s.valor_contado)}</td></tr>
    </table>
    <h2>Vendas do caixa</h2>
    <table class="contas">
      <tr><td>Dinheiro</td><td>${brl(f.dinheiro)}</td></tr><tr><td>Pix</td><td>${brl(f.pix)}</td></tr>
      <tr><td>Cartão</td><td>${brl((+f.debito || 0) + (+f.credito || 0))}</td></tr><tr><td>Fiado</td><td>${brl(f.fiado)}</td></tr>
      <tr class="total"><td>Total (${r.vendas_qtd} vendas)</td><td>${brl(r.vendas_total)}</td></tr>
    </table>
    <div class="linha-btns"><button class="btn" onclick="window.print()">${ico('imp')} Imprimir</button><a class="btn btn--sim" href="#inicio">Voltar ao início</a></div>`;
  $('#comprovante').innerHTML = `<h3>FECHAMENTO DE CAIXA</h3><p>${new Date().toLocaleString('pt-BR')}<br>${esc(s.fechado_por)}</p>
    <table><tr><td>Abertura</td><td>${brl(s.valor_abertura)}</td></tr><tr><td>Vendas dinheiro</td><td>${brl(f.dinheiro)}</td></tr>
    <tr><td>Pix</td><td>${brl(f.pix)}</td></tr><tr><td>Cartão</td><td>${brl((+f.debito || 0) + (+f.credito || 0))}</td></tr><tr><td>Fiado</td><td>${brl(f.fiado)}</td></tr>
    <tr><td>Colocou</td><td>${brl(r.colocado)}</td></tr><tr><td>Tirou</td><td>${brl(r.retirado)}</td></tr>
    <tr><td>Esperado</td><td>${brl(s.valor_esperado)}</td></tr><tr><td>Contado</td><td>${brl(s.valor_contado)}</td></tr><tr><td><b>Diferença</b></td><td><b>${brl(s.diferenca)}</b></td></tr></table>`;
}

// ============================================================
// ESTOQUE
// ============================================================
TELAS.estoque = async () => {
  await carregaProdutos(true);
  let filtro = location.hash.includes('acabando') ? 'acabando' : 'todos';
  tela.innerHTML = `
    <p class="ajuda">Toque no produto para corrigir a quantidade, anotar perda ou ver o que aconteceu.</p>
    <input class="busca" id="e-busca" type="search" placeholder="Procurar produto" autocomplete="off">
    <div class="chips" id="e-chips">
      <button class="chip" data-f="todos">Todos</button><button class="chip" data-f="acabando">Acabando</button><button class="chip" data-f="zerado">Sem estoque</button>
    </div>
    <div class="lista" id="e-lista"></div>`;
  const estado = (p) => +p.estoque <= 0 ? 'zerado' : (+p.estoque_minimo > 0 && +p.estoque <= +p.estoque_minimo) ? 'acabando' : 'ok';
  const desenha = () => {
    $$('#e-chips .chip').forEach(c => c.classList.toggle('marcado', c.dataset.f === filtro));
    let l = buscaProdutos(S.produtos, $('#e-busca').value);
    if (filtro !== 'todos') l = l.filter(p => estado(p) === filtro || (filtro === 'acabando' && estado(p) === 'zerado'));
    $('#e-lista').innerHTML = l.length ? l.map(p => {
      const st = estado(p);
      return `<button class="item ${st === 'zerado' ? 'item--vermelho' : st === 'acabando' ? 'item--amarelo' : ''}" data-p="${p.id}">
        <img src="${esc(foto(p.foto_url))}" alt="" loading="lazy">
        <span class="item__txt"><span class="item__nome">${esc(p.nome)}</span>
          <span class="item__sub">${+p.estoque_minimo > 0 ? `Avisar com ${qtdTxt(p.estoque_minimo, p.unidade)}` : 'Sem aviso de mínimo'}</span></span>
        <span class="item__valor">${qtdTxt(p.estoque, p.unidade)}<small><span class="tag-q ${st === 'zerado' ? 'tag-q--verm' : st === 'acabando' ? 'tag-q--amar' : 'tag-q--verde'}">${st === 'zerado' ? (+p.estoque < 0 ? 'Conferir' : 'Acabou') : st === 'acabando' ? 'Acabando' : 'Tem'}</span></small></span>
      </button>`;
    }).join('') : `<div class="vazio">Nada por aqui.</div>`;
  };
  $('#e-busca').addEventListener('input', desenha);
  $('#e-chips').addEventListener('click', (e) => { const c = e.target.closest('[data-f]'); if (c) { filtro = c.dataset.f; desenha(); } });
  $('#e-lista').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) produtoEstoque(S.produtos.find(p => p.id == b.dataset.p), desenha); });
  desenha();
};

function bonito(t) {
  if (t !== t.toUpperCase()) return t;
  const peq = ['de','da','do','das','dos','e','com','para'];
  return t.toLowerCase().split(' ').map((w, i) => /\d/.test(w) ? w.toUpperCase() : (i && peq.includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

async function produtoEstoque(p, redesenha) {
  const j = abrirJanela(`
    <h2>${esc(p.nome)}</h2>
    <p class="ajuda">Tem agora</p><div class="grande-valor">${qtdTxt(p.estoque, p.unidade)}</div>
    <div class="lista" style="margin-top:16px">
      <button class="btn btn--cheio" id="e-contei">Contei — corrigir a quantidade</button>
      <button class="btn btn--cheio" id="e-perda">Perdeu ou estragou</button>
      <button class="btn btn--cheio" id="e-min">Avisar quando estiver acabando</button>
    </div>
    <h2>O que aconteceu</h2><div id="e-hist" class="lista"><div class="carregando">Carregando…</div></div>
    <div class="linha-btns"><button class="btn btn--nao" data-fechar>Fechar</button></div>`);
  const atualiza = async () => { await carregaProdutos(true); redesenha(); };
  const pergunta = (titulo, ajuda, rotulo, valor, salvar) => {
    const jj = abrirJanela(`<h2>${titulo}</h2><p class="ajuda">${ajuda}</p>
      <label class="campo campo--dinheiro"><span>${rotulo} (${p.unidade === 'kg' ? 'kg' : (UN[p.unidade] || UN.un)[1]})</span><input id="e-v" inputmode="decimal" value="${valor}" autofocus></label>
      <label class="campo"><span>Motivo (opcional)</span><input id="e-mot" autocomplete="off"></label>
      <div class="linha-btns"><button class="btn btn--nao" data-fechar>Voltar</button><button class="btn btn--sim" id="e-ok">Salvar</button></div>`);
    $('#e-v', jj).select();
    $('#e-ok', jj).addEventListener('click', (e) => acao(e.currentTarget, async () => {
      const v = num($('#e-v', jj).value);
      if (!Number.isFinite(v) || v < 0) throw new Error('Digite uma quantidade válida');
      await salvar(v, $('#e-mot', jj).value.trim()); fecharJanela(); recado('Salvo'); await atualiza();
    }));
  };
  $('#e-contei', j).addEventListener('click', () => pergunta('Contei — corrigir', 'Quanto tem de verdade na loja?', 'Quantidade contada', '',
    (v, m) => rpc('ajustar_estoque', { p_produto: p.id, p_tipo: 'contagem', p_quantidade: v, p_motivo: m || 'Contagem' })));
  $('#e-perda', j).addEventListener('click', () => pergunta('Perdeu ou estragou', 'Quanto perdeu?', 'Quantidade perdida', '',
    (v, m) => rpc('ajustar_estoque', { p_produto: p.id, p_tipo: 'perda', p_quantidade: v, p_motivo: m || 'Perda' })));
  $('#e-min', j).addEventListener('click', () => pergunta('Aviso de estoque baixo', 'Com quanto o sistema deve avisar que está acabando?', 'Avisar com', String(+p.estoque_minimo || '').replace('.', ','),
    (v) => q(supabase.from('produtos').update({ estoque_minimo: v }).eq('id', p.id))));
  const TIPO = { entrada: 'Chegou', venda: 'Vendido no balcão', pedido: 'Vendido no site', cancelamento: 'Devolvido (cancelado)', ajuste: 'Ajuste', perda: 'Perda', inventario: 'Contagem', devolucao: 'Devolução' };
  try {
    const h = await q(supabase.from('estoque_movimentos').select('tipo, quantidade, saldo_apos, obs, usuario_nome, em').eq('produto_id', p.id).order('em', { ascending: false }).limit(12));
    $('#e-hist', j).innerHTML = h.length ? h.map(m => `<div class="item"><span class="item__txt"><span class="item__nome">${TIPO[m.tipo] || m.tipo}</span>
      <span class="item__sub">${new Date(m.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${esc(m.usuario_nome || '')}${m.obs ? ' · ' + esc(m.obs) : ''}</span></span>
      <span class="item__valor" style="color:${+m.quantidade < 0 ? 'var(--vermelho)' : 'var(--verde)'}">${+m.quantidade > 0 ? '+' : ''}${qtdTxt(m.quantidade, p.unidade)}<small>ficou ${qtdTxt(m.saldo_apos, p.unidade)}</small></span></div>`).join('')
      : `<div class="vazio">Nenhum movimento ainda.</div>`;
  } catch { $('#e-hist', j).innerHTML = ''; }
}

// ============================================================
// CHEGOU MERCADORIA (dono)
// ============================================================
TELAS.mercadoria = async () => {
  if (!S.admin) { location.hash = '#inicio'; return; }
  await carregaProdutos(true);
  const forns = await q(supabase.from('fornecedores').select('id, nome, cnpj, prazo_dias').eq('ativo', true).order('nome'));
  const N = { fornecedor_id: '', fornecedor: null, numero_nf: '', chave_nfe: '', emissao: '', frete: 0, desconto: 0, itens: [], dups: [] };
  tela.innerHTML = `
    <p class="ajuda">Lance aqui a nota do fornecedor. O estoque aumenta e a conta a pagar fica anotada.</p>
    <div class="grade-escolha">
      <label class="btn" style="cursor:pointer">${ico('conta')} Tenho o arquivo da nota<small>arquivo XML do e-mail</small><input type="file" id="m-xml" accept=".xml,text/xml" class="sr"></label>
      <button class="btn" id="m-digitar">${ico('mais')} Vou digitar<small>sem arquivo</small></button>
    </div>
    <div id="m-form"></div>`;
  const desenha = () => {
    const totProd = r2(N.itens.reduce((s, i) => s + r2(i.qtd * i.custo), 0));
    const total = r2(totProd + (+N.frete || 0) - (+N.desconto || 0));
    $('#m-form').innerHTML = `
      <h2>Fornecedor</h2>
      ${N.fornecedor ? `<div class="item item--verde"><span class="item__txt"><span class="item__nome">${esc(N.fornecedor.nome)}</span><span class="item__sub">${esc(N.fornecedor.cnpj || '')} ${N.fornecedor_id ? '' : '· será cadastrado'}</span></span></div>`
        : `<label class="campo"><span>Quem vendeu?</span><select id="m-forn"><option value="">Escolha o fornecedor</option>${forns.map(f => `<option value="${f.id}" ${N.fornecedor_id == f.id ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}<option value="novo">+ Fornecedor novo</option></select></label>
           <label class="campo" id="m-forn-novo" hidden><span>Nome do fornecedor novo</span><input id="m-forn-nome" autocomplete="off"></label>`}
      <label class="campo"><span>Número da nota</span><input id="m-nf" value="${esc(N.numero_nf)}" inputmode="numeric" autocomplete="off"></label>
      <h2>Produtos que chegaram</h2>
      <div class="lista" id="m-itens">${N.itens.map((i, k) => `
        <div class="item item--coluna ${i.produto ? '' : 'item--amarelo'}">
          ${i.desc ? `<div class="item__sub">Na nota: ${esc(i.desc)} — ${String(i.qtdNota).replace('.', ',')} ${esc(i.unNota || '')}</div>` : ''}
          <button class="btn btn--cheio" data-esc="${k}" style="justify-content:flex-start">${i.produto ? esc(i.produto.nome) : 'Escolher o produto'}</button>
          <div class="grade-escolha" style="grid-template-columns:1fr 1fr">
            <label class="campo" style="margin:0"><span>Quantos entram${i.produto ? ` (${i.produto.unidade === 'kg' ? 'kg' : (UN[i.produto.unidade] || UN.un)[1]})` : ''}</span><input data-qtd="${k}" inputmode="decimal" value="${String(i.qtd).replace('.', ',')}"></label>
            <label class="campo" style="margin:0"><span>Custo de cada</span><input data-custo="${k}" inputmode="decimal" value="${String(r2(i.custo).toFixed(2)).replace('.', ',')}"></label>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center"><strong>Total: ${brl(r2(i.qtd * i.custo))}</strong><button class="btn btn--nao" data-del="${k}">${ico('lixo')} Tirar</button></div>
        </div>`).join('') || '<div class="vazio">Nenhum produto ainda.</div>'}</div>
      <button class="btn btn--cheio" id="m-add" style="margin-top:12px">${ico('mais')} Adicionar produto</button>
      ${campoDinheiro('m-frete', 'Frete e impostos da nota (se tiver)', N.frete || '')}
      <table class="contas"><tr class="total"><td>Total da nota</td><td>${brl(total)}</td></tr></table>
      <h2>Como vai pagar?</h2>
      <div class="grade-escolha" id="m-pg">
        <button class="btn ${N.pg === 'prazo' ? 'marcado' : ''}" data-pg="prazo">Boleto / a prazo<small>vou pagar depois</small></button>
        <button class="btn ${N.pg === 'pago' ? 'marcado' : ''}" data-pg="pago">Já paguei<small>à vista</small></button>
      </div>
      <div id="m-pg-det"></div>
      <button class="btn btn--sim btn--cheio" id="m-ok" style="margin-top:20px">${ico('ok')} Lançar a nota</button>`;
    ligar(total);
  };
  const parcelasPadrao = (total) => {
    const forn = forns.find(f => f.id == N.fornecedor_id);
    if (N.dups.length) return N.dups.map(d => ({ ...d }));
    const n = N.nParc || 1; const prazo = forn?.prazo_dias || 28;
    return Array.from({ length: n }, (_, i) => ({ vencimento: somaDias(hojeISO(), prazo * (i + 1)), valor: i < n - 1 ? r2(total / n) : r2(total - r2(total / n) * (n - 1)) }));
  };
  const ligar = (total) => {
    $('#m-forn')?.addEventListener('change', (e) => { N.fornecedor_id = e.target.value === 'novo' ? '' : e.target.value; $('#m-forn-novo').hidden = e.target.value !== 'novo'; N.dups = []; });
    $('#m-nf').addEventListener('input', (e) => { N.numero_nf = e.target.value; });
    $('#m-frete').addEventListener('change', (e) => { N.frete = num(e.target.value) || 0; N.dups = []; guardaFornNovo(); desenha(); });
    $$('[data-qtd]').forEach(i => i.addEventListener('change', () => {
      const it = N.itens[+i.dataset.qtd]; const v = num(i.value); if (!(v > 0)) return;
      if (it.vprod) it.custo = it.vprod / v; it.qtd = v; guardaFornNovo(); desenha();
    }));
    $$('[data-custo]').forEach(i => i.addEventListener('change', () => { const it = N.itens[+i.dataset.custo]; const v = num(i.value); if (v >= 0) { it.custo = v; it.vprod = null; } guardaFornNovo(); desenha(); }));
    $$('[data-del]').forEach(b => b.addEventListener('click', () => { N.itens.splice(+b.dataset.del, 1); guardaFornNovo(); desenha(); }));
    $$('[data-esc]').forEach(b => b.addEventListener('click', () => escolherProduto(N.itens[+b.dataset.esc], () => { guardaFornNovo(); desenha(); })));
    $('#m-add').addEventListener('click', () => { const it = { produto: null, qtd: 1, custo: 0 }; N.itens.push(it); guardaFornNovo(); escolherProduto(it, desenha); });
    $$('[data-pg]').forEach(b => b.addEventListener('click', () => { N.pg = b.dataset.pg; guardaFornNovo(); desenha(); }));
    const det = $('#m-pg-det');
    if (N.pg === 'pago') {
      det.innerHTML = `<p class="ajuda" style="margin-top:14px">De onde saiu o dinheiro?</p>
        <div class="grade-escolha"><button class="btn ${N.conta === 'banco' ? 'marcado' : ''}" data-ct="banco">Banco / Pix</button><button class="btn ${N.conta === 'caixa' ? 'marcado' : ''}" data-ct="caixa">Dinheiro do caixa</button></div>`;
      $$('[data-ct]', det).forEach(b => b.addEventListener('click', () => { N.conta = b.dataset.ct; guardaFornNovo(); desenha(); }));
    } else if (N.pg === 'prazo') {
      N.parcelas = parcelasPadrao(total);
      det.innerHTML = `${N.dups.length ? '<p class="ajuda" style="margin-top:14px">Vencimentos tirados da nota:</p>' : `
        <p class="ajuda" style="margin-top:14px">Em quantas vezes?</p>
        <div class="chips">${[1, 2, 3, 4, 5, 6].map(n => `<button class="chip ${(N.nParc || 1) === n ? 'marcado' : ''}" data-np="${n}">${n}x</button>`).join('')}</div>`}
        <div class="lista">${N.parcelas.map((p, k) => `<div class="item"><span class="item__txt"><span class="item__nome">${k + 1}ª parcela</span></span>
          <input type="date" data-pv="${k}" value="${p.vencimento}" style="min-height:60px;border:3px solid var(--ink);border-radius:12px;padding:6px 10px;font-size:1.05rem">
          <span class="item__valor">${brl(p.valor)}</span></div>`).join('')}</div>`;
      $$('[data-np]', det).forEach(b => b.addEventListener('click', () => { N.nParc = +b.dataset.np; guardaFornNovo(); desenha(); }));
      $$('[data-pv]', det).forEach(i => i.addEventListener('change', () => { N.parcelas[+i.dataset.pv].vencimento = i.value; if (N.dups.length) N.dups[+i.dataset.pv].vencimento = i.value; }));
    }
    $('#m-ok').addEventListener('click', (e) => acao(e.currentTarget, async () => {
      guardaFornNovo();
      if (!N.itens.length) throw new Error('Adicione os produtos da nota');
      if (N.itens.some(i => !i.produto)) throw new Error('Tem produto sem escolher (em amarelo)');
      if (!N.fornecedor_id && !N.fornecedor?.nome) throw new Error('Escolha o fornecedor');
      if (!N.pg) throw new Error('Diga como vai pagar');
      if (N.pg === 'pago' && !N.conta) throw new Error('Diga de onde saiu o dinheiro');
      if (N.pg === 'prazo' && Math.abs(N.parcelas.reduce((s, p) => s + p.valor, 0) - total) > 0.05) throw new Error('A soma das parcelas não bate com o total da nota');
      const payload = {
        fornecedor_id: N.fornecedor_id || null, fornecedor: N.fornecedor_id ? null : N.fornecedor,
        numero_nf: N.numero_nf, chave_nfe: N.chave_nfe || null, emissao: N.emissao || null,
        frete: N.frete > 0 ? N.frete : 0, desconto: N.frete < 0 ? -N.frete : 0,
        itens: N.itens.map(i => ({ produto_id: i.produto.id, quantidade: i.qtd, custo_unit: r2(i.custo * 10000) / 10000, descricao_nf: i.desc || null })),
        pagamento: N.pg === 'pago' ? { tipo: 'pago', conta: N.conta } : { tipo: 'prazo', parcelas: N.parcelas },
      };
      const r = await rpc('lancar_entrada', { payload });
      S.produtos = null;
      abrirJanela(`<div class="feito">${ico('okc')}<h1>Nota lançada</h1><p style="font-size:1.2rem">Total ${brl(r.total)}. O estoque foi atualizado${N.pg === 'prazo' ? ' e as parcelas estão em Contas para pagar' : ''}.</p></div>
        <div class="linha-btns"><a class="btn" href="#estoque">Ver estoque</a><a class="btn btn--sim" href="#inicio">Voltar ao início</a></div>`);
    }));
  };
  const guardaFornNovo = () => {
    const nome = $('#m-forn-nome')?.value.trim();
    if ($('#m-forn')?.value === 'novo' && nome) N.fornecedor = { nome };
    const nf = $('#m-nf'); if (nf) N.numero_nf = nf.value;
  };
  $('#m-digitar').addEventListener('click', () => { N.pg = N.pg || 'prazo'; desenha(); });
  $('#m-xml').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { lerXML(await f.text(), N, forns); N.pg = N.dups.length ? 'prazo' : (N.pg || 'prazo'); desenha(); recado('Nota lida. Confira os produtos.'); }
    catch (err) { recado(msgErro(err), 'erro'); }
  });
};

function lerXML(txt, N, forns) {
  const x = new DOMParser().parseFromString(txt, 'text/xml');
  const t = (el, tag) => el?.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
  const inf = x.getElementsByTagName('infNFe')[0];
  if (!inf) throw new Error('Esse arquivo não parece ser uma nota fiscal (XML de NF-e).');
  const emit = inf.getElementsByTagName('emit')[0];
  const cnpj = t(emit, 'CNPJ') || t(emit, 'CPF');
  const forn = forns.find(f => (f.cnpj || '').replace(/\D/g, '') === cnpj);
  N.fornecedor_id = forn?.id || '';
  N.fornecedor = forn ? null : { nome: t(emit, 'xNome'), cnpj };
  if (forn) N.fornecedor = null;
  N.numero_nf = t(inf, 'nNF'); N.chave_nfe = (inf.getAttribute('Id') || '').replace(/^NFe/, '');
  N.emissao = (t(inf, 'dhEmi') || t(inf, 'dEmi')).slice(0, 10);
  const tot = inf.getElementsByTagName('ICMSTot')[0];
  const vNF = num(t(tot, 'vNF').replace('.', ','));
  const dn = (s) => parseFloat(s) || 0;
  N.itens = [...inf.getElementsByTagName('det')].map(d => {
    const p = d.getElementsByTagName('prod')[0];
    const ean = t(p, 'cEAN'); const cod = t(p, 'cProd'); const desc = t(p, 'xProd');
    const qtd = dn(t(p, 'qCom')); const vprod = dn(t(p, 'vProd')) - dn(t(p, 'vDesc'));
    const prod = acharProduto({ ean, cod, desc });
    return { produto: prod, desc, qtdNota: qtd, unNota: t(p, 'uCom'), qtd, vprod, custo: qtd ? vprod / qtd : 0, ean, cod };
  });
  const somaItens = N.itens.reduce((s, i) => s + i.vprod, 0);
  N.frete = r2((Number.isFinite(vNF) ? vNF : somaItens) - somaItens);
  N.dups = [...inf.getElementsByTagName('dup')].map(d => ({ vencimento: t(d, 'dVenc'), valor: dn(t(d, 'vDup')) })).filter(d => d.vencimento && d.valor > 0);
}

function acharProduto({ ean, cod, desc }) {
  const L = S.produtos || [];
  if (ean && !/SEM GTIN/i.test(ean)) { const p = L.find(x => x.gtin === ean); if (p) return p; }
  if (cod) { const p = L.find(x => x.sku && x.sku.toLowerCase() === cod.toLowerCase()); if (p) return p; }
  const pal = semAcento(desc).split(/\W+/).filter(w => w.length > 2);
  let melhor = null, pts = 0;
  for (const p of L) { const n = semAcento(p.nome); const s = pal.filter(w => n.includes(w)).length; if (s > pts) { pts = s; melhor = p; } }
  return pts >= Math.min(3, pal.length) ? melhor : null;
}

function escolherProduto(item, depois) {
  const j = abrirJanela(`
    <h2>Qual produto é?</h2>
    ${item.desc ? `<p class="ajuda">Na nota está: <strong>${esc(item.desc)}</strong></p>` : ''}
    <input class="busca" id="ep-b" placeholder="Procurar produto" autocomplete="off" autofocus value="${esc(item.desc ? semAcento(item.desc).split(/\W+/).filter(w => w.length > 2).slice(0, 2).join(' ') : '')}">
    <div class="lista" id="ep-l" style="margin:12px 0"></div>
    <button class="btn btn--cheio" id="ep-novo">${ico('mais')} É um produto novo — cadastrar</button>
    <div class="linha-btns"><button class="btn btn--nao" data-fechar>Voltar</button></div>`);
  const desenha = () => {
    const l = buscaProdutos(S.produtos, $('#ep-b', j).value).slice(0, 20);
    $('#ep-l', j).innerHTML = l.map(p => `<button class="item" data-id="${p.id}"><span class="item__txt"><span class="item__nome">${esc(p.nome)}</span><span class="item__sub">Tem: ${qtdTxt(p.estoque, p.unidade)}</span></span></button>`).join('') || '<div class="vazio">Nada encontrado. Tente outra palavra ou cadastre.</div>';
  };
  $('#ep-b', j).addEventListener('input', desenha); desenha();
  $('#ep-l', j).addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (!b) return; item.produto = S.produtos.find(p => p.id == b.dataset.id); fecharJanela(); depois(); });
  $('#ep-novo', j).addEventListener('click', () => {
    const jj = abrirJanela(`<h2>Produto novo</h2>
      <label class="campo"><span>Nome do produto</span><input id="pn-nome" value="${esc(bonito(item.desc || ''))}" autofocus></label>
      <p class="ajuda">Como vende?</p>
      <div class="grade-escolha" id="pn-un">${[['saco', 'Saco fechado'], ['un', 'Unidade'], ['kg', 'Por kg (granel)'], ['pacote', 'Pacote']].map(([v, t], i) => `<button class="btn ${i === 0 ? 'marcado' : ''}" data-un="${v}">${t}</button>`).join('')}</div>
      ${campoDinheiro('pn-preco', 'Preço de venda (cartão)', '')}
      ${campoDinheiro('pn-pix', 'Preço no dinheiro/Pix (se for menor)', '')}
      <div class="linha-btns"><button class="btn btn--nao" data-fechar>Voltar</button><button class="btn btn--sim" id="pn-ok">Cadastrar</button></div>`);
    let un = 'saco';
    $$('[data-un]', jj).forEach(b => b.addEventListener('click', () => { un = b.dataset.un; $$('[data-un]', jj).forEach(x => x.classList.toggle('marcado', x === b)); }));
    $('#pn-ok', jj).addEventListener('click', (e) => acao(e.currentTarget, async () => {
      const nome = $('#pn-nome', jj).value.trim(); if (nome.length < 3) throw new Error('Digite o nome');
      const preco = num($('#pn-preco', jj).value); const pix = num($('#pn-pix', jj).value);
      const novo = await q(supabase.from('produtos').insert({
        nome, unidade: un, gtin: item.ean && !/SEM GTIN/i.test(item.ean) ? item.ean : null,
        preco_normal: Number.isFinite(preco) ? preco : null, preco_pix: Number.isFinite(pix) ? pix : null,
        ativo: true, destaque: false, vende_online: false, estoque: 0, ordem: 100,
      }).select('id, nome, unidade, preco_normal, preco_pix, preco_promocional, promo_inicio, promo_fim, foto_url, gtin, sku, estoque, estoque_minimo, peso_kg, ativo').single());
      S.produtos.push(novo); item.produto = novo; fecharJanela(); recado('Produto cadastrado'); depois();
    }));
  });
}

// ============================================================
// CONTAS PARA PAGAR (dono)
// ============================================================
TELAS.pagar = async () => {
  if (!S.admin) { location.hash = '#inicio'; return; }
  const [contas, cats, forns] = await Promise.all([
    q(supabase.from('contas_pagar').select('id, descricao, parcela, total_parcelas, vencimento, valor, valor_pago, status, fornecedores(nome), categorias_financeiras(nome)').in('status', ['aberto', 'parcial']).order('vencimento').limit(300)),
    q(supabase.from('categorias_financeiras').select('id, slug, nome, tipo').eq('tipo', 'despesa').eq('ativo', true).order('ordem')),
    q(supabase.from('fornecedores').select('id, nome').eq('ativo', true).order('nome')),
  ]);
  contas.forEach(c => { c.vencimento = String(c.vencimento).slice(0, 10); });
  const hoje = hojeISO(), sete = somaDias(hoje, 7);
  const grupos = [
    ['Atrasadas', contas.filter(c => c.vencimento < hoje), 'item--vermelho'],
    ['Vence hoje', contas.filter(c => c.vencimento === hoje), 'item--amarelo'],
    ['Próximos 7 dias', contas.filter(c => c.vencimento > hoje && c.vencimento <= sete), ''],
    ['Mais para frente', contas.filter(c => c.vencimento > sete), ''],
  ];
  const resta = (c) => r2(+c.valor - +c.valor_pago);
  tela.innerHTML = `
    <button class="btn btn--mostarda btn--cheio" id="cp-nova">${ico('mais')} Anotar conta nova</button>
    ${grupos.map(([t, l, cls]) => !l.length ? '' : `
      <h2>${t} · ${brl(l.reduce((s, c) => s + resta(c), 0))}</h2>
      <div class="lista">${l.map(c => `
        <div class="item item--acao ${cls}">
          <span class="item__txt"><span class="item__nome">${esc(c.descricao)}${c.total_parcelas > 1 ? ` (${c.parcela} de ${c.total_parcelas})` : ''}</span>
            <span class="item__sub">Vence ${dataBR(c.vencimento)}${c.fornecedores?.nome ? ' · ' + esc(c.fornecedores.nome) : ''}${c.status === 'parcial' ? ' · já pagou ' + brl(c.valor_pago) : ''}</span></span>
          <span class="item__valor">${brl(resta(c))}</span>
          <button class="btn btn--sim" data-pagar="${c.id}">Paguei</button>
        </div>`).join('')}</div>`).join('') || ''}
    ${contas.length ? '' : '<div class="vazio" style="margin-top:16px">Nenhuma conta para pagar. Tudo em dia.</div>'}`;
  $$('[data-pagar]').forEach(b => b.addEventListener('click', () => {
    const c = contas.find(x => x.id == b.dataset.pagar);
    let conta = 'banco';
    const j = abrirJanela(`
      <h2>Pagar: ${esc(c.descricao)}</h2>
      ${campoDinheiro('p-val', 'Valor pago', resta(c), 'autofocus')}
      <p class="ajuda">De onde saiu o dinheiro?</p>
      <div class="grade-escolha"><button class="btn marcado" data-ct="banco">Banco / Pix</button><button class="btn" data-ct="caixa">Dinheiro do caixa</button></div>
      <label class="campo" style="margin-top:16px"><span>Dia do pagamento</span><input id="p-dia" type="date" value="${hojeISO()}"></label>
      <div class="linha-btns"><button class="btn btn--nao" data-fechar>Voltar</button><button class="btn btn--sim" id="p-ok">${ico('ok')} Confirmar pagamento</button></div>`);
    $$('[data-ct]', j).forEach(x => x.addEventListener('click', () => { conta = x.dataset.ct; $$('[data-ct]', j).forEach(y => y.classList.toggle('marcado', y === x)); }));
    $('#p-ok', j).addEventListener('click', (e) => acao(e.currentTarget, async () => {
      const v = num($('#p-val', j).value);
      if (!(v > 0)) throw new Error('Digite o valor pago');
      await rpc('pagar_conta', { p_id: c.id, p_valor: v, p_conta: conta, p_data: $('#p-dia', j).value || hojeISO() });
      recado('Pagamento anotado'); TELAS.pagar();
    }));
  }));
  $('#cp-nova').addEventListener('click', () => {
    let cat = null, modo = 'uma', vezes = 1;
    const atalhos = [['aluguel', 'Aluguel'], ['energia-agua', 'Luz, água, internet'], ['funcionarios', 'Funcionário'], ['mercadoria', 'Fornecedor'], ['impostos', 'Imposto'], ['entregas', 'Motoboy'], ['outras-despesas', 'Outra']];
    const j = abrirJanela(`
      <h2>Conta nova</h2>
      <p class="ajuda">Que tipo de conta é?</p>
      <div class="chips" id="n-cat">${atalhos.map(([s, t]) => `<button class="chip" data-cat="${s}">${t}</button>`).join('')}</div>
      <label class="campo"><span>O que é? (escreva do seu jeito)</span><input id="n-desc" autocomplete="off" placeholder="Ex.: Conta de luz"></label>
      <label class="campo" id="n-forn-box" hidden><span>Fornecedor</span><select id="n-forn"><option value="">—</option>${forns.map(f => `<option value="${f.id}">${esc(f.nome)}</option>`).join('')}</select></label>
      ${campoDinheiro('n-val', 'Valor (R$)', '')}
      <label class="campo"><span>Vence no dia</span><input id="n-venc" type="date" value="${hojeISO()}"></label>
      <p class="ajuda">Essa conta…</p>
      <div class="grade-escolha" id="n-modo">
        <button class="btn marcado" data-modo="uma">Só esta vez</button>
        <button class="btn" data-modo="mes">Repete todo mês<small>valor fixo</small></button>
        <button class="btn" data-modo="parc" style="grid-column:1/-1">É parcelada<small>o valor acima será dividido</small></button>
      </div>
      <div class="chips" id="n-vezes" hidden></div>
      <div class="linha-btns"><button class="btn btn--nao" data-fechar>Voltar</button><button class="btn btn--sim" id="n-ok">${ico('ok')} Salvar conta</button></div>`);
    $$('[data-cat]', j).forEach(b => b.addEventListener('click', () => {
      cat = cats.find(c => c.slug === b.dataset.cat); $$('[data-cat]', j).forEach(x => x.classList.toggle('marcado', x === b));
      if (!$('#n-desc', j).value) $('#n-desc', j).value = b.dataset.cat === 'outras-despesas' ? '' : b.textContent;
      $('#n-forn-box', j).hidden = b.dataset.cat !== 'mercadoria';
    }));
    const vezesOpc = () => {
      const box = $('#n-vezes', j); box.hidden = modo === 'uma';
      const ops = modo === 'mes' ? [3, 6, 12] : [2, 3, 4, 5, 6, 10, 12];
      if (!ops.includes(vezes)) vezes = ops[0];
      box.innerHTML = `<span style="width:100%;font-weight:700">${modo === 'mes' ? 'Por quantos meses?' : 'Em quantas vezes?'}</span>` + ops.map(n => `<button class="chip ${n === vezes ? 'marcado' : ''}" data-v="${n}">${n}${modo === 'mes' ? ' meses' : 'x'}</button>`).join('');
      $$('[data-v]', box).forEach(b => b.addEventListener('click', () => { vezes = +b.dataset.v; vezesOpc(); }));
    };
    $$('[data-modo]', j).forEach(b => b.addEventListener('click', () => { modo = b.dataset.modo; $$('[data-modo]', j).forEach(x => x.classList.toggle('marcado', x === b)); vezes = modo === 'uma' ? 1 : vezes; vezesOpc(); }));
    $('#n-ok', j).addEventListener('click', (e) => acao(e.currentTarget, async () => {
      const v = num($('#n-val', j).value);
      if (!$('#n-desc', j).value.trim()) throw new Error('Escreva o que é a conta');
      if (!(v > 0)) throw new Error('Digite o valor');
      await rpc('nova_conta_pagar', { payload: {
        descricao: $('#n-desc', j).value.trim(), valor: v, vencimento: $('#n-venc', j).value,
        categoria_id: cat?.id || null, fornecedor_id: $('#n-forn', j).value || null,
        parcelas: modo === 'uma' ? 1 : vezes, repetir: modo === 'mes',
      } });
      recado('Conta anotada'); TELAS.pagar();
    }));
  });
};

// ============================================================
// QUEM ME DEVE (fiado; dono também vê cartão e aplicativos)
// ============================================================
TELAS.receber = async () => {
  const lista = await q(supabase.from('contas_receber').select('id, descricao, origem, vencimento, valor, valor_recebido, status, cliente_id, clientes(nome, telefone)').in('status', ['aberto', 'parcial']).order('vencimento').limit(500));
  lista.forEach(c => { c.vencimento = String(c.vencimento).slice(0, 10); });
  const resta = (c) => r2(+c.valor - +c.valor_recebido);
  const fiado = lista.filter(c => c.origem === 'fiado');
  const outros = lista.filter(c => c.origem !== 'fiado');
  const porCli = {};
  fiado.forEach(c => { const k = c.cliente_id || 0; (porCli[k] = porCli[k] || { cli: c.clientes, contas: [] }).contas.push(c); });
  const hoje = hojeISO();
  tela.innerHTML = `
    <p class="ajuda">Toque no cliente para ver o que ele deve e anotar quando pagar.</p>
    <h2>Fiado · ${brl(fiado.reduce((s, c) => s + resta(c), 0))}</h2>
    <div class="lista">${Object.entries(porCli).map(([k, g]) => {
      const tot = g.contas.reduce((s, c) => s + resta(c), 0); const atras = g.contas.some(c => c.vencimento < hoje);
      return `<button class="item ${atras ? 'item--vermelho' : ''}" data-cli="${k}"><span class="item__txt"><span class="item__nome">${esc(g.cli?.nome || 'Sem nome')}</span>
        <span class="item__sub">${g.contas.length} ${g.contas.length === 1 ? 'compra' : 'compras'}${atras ? ' · tem atrasado' : ' · vence ' + dataBR(g.contas[0].vencimento)}</span></span>
        <span class="item__valor">${brl(tot)}</span></button>`;
    }).join('') || '<div class="vazio">Ninguém está devendo fiado.</div>'}</div>
    ${S.admin && outros.length ? `
      <h2>Cartão e aplicativos a receber · ${brl(outros.reduce((s, c) => s + resta(c), 0))}</h2>
      <p class="ajuda">Quando o dinheiro cair no banco, toque em "Caiu".</p>
      <div class="lista">${outros.map(c => `<div class="item item--acao ${c.vencimento < hoje ? 'item--amarelo' : ''}"><span class="item__txt"><span class="item__nome">${esc(c.descricao)}</span>
        <span class="item__sub">Previsto para ${dataBR(c.vencimento)}</span></span><span class="item__valor">${brl(resta(c))}</span>
        <button class="btn btn--sim" data-caiu="${c.id}">Caiu</button></div>`).join('')}</div>` : ''}`;
  $$('[data-cli]').forEach(b => b.addEventListener('click', () => {
    const g = porCli[b.dataset.cli]; const tot = g.contas.reduce((s, c) => s + resta(c), 0);
    const tel = (g.cli?.telefone || '').replace(/\D/g, '');
    const msg = `Olá, ${(g.cli?.nome || '').split(' ')[0]}! Aqui é do Quintal Rações. Passando para lembrar do valor em aberto de ${brl(tot)}. Quando puder, pode pagar na loja ou por Pix. Obrigado!`;
    const j = abrirJanela(`
      <h2>${esc(g.cli?.nome || 'Cliente')}</h2>
      <p class="ajuda">Deve no total</p><div class="grande-valor">${brl(tot)}</div>
      <div class="lista" style="margin:14px 0">${g.contas.map(c => `<div class="item ${c.vencimento < hoje ? 'item--vermelho' : ''}"><span class="item__txt"><span class="item__nome">${esc(c.descricao)}</span>
        <span class="item__sub">Vence ${dataBR(c.vencimento)}${+c.valor_recebido > 0 ? ' · já pagou ' + brl(c.valor_recebido) : ''}</span></span><span class="item__valor">${brl(resta(c))}</span></div>`).join('')}</div>
      <button class="btn btn--sim btn--cheio" id="r-pagou">${ico('ok')} O cliente pagou</button>
      ${tel ? `<a class="btn btn--cheio" style="margin-top:12px" target="_blank" rel="noopener" href="https://wa.me/55${tel}?text=${encodeURIComponent(msg)}">${ico('whats')} Lembrar pelo WhatsApp</a>` : ''}
      <div class="linha-btns"><button class="btn btn--nao" data-fechar>Fechar</button></div>`);
    $('#r-pagou', j).addEventListener('click', () => receberValor(g.contas, tot));
  }));
  $$('[data-caiu]').forEach(b => b.addEventListener('click', (e) => acao(e.currentTarget, async () => {
    const c = outros.find(x => x.id == b.dataset.caiu);
    await rpc('receber_conta', { p_id: c.id, p_valor: resta(c), p_conta: 'banco', p_data: hojeISO() });
    recado('Anotado'); TELAS.receber();
  })));
};

function receberValor(contas, tot) {
  let conta = 'caixa';
  const j = abrirJanela(`
    <h2>Quanto o cliente pagou?</h2>
    ${campoDinheiro('rv-val', 'Valor recebido', tot, 'autofocus')}
    <p class="ajuda">Como pagou?</p>
    <div class="grade-escolha"><button class="btn marcado" data-ct="caixa">Dinheiro</button><button class="btn" data-ct="banco">Pix</button></div>
    <div class="linha-btns"><button class="btn btn--nao" data-fechar>Voltar</button><button class="btn btn--sim" id="rv-ok">${ico('ok')} Confirmar</button></div>`);
  $$('[data-ct]', j).forEach(x => x.addEventListener('click', () => { conta = x.dataset.ct; $$('[data-ct]', j).forEach(y => y.classList.toggle('marcado', y === x)); }));
  $('#rv-ok', j).addEventListener('click', (e) => acao(e.currentTarget, async () => {
    let v = r2(num($('#rv-val', j).value));
    if (!(v > 0)) throw new Error('Digite o valor recebido');
    if (v > tot + 0.001) throw new Error(`O cliente deve ${brl(tot)}. Digite até esse valor.`);
    // abate das compras mais antigas primeiro
    for (const c of [...contas].sort((a, b) => a.vencimento.localeCompare(b.vencimento))) {
      if (v <= 0) break;
      const parte = Math.min(v, r2(+c.valor - +c.valor_recebido));
      await rpc('receber_conta', { p_id: c.id, p_valor: parte, p_conta: conta, p_data: hojeISO() });
      v = r2(v - parte);
    }
    recado('Pagamento anotado'); TELAS.receber();
  }));
}

// ============================================================
// COMO ESTÁ A LOJA (resumo)
// ============================================================
TELAS.resumo = async () => {
  const hoje = hojeISO(); const d = new Date();
  const ini = (y, m) => hojeISO(new Date(y, m, 1)); const fim = (y, m) => hojeISO(new Date(y, m + 1, 0));
  const seg = new Date(d); seg.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const per = {
    hoje: ['Hoje', hoje, hoje], semana: ['Esta semana', hojeISO(seg), hoje],
    mes: ['Este mês', ini(d.getFullYear(), d.getMonth()), hoje], passado: ['Mês passado', ini(d.getFullYear(), d.getMonth() - 1), fim(d.getFullYear(), d.getMonth() - 1)],
  };
  let atual = 'hoje';
  tela.innerHTML = `<div class="chips" id="rs-chips">${Object.entries(per).map(([k, v]) => `<button class="chip" data-p="${k}">${v[0]}</button>`).join('')}</div><div id="rs"></div>`;
  const desenha = async () => {
    $$('#rs-chips .chip').forEach(c => c.classList.toggle('marcado', c.dataset.p === atual));
    $('#rs').innerHTML = '<div class="carregando">Carregando…</div>';
    const [, a, b] = per[atual];
    const r = await rpc('resumo_loja', { p_ini: a, p_fim: b });
    const vendas = +r.vendas_balcao + +r.vendas_online;
    let html = `
      <div class="placar">
        <div class="placar__box placar__box--verde"><span>Vendeu</span><strong>${brl(vendas)}</strong><small>Balcão ${brl(r.vendas_balcao)} (${r.vendas_balcao_qtd}) · Site ${brl(r.vendas_online)} (${r.vendas_online_qtd})</small></div>
        <div class="placar__box"><span>Fiado em aberto</span><strong>${brl(r.fiado_aberto)}</strong><small>somando todos os clientes</small></div>
      </div>`;
    if (S.admin) {
      const desp = (r.despesas || []).reduce((s, x) => s + +x.valor, 0);
      const sobra = r2(vendas - +r.custo_mercadoria - +r.taxas - +r.entregas_custo - desp);
      html += `
        <h2>Quanto sobrou</h2>
        <table class="contas">
          <tr><td>Vendas</td><td>${brl(vendas)}</td></tr>
          <tr class="menos"><td>Custo das mercadorias vendidas</td><td>− ${brl(r.custo_mercadoria)}</td></tr>
          <tr class="menos"><td>Taxas de cartão</td><td>− ${brl(r.taxas)}</td></tr>
          <tr class="menos"><td>Entregas (motoboy)</td><td>− ${brl(r.entregas_custo)}</td></tr>
          ${(r.despesas || []).map(x => `<tr class="menos"><td>${esc(x.grupo || 'Outras')}</td><td>− ${brl(x.valor)}</td></tr>`).join('')}
          <tr class="total"><td>${sobra >= 0 ? 'Sobrou' : 'Faltou'}</td><td style="color:${sobra >= 0 ? 'var(--verde)' : 'var(--vermelho)'}">${brl(Math.abs(sobra))}</td></tr>
        </table>
        ${+r.sem_custo > 0 ? `<div class="aviso aviso--amarelo" style="margin-top:12px">${r.sem_custo} ${r.sem_custo == 1 ? 'produto vendido está' : 'produtos vendidos estão'} sem custo cadastrado. Lance as notas em "Chegou mercadoria" para a conta ficar certa.</div>` : ''}
        <h2>Dinheiro hoje</h2>
        <div class="placar">${(r.saldos || []).filter(s => s.slug !== 'maquininha').map(s => `<div class="placar__box ${+s.saldo < 0 ? 'placar__box--vermelho' : ''}"><span>${esc(s.nome)}</span><strong>${brl(s.saldo)}</strong>${s.slug === 'banco' ? '<small>movimentado pelo sistema</small>' : ''}</div>`).join('')}</div>
        <h2>Próximos 7 dias</h2>
        <div class="placar">
          <div class="placar__box placar__box--vermelho"><span>Para pagar</span><strong>${brl(+r.pagar_7dias + +r.pagar_vencido)}</strong>${+r.pagar_vencido > 0 ? `<small>${brl(r.pagar_vencido)} atrasado</small>` : ''}</div>
          <div class="placar__box placar__box--verde"><span>Para receber</span><strong>${brl(r.receber_7dias)}</strong><small>cartão, aplicativos e fiado</small></div>
        </div>`;
    }
    $('#rs').innerHTML = html;
  };
  $('#rs-chips').addEventListener('click', (e) => { const c = e.target.closest('[data-p]'); if (c) { atual = c.dataset.p; desenha(); } });
  await desenha();
};

// toda tela nova fecha a janela aberta
for (const k of Object.keys(TELAS)) { const f = TELAS[k]; TELAS[k] = async () => { fecharJanela(); return f(); }; }

// ============================================================
// Início do app
// ============================================================
(async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return telaLogin();
    const { data: perfil } = await supabase.from('perfis').select('id, nome, email, role, ativo').eq('id', session.user.id).single();
    if (!perfil || !perfil.ativo) { await supabase.auth.signOut(); return telaLogin('Seu acesso está desativado. Fale com o responsável.'); }
    S.perfil = perfil; S.admin = perfil.role === 'admin';
    const { data: cfg } = await supabase.from('config_loja').select('*').eq('id', 1).single();
    S.cfg = cfg || {};
    ir();
  } catch (e) { tela.innerHTML = `<div class="aviso aviso--vermelho">${esc(msgErro(e))}</div><button class="btn btn--cheio" onclick="location.reload()">Tentar de novo</button>`; }
})();
