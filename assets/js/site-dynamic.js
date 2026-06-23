// =====================================================
// Quintal Site — carrega dados do Supabase
// Substitui HTML estático com conteúdo do banco
// =====================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = 'https://bpoibjulaxeohwhthkid.supabase.co';
const SUPABASE_KEY = 'sb_publishable_IjM03moAsKNJUp253AaIXA_RjHvJtuN';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
function fmtBRL(v) {
  if (v === null || v === undefined || v === '') return null;
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function precoTexto(p) {
  // Verifica se promo está válida
  const hoje = new Date();
  const promoOk = p.preco_promocional && (!p.promo_inicio || new Date(p.promo_inicio) <= hoje) && (!p.promo_fim || new Date(p.promo_fim) >= hoje);
  if (promoOk) {
    return `<span style="text-decoration:line-through; opacity:.6; font-size:.85em">${fmtBRL(p.preco_normal)}</span><br><strong>${fmtBRL(p.preco_promocional)}</strong>`;
  }
  if (p.preco_pix) {
    return `a partir de <strong>${fmtBRL(p.preco_normal)}</strong>${p.unidade === 'kg' ? '/kg' : ''}<br><small style="opacity:.7">Pix ${fmtBRL(p.preco_pix)}</small>`;
  }
  if (p.preco_normal) {
    return `a partir de <strong>${fmtBRL(p.preco_normal)}</strong>${p.unidade === 'kg' ? '/kg' : ''}`;
  }
  return 'consulte preço';
}
function whatsLink(produto) {
  const txt = encodeURIComponent(`Quero saber preço de: ${produto.nome}`);
  return `https://wa.me/5567999638298?text=${txt}`;
}

(async function init() {
  try {
    // ============ CATEGORIAS ============
    const { data: cats } = await sb
      .from('categorias').select('nome, slug, icone_url')
      .eq('ativo', true).order('ordem');
    if (cats && cats.length > 0) {
      const ul = document.querySelector('.cats__list');
      if (ul) {
        ul.innerHTML = cats.map(c => `
          <li><a href="#produtos" class="cat">
            <span class="cat__img"><img src="${escapeHtml(c.icone_url || '')}" alt="${escapeHtml(c.nome)}"></span>
            <span class="cat__label">${escapeHtml(c.nome)}</span>
          </a></li>
        `).join('');
      }
    }

    // ============ BANNERS HERO ============
    const { data: banners } = await sb
      .from('banners_hero').select('titulo, foto_url, alt, link')
      .eq('ativo', true).order('ordem');
    if (banners && banners.length > 0) {
      const heroBanner = document.querySelector('.hero__banner');
      if (heroBanner) {
        const slidesHtml = banners.map((b, i) =>
          `<img src="${escapeHtml(b.foto_url)}" alt="${escapeHtml(b.alt || b.titulo)}" class="hero__slide${i === 0 ? ' is-active' : ''}" data-slide="${i}">`
        ).join('');
        const dotsHtml = banners.map((_, i) =>
          `<span class="hero__dot${i === 0 ? ' is-active' : ''}" data-go="${i}"></span>`
        ).join('');
        heroBanner.innerHTML = `${slidesHtml}<div class="hero__dots" aria-hidden="true">${dotsHtml}</div>`;
        // re-init carrossel
        initCarrossel();
      }
    }

    // ============ PRODUTOS EM DESTAQUE ============
    const { data: prods } = await sb
      .from('produtos').select('nome, descricao, foto_url, unidade, preco_normal, preco_pix, preco_promocional, promo_inicio, promo_fim, marcas(nome), categorias(nome)')
      .eq('ativo', true).eq('destaque', true)
      .order('ordem');
    if (prods && prods.length > 0) {
      const grid = document.querySelector('.grid');
      if (grid) {
        grid.innerHTML = prods.map(p => {
          const badge = p.marcas?.nome || p.categorias?.nome || '';
          return `
            <article class="card">
              <div class="card__img"><img src="${escapeHtml(p.foto_url || '')}" alt="${escapeHtml(p.nome)}" loading="lazy"></div>
              ${badge ? `<span class="card__badge">${escapeHtml(badge)}</span>` : ''}
              <h3 class="card__title">${escapeHtml(p.nome)}</h3>
              <p class="card__desc">${escapeHtml(p.descricao || '')}</p>
              <p class="card__price">${precoTexto(p)}</p>
              <a href="${whatsLink(p)}" target="_blank" rel="noopener" class="card__cta">Pedir pelo WhatsApp</a>
            </article>
          `;
        }).join('');
      }
    }

    // ============ TAGS DE MARCAS ============
    const { data: marcas } = await sb
      .from('marcas').select('nome')
      .eq('ativo', true).order('ordem');
    if (marcas && marcas.length > 0) {
      const row = document.querySelector('.brands__row');
      if (row) {
        row.innerHTML = marcas.filter(m => m.nome !== 'Linha Quintal').map(m =>
          `<span class="brands__tag">${escapeHtml(m.nome)}</span>`
        ).join('');
      }
    }
  } catch (err) {
    console.warn('[quintal] Erro carregando dados dinâmicos, fallback estático ativo:', err);
  }
})();

// Re-inicializa carrossel após substituir slides
function initCarrossel() {
  const slides = document.querySelectorAll('.hero__slide');
  const dots = document.querySelectorAll('.hero__dot');
  if (slides.length < 2) return;
  let idx = 0, timer = null;
  function go(n) {
    idx = (n + slides.length) % slides.length;
    slides.forEach((s, i) => s.classList.toggle('is-active', i === idx));
    dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
  }
  function next() { go(idx + 1); }
  function start() { stop(); timer = setInterval(next, 4500); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  dots.forEach(d => {
    d.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      go(parseInt(d.getAttribute('data-go'), 10));
      start();
    });
  });
  start();
}
