// Cliente Supabase compartilhado
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.QUINTAL_CONFIG;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Helper: redireciona pra login se não autenticado
export async function requireAuth(allowedRoles = ['admin', 'vendedor']) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/admin/login.html';
    return null;
  }

  const { data: perfil, error } = await supabase
    .from('perfis')
    .select('id, nome, email, role, ativo')
    .eq('id', session.user.id)
    .single();

  if (error || !perfil || !perfil.ativo) {
    await supabase.auth.signOut();
    window.location.href = '/admin/login.html?msg=inativo';
    return null;
  }

  if (!allowedRoles.includes(perfil.role)) {
    window.location.href = '/admin/dashboard.html?msg=sem-permissao';
    return null;
  }

  return { session, perfil };
}

// Helper: formato BRL
export const fmtBRL = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

// Helper: upload de imagem pra bucket
export async function uploadImage(bucket, file, prefix = '') {
  const ext = file.name.split('.').pop().toLowerCase();
  const filename = `${prefix}${prefix ? '-' : ''}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(filename, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
  return data.publicUrl;
}

// Helper: toast
export function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('toast--show'), 10);
  setTimeout(() => {
    el.classList.remove('toast--show');
    setTimeout(() => el.remove(), 300);
  }, 3500);
}
