-- Thư mục chứa file tĩnh của game, tương đối với thư mục game.
-- Mặc định "." (castle, rumba). tank-battle để ở public/.
update games set manifest = jsonb_set(manifest, '{game,client_dir}', '"public"'::jsonb, true)
  where id = 'tank-battle';
