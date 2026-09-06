-- Custom domain cho từng game.
-- Cần cho việc chuyển 3 game đang live sang platform: URL hiện tại là
-- castle.bomclaw.org/ (gốc), không phải /g/castle/. Không có cột này thì phải
-- đổi URL công khai — thứ đã in trong README và người chơi đã bookmark.
alter table games add column if not exists domains text[] not null default '{}';

-- Index để tra hostname -> game trong mỗi request tĩnh.
create index if not exists games_domains on games using gin (domains);

update games set domains = array['tank.bomclaw.org']   where id = 'tank-battle';
update games set domains = array['rumba.bomclaw.org']  where id = 'rumba';
update games set domains = array['castle.bomclaw.org'] where id = 'castle';
