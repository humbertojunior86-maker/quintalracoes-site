-- ============================================================
-- QUINTAL — dados iniciais da loja online (valores de referência)
-- Todos editáveis no painel admin. Preços marcados preco_revisar=true
-- precisam ser conferidos antes de abrir a loja.
-- ============================================================

-- Zonas de entrega (loja na Rua Corumbá, 180 — Espatódia)
insert into public.zonas_entrega (nome, bairros, taxa_cliente, prazo_min, ordem)
select * from (values
  ('Espatódia e Centro',      array['Espatódia','Centro','Chapadão'],                                   5.00,  40, 1),
  ('Flamboyant e Sibipiruna', array['Flamboyant','Sibipiruna','Sucupira','Planalto','Esperança'],        7.00,  50, 2),
  ('Esplanada e Parque União',array['Esplanada','Esplanada II','Esplanada III','Parque União','Residencial Guavira'], 9.00, 60, 3),
  ('Polos Empresarial e Industrial', array['Polo Empresarial','Polo Industrial'],                        12.00, 70, 4),
  ('Zona rural (até 10 km)',  array['Zona Rural'],                                                      25.00, 120, 5)
) v(nome,bairros,taxa,prazo,ordem)
where not exists (select 1 from public.zonas_entrega);

-- Parceiros de entrega (renomear com os nomes reais)
insert into public.parceiros_entrega (nome, tipo, custo_padrao, adicional_parada, capacidade_kg, observacoes)
select * from (values
  ('Motoboy parceiro A', 'motoboy', 6.00, 3.00, 30.0, 'Pago por corrida. Até 1 saco de 15/20 kg por viagem.'),
  ('Motoboy parceiro B', 'motoboy', 7.00, 3.00, 30.0, 'Reserva nos horários de pico.'),
  ('App de entrega sob demanda', 'app', 12.00, 6.00, 60.0, 'Uber Flash / 99 Entrega / Lalamove quando disponível na cidade.'),
  ('Entrega da loja (carro)', 'proprio', 8.00, 2.00, 300.0, 'Para pedidos pesados (vários sacos, ração de produção, zona rural).')
) v(nome,tipo,custo,adic,cap,obs)
where not exists (select 1 from public.parceiros_entrega);

-- Custo por parceiro x zona
insert into public.parceiro_zona (parceiro_id, zona_id, custo, prazo_min)
select p.id, z.id,
  case p.tipo
    when 'motoboy' then (array[4,5,7,9,18])[z.ordem] + case when p.nome like '%B' then 1 else 0 end
    when 'app'     then (array[9,11,13,16,30])[z.ordem]
    else                (array[6,7,8,10,20])[z.ordem] end,
  case p.tipo
    when 'motoboy' then (array[25,30,35,45,80])[z.ordem]
    when 'app'     then (array[35,40,45,55,90])[z.ordem]
    else                (array[45,50,55,60,100])[z.ordem] end
from public.parceiros_entrega p cross join public.zonas_entrega z
on conflict do nothing;

-- Canais de venda (taxas de referência 2026 — confirmar no contrato de cada canal)
insert into public.canais_venda (slug, nome, tipo, comissao_pct, tarifa_fixa, custo_frete_medio, margem_alvo_pct, status, ordem, observacoes)
values
  ('site',          'Site Quintal',          'proprio',     0,    0,    0, 25, 'cadastrando', 1, 'Canal próprio, sem comissão. Prioridade de preço.'),
  ('aiqfome',       'aiqfome',               'delivery',    12,   0,    0, 20, 'ativo',       2, 'Loja já listada. Confirmar comissão do plano contratado.'),
  ('ifood',         'iFood (Mercado/Pet)',   'delivery',    12,   0,    0, 20, 'planejado',   3, 'Plano Básico com entrega própria ~12%; com entregador iFood ~23%. Confirmar.'),
  ('mercado-livre', 'Mercado Livre',         'marketplace', 14,   6,   0, 18, 'planejado',   4, 'Clássico 11–14% / Premium +5 p.p.; tarifa fixa R$ 5,50–6,00 abaixo de R$ 79.'),
  ('shopee',        'Shopee',                'marketplace', 20,   4.5,  0, 18, 'planejado',   5, 'Até R$ 79,99: 20% + R$ 4,50. Acima: 14% + R$ 16–26 (desde 01/10/2026).'),
  ('amazon',        'Amazon',                'marketplace', 12,   0,   0, 18, 'planejado',   6, 'Pet Shop 10–15% conforme categoria.'),
  ('magalu',        'Magalu',                'marketplace', 16,   5,   0, 18, 'planejado',   7, '16–19,9% + R$ 5,00 por item.')
