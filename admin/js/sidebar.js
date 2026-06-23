// Render do sidebar compartilhado
import { supabase } from '/admin/js/supabase-client.js';

export function renderSidebar(perfil, active = '') {
  const items = [
    { id: 'dashboard', href: '/admin/dashboard.html', label: 'Início', icon: '◆', roles: ['admin','vendedor'] },
    { id: 'produtos',  href: '/admin/produtos.html',  label: 'Produtos', icon: '▣', roles: ['admin','vendedor'] },
    { id: 'precos',    href: '/admin/precos.html',    label: 'Preços', icon: '$', roles: ['admin','vendedor'] },
    { id: 'banners',   href: '/admin/banners.html',   label: 'Banners',   icon: '▤', roles: ['admin'] },
    { id: 'categorias',href: '/admin/categorias.html',label: 'Categorias',icon: '⌘', roles: ['admin'] },
    { id: 'marcas',    href: '/admin/marcas.html',    label: 'Marcas',    icon: '★', roles: ['admin'] },
    { id: 'usuarios',  href: '/admin/usuarios.html',  label: 'Usuários',  icon: '☻', roles: ['admin'] },
  ];

  const visible = items.filter(it => it.roles.includes(perfil.role));

  const html = `
    <aside class="sidebar">
      <div class="sidebar__brand">QUINTAL</div>
      <ul class="sidebar__nav">
        ${visible.map(it => `
          <li><a href="${it.href}" class="${active === it.id ? 'is-active' : ''}">
            <span style="opacity:.7; width:18px; display:inline-block;">${it.icon}</span>
            <span>${it.label}</span>
          </a></li>
        `).join('')}
      </ul>
      <div class="sidebar__user">
        <strong>${perfil.nome || perfil.email}</strong>
        <small>${perfil.role === 'admin' ? 'Administrador' : 'Vendedor'}</small>
        <button id="btn-sair">Sair</button>
      </div>
    </aside>
  `;

  // Insere no início do body, antes do .main
  const container = document.createElement('div');
  container.innerHTML = html;
  const app = document.querySelector('.app');
  app.insertBefore(container.firstElementChild, app.firstElementChild);

  document.getElementById('btn-sair').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = '/admin/login.html?msg=sair';
  });
}
