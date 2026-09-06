-- 006 dùng jsonb_set('{game,client_dir}') nhưng manifest của tank-battle chưa có
-- key `game`, mà jsonb_set chỉ tạo được key CUỐI, không tạo key cha -> không ăn.
-- Gộp object thay vì set theo đường dẫn.
update games
set manifest = jsonb_set(
      coalesce(manifest, '{}'::jsonb), '{game}',
      coalesce(manifest->'game', '{}'::jsonb) || jsonb_build_object('client_dir', 'public'),
      true)
where id = 'tank-battle';