on conflict (slug) do nothing;

-- Produtos de teste (fora dos destaques da home; preço de referência)
insert into public.produtos (nome, slug, descricao, categoria_id, marca_id, foto_url, unidade, preco_normal, preco_pix, peso_kg, sku, destaque, ativo, vende_online, preco_revisar, ordem)
select v.nome, v.slug, v.descr, c.id, m.id, v.foto, v.un, v.pn, v.pp, v.peso, v.sku, false, true, true, v.rev, v.ord
from (values
  ('Special Dog Plus Premium Carne 20kg', 'special-dog-plus-carne-20kg', 'Ração premium para cães adultos, sabor carne. Saco fechado 20 kg.', 'caes', null, '/assets/categorias/cat_cao.png', 'saco', 179.90, 172.90, 20.0, 'QR-SDP-20', false, 10),
  ('Golden Special Cães Filhotes 15kg', 'golden-special-filhotes-15kg', 'Frango e carne. Para filhotes de todas as raças.', 'caes', 'golden', '/assets/produtos/golden.png', 'saco', 189.90, 179.90, 15.0, 'QR-GSF-15', true, 11),
  ('Golden Fórmula Cães Adultos — a granel', 'golden-formula-adultos-kg', 'Pesada na hora, na quantidade que você precisar.', 'caes', 'golden', '/assets/produtos/golden.png', 'kg', 21.90, 20.50, 1.0, 'QR-GFA-KG', true, 12),
  ('Premier Fórmula Cães Adultos Raças Médias 15kg', 'premier-formula-racas-medias-15kg', 'Super premium, frango.', 'caes', 'premier', '/assets/produtos/premier.png', 'saco', 289.90, 279.90, 15.0, 'QR-PFM-15', true, 13),
  ('Besser Natural Cães Adultos 15kg', 'besser-natural-adultos-15kg', 'Premium natural, sem corantes.', 'caes', null, '/assets/categorias/cat_cao.png', 'saco', 149.90, 142.90, 15.0, 'QR-BES-15', true, 14),
  ('Finotrato Prime Cães Adultos 15kg', 'finotrato-prime-adultos-15kg', 'Premium especial para cães adultos.', 'caes', null, '/assets/categorias/cat_cao.png', 'saco', 139.90, 132.90, 15.0, 'QR-FIN-15', true, 15),
  ('Special Cat Ultralife 1kg', 'special-cat-ultralife-1kg', 'Ração premium para gatos adultos.', 'gatos', null, '/assets/categorias/cat_gato.png', 'un', 22.90, 21.50, 1.0, 'QR-SCU-1', true, 16),
  ('Golden Gatos Castrados Frango 10,1kg', 'golden-gatos-castrados-10kg', 'Controle de peso para gatos castrados.', 'gatos', 'golden', '/assets/produtos/golden.png', 'saco', 199.90, 189.90, 10.1, 'QR-GGC-10', true, 17),
  ('Simparic 20,1 a 40kg — 1 comprimido', 'simparic-20-40kg-1cp', 'Antipulgas e carrapatos, proteção de 35 dias.', 'caes', null, '/assets/produtos/medicamentos.webp', 'un', 99.90, 94.90, 0.05, 'QR-SIM-40', true, 18),
  ('NexGard 10,1 a 25kg — 1 tablete', 'nexgard-10-25kg-1tab', 'Antipulgas e carrapatos mastigável, 30 dias.', 'caes', null, '/assets/produtos/medicamentos.webp', 'un', 79.90, 75.90, 0.05, 'QR-NEX-25', true, 19),
  ('Comigo Postura Galinhas 25kg', 'comigo-postura-25kg', 'Ração para aves de postura.', 'galinhas', 'comigo', '/assets/produtos/comigo.jpg', 'saco', 109.90, 104.90, 25.0, 'QR-CPO-25', true, 20),
  ('Petisco bifinho sabor carne 500g', 'bifinho-carne-500g', 'Petisco para cães, pacote 500 g.', 'caes', null, '/assets/produtos/snacks.jpg', 'un', 19.90, 18.90, 0.5, 'QR-BIF-500', true, 21)
) v(nome,slug,descr,cat,marca,foto,un,pn,pp,peso,sku,rev,ord)
left join public.categorias c on c.slug = v.cat
left join public.marcas m on m.slug = v.marca
on conflict (slug) do nothing;
