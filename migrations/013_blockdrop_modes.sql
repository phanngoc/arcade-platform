-- Block Drop: thêm 2 bảng cho mode Sprint (40 hàng, điểm = 10_000_000 − ms) và Ultra (2 phút, điểm).
update games
   set manifest = jsonb_set(manifest, '{capabilities,leaderboard}', '["daily","alltime","sprint","ultra"]'::jsonb)
 where id = 'blockdrop';
