/* arcade-bridge.js — nối game với platform Arcade (sinh bởi `arcade new`).

   Nguyên tắc: platform là BỔ SUNG, không phải phụ thuộc. Platform chết thì game
   vẫn chơi được bằng localStorage. Mọi lời gọi ở đây đều nuốt lỗi.

   Chỉ kích hoạt khi CHẮC CHẮN đang được platform phục vụ — chạy `npm run dev`,
   mở file tĩnh hay smoke test thì không phát một request nào (SDK mặc định gọi
   API ở location.origin, ngoài platform là một loạt 404 vào console):
     - đường dẫn dạng /g/<id>/...  (bundle server của platform), hoặc
     - trang tự khai window.ARCADE_BASE_URL (game gắn domain riêng). */
(function () {
  'use strict';
  var GAME_ID = window.ARCADE_GAME_ID;
  var api = null, ready = false;

  function noop() {}
  var G = window.ArcadeGame = {
    onScore: noop, syncSave: noop, top: function () { return Promise.resolve([]); },
    track: noop, ready: false, playerId: null, remote: null,
  };

  function servedByPlatform() {
    if (window.ARCADE_BASE_URL) return true;
    try { return location.pathname.indexOf('/g/') === 0; } catch (e) { return false; }
  }

  if (!window.Arcade || !GAME_ID || !servedByPlatform()) return;

  var opts = { gameId: GAME_ID };
  if (window.ARCADE_BASE_URL) opts.baseUrl = window.ARCADE_BASE_URL;

  window.Arcade.init(opts).then(function (a) {
    api = a; ready = true; G.ready = true; G.playerId = a.playerId;

    G.onScore = function (board, score, name) {
      if (!ready || typeof score !== 'number' || score <= 0) return;
      api.leaderboard(board).submit(Math.trunc(score), name).catch(noop);
    };
    G.syncSave = function (obj) {
      if (!ready) return;
      api.save.set(obj).catch(noop);        // ghi đè: game là nguồn chân lý trong phiên này
    };
    G.top = function (board, n) {
      if (!ready) return Promise.resolve([]);
      return api.leaderboard(board).top(n || 10).catch(function () { return []; });
    };
    G.track = function (n, p) { if (ready) try { api.track(n, p); } catch (e) {} };

    // Kéo save từ platform về (chơi máy khác). Game tự quyết dùng hay không.
    //
    // Có ĐUA ở đây: save.get() là mạng, còn game đăng ký __arcadeApplyRemote
    // trong module (defer, chạy sau script cổ điển này). Bên nào xong trước là
    // ngẫu nhiên. Nếu chỉ gọi callback thì lần save.get() về sớm sẽ rơi vào hư
    // không và kỷ lục cloud im lặng biến mất. Nên GIỮ LẠI doc: ai đến sau đọc.
    api.save.get().then(function (doc) {
      if (!doc || !doc.data) return;
      G.remote = doc.data;
      if (typeof window.__arcadeApplyRemote === 'function') {
        try { window.__arcadeApplyRemote(doc.data); } catch (e) {}
      }
    }).catch(noop);

    if (typeof window.__arcadeOnReady === 'function') { try { window.__arcadeOnReady(); } catch (e) {} }
  }).catch(noop);
})();
