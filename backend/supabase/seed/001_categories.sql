-- =============================================================================
-- Seed: categories
-- Idempotent - safe to re-run after schema changes.
-- =============================================================================

insert into public.categories (id, label_en, label_ms, label_zh, default_pao_months, icon, sort_order) values
  ('medicine',   'Medicine',          'Ubat',              '药品',   null, 'pill',      10),
  ('supplement', 'Supplement',        'Suplemen',          '保健品', null, 'capsule',   20),
  ('skincare',   'Skincare',          'Penjagaan Kulit',   '护肤品', 12,   'droplet',   30),
  ('cosmetic',   'Cosmetics',         'Kosmetik',          '化妆品', 12,   'sparkles',  40),
  ('food',       'Food',              'Makanan',           '食品',   null, 'apple',     50),
  ('aerosol',    'Aerosol / Spray',   'Aerosol / Semburan','喷雾',   null, 'spray',     60),
  ('household',  'Household Product', 'Produk Rumah',      '家用品', null, 'home',      70)
on conflict (id) do update set
  label_en           = excluded.label_en,
  label_ms           = excluded.label_ms,
  label_zh           = excluded.label_zh,
  default_pao_months = excluded.default_pao_months,
  icon               = excluded.icon,
  sort_order         = excluded.sort_order;
