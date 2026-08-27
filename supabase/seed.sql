-- Optional seed for a fresh Supabase project so the dashboard isn't empty
-- before the first OSM sync. Coordinates are Victoria Island, Lagos.
-- Check-ins are intentionally NOT seeded here: a venue correctly shows
-- "not enough data yet" until real people check in.
--
--   supabase db push && supabase db seed   (or paste into the SQL editor)

insert into public.venues (name, lat, lng, category, osm_id, address, source) values
  ('The Rooftop',        6.4292, 3.4229, 'bar',        'seed/1', 'Adeola Odeku St', 'seed'),
  ('Coffee Lab',         6.4287, 3.4225, 'cafe',       'seed/2', null, 'seed'),
  ('Social Club',        6.4265, 3.4240, 'club',       'seed/3', null, 'seed'),
  ('Buka & Bass',        6.4260, 3.4210, 'restaurant', 'seed/4', null, 'seed'),
  ('The Wine Room',      6.4311, 3.4248, 'bar',        'seed/5', null, 'seed'),
  ('Iroko Grill',        6.4244, 3.4182, 'restaurant', 'seed/6', null, 'seed'),
  ('The Quiet Room',     6.4319, 3.4257, 'cafe',       'seed/7', null, 'seed'),
  ('Admiralty Social',   6.4328, 3.4188, 'bar',        'seed/8', null, 'seed'),
  ('Sky Terrace',        6.4369, 3.4257, 'bar',        'seed/9', null, 'seed'),
  ('The Grind House',    6.4358, 3.4243, 'cafe',       'seed/10', null, 'seed')
on conflict (osm_id) do nothing;
