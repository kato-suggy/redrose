-- Migration number: 0002
-- Placeholder services until Lorena confirms the real treatment list.
-- Deposits = 20% of price. All values obviously provisional.

INSERT INTO services (section, name, description, duration_mins, price_pence, deposit_pence, sort) VALUES
  ('brows',    'Ombré Powder Brows',       'PLACEHOLDER — soft shaded brow tattoo, includes consultation & patch test.', 120, 20000, 4000, 1),
  ('brows',    'Brow Top-Up (6–8 weeks)',  'PLACEHOLDER — perfecting session for recent brow work.',                     60, 8000, 1600, 2),
  ('lashes',   'Classic Lash Extensions',  'PLACEHOLDER — natural one-to-one lash extensions.',                          90, 12000, 2400, 1),
  ('lashes',   'Lash Lift & Tint',         'PLACEHOLDER — curl and tint your natural lashes.',                           60, 9000, 1800, 2),
  ('lips',     'Lip Blush',                'PLACEHOLDER — semi-permanent lip colour and definition.',                   150, 18000, 3600, 1),
  ('freckles', 'Faux Freckles',            'PLACEHOLDER — natural scattered freckle tattoo.',                            60, 15000, 3000, 1);
