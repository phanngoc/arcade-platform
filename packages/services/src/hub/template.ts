// Bộ sinh game của Forge: template có tham số, KHÔNG chạy code người dùng.
//
// Đây là điểm khác biệt an toàn quan trọng: người chơi chỉ chọn template +
// tham số trong khoảng cho phép; server ráp ra một file index.html tự chứa.
// Không eval, không nhận mã nguồn, không đụng shell.

export type TemplateId = 'collect' | 'dodge'

export type ForgeParams = {
  title: string
  template: TemplateId
  hue: number       // 0..359 màu chủ đạo
  speed: number     // 1..5
  density: number   // 1..5
}

export const TEMPLATES: { id: TemplateId; name: string; blurb: string }[] = [
  { id: 'collect', name: 'Hứng sao', blurb: 'Di chuyển hứng sao rơi, né bom. Điểm tăng theo chuỗi hứng liên tiếp.' },
  { id: 'dodge', name: 'Né thiên thạch', blurb: 'Sống càng lâu càng nhiều điểm. Chỉ né, không hứng. Tốc độ tăng dần.' },
]

const CLAMP = (n: unknown, lo: number, hi: number, dflt: number): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : dflt
  return Math.min(hi, Math.max(lo, v))
}

/** Chuẩn hoá tham số từ body người dùng. Ném lỗi thì Forge trả 400. */
export function normalize(body: Record<string, unknown>): ForgeParams {
  const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
  if (rawTitle.length < 2 || rawTitle.length > 32) throw new Error('TITLE_LENGTH')
  if (!/^[\p{L}\p{N} '’!?.:\-]+$/u.test(rawTitle)) throw new Error('TITLE_CHARS')
  const template = body.template === 'dodge' ? 'dodge' : 'collect'
  return {
    title: rawTitle,
    template,
    hue: CLAMP(body.hue, 0, 359, 285),
    speed: CLAMP(body.speed, 1, 5, 3),
    density: CLAMP(body.density, 1, 5, 3),
  }
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Ráp index.html tự chứa. gameId dùng để gọi API platform (guest + leaderboard). */
export function render(gameId: string, p: ForgeParams): string {
  const cfg = JSON.stringify({ gameId, ...p })
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="theme-color" content="hsl(${p.hue} 60% 8%)">
<title>${esc(p.title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;overflow:hidden;background:hsl(${p.hue} 55% 7%);color:#fff;
    font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-user-select:none;user-select:none;
    touch-action:none;overscroll-behavior:none}
  #wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
  canvas{width:100%;height:100%;display:block;touch-action:none}
  #hud{position:fixed;top:calc(env(safe-area-inset-top) + 10px);left:0;right:0;display:flex;
    justify-content:space-between;padding:0 16px;font-weight:700;font-variant-numeric:tabular-nums;
    text-shadow:0 2px 8px #000a;pointer-events:none}
  #panel{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:14px;background:hsl(${p.hue} 55% 7% / .88);backdrop-filter:blur(6px);text-align:center;padding:24px}
  #panel.hide{display:none}
  h1{font-size:clamp(22px,7vw,40px);letter-spacing:.5px}
  p.sub{opacity:.75;max-width:30ch;font-size:14px}
  button{font:inherit;font-weight:700;border:0;border-radius:999px;padding:14px 30px;cursor:pointer;
    color:hsl(${p.hue} 60% 10%);background:hsl(${p.hue} 90% 62%);box-shadow:0 8px 24px hsl(${p.hue} 90% 50% / .35)}
  button:active{transform:translateY(1px)}
  ol{list-style:decimal inside;font-size:13px;opacity:.8;max-height:26vh;overflow:auto}
  .foot{position:fixed;bottom:calc(env(safe-area-inset-bottom) + 8px);width:100%;text-align:center;
    font-size:11px;opacity:.4}
</style>
</head>
<body>
<div id="wrap"><canvas id="c"></canvas></div>
<div id="hud"><span id="score">0</span><span id="best"></span></div>
<div id="panel">
  <h1>${esc(p.title)}</h1>
  <p class="sub" id="hint"></p>
  <button id="go">Chơi</button>
  <ol id="lb"></ol>
</div>
<div class="foot">tạo bằng Arcade Forge</div>
<script>
(function(){
'use strict';
var CFG = ${cfg};
var API = location.origin;
var MODE = CFG.template;
var HINT = MODE === 'collect'
  ? 'Kéo hoặc dùng ←/→ để hứng sao. Đụng bom là hết lượt.'
  : 'Kéo hoặc dùng ←/→ để né thiên thạch. Sống càng lâu điểm càng cao.';
document.getElementById('hint').textContent = HINT;

// ── platform bridge (tuỳ chọn: hỏng thì game vẫn chơi được) ───────────────
var tok = null;
fetch(API + '/v1/auth/guest', {method:'POST',headers:{'content-type':'application/json'},
  body: JSON.stringify({gameId: CFG.gameId})})
  .then(function(r){return r.ok?r.json():null}).then(function(j){ if(j) tok = j.accessToken; loadBoard(); })
  .catch(function(){});
function submitScore(s){
  if(!tok || !(s>0)) return;
  fetch(API + '/v1/leaderboard/alltime', {method:'POST',
    headers:{'content-type':'application/json','authorization':'Bearer '+tok},
    body: JSON.stringify({score: Math.trunc(s)})}).then(loadBoard).catch(function(){});
}
function loadBoard(){
  if(!tok) return;
  fetch(API + '/v1/leaderboard/alltime?limit=5',{headers:{'authorization':'Bearer '+tok}})
    .then(function(r){return r.ok?r.json():null}).then(function(j){
      if(!j||!j.entries) return;
      var ol = document.getElementById('lb'); ol.innerHTML='';
      j.entries.forEach(function(e){ var li=document.createElement('li');
        li.textContent = e.score; ol.appendChild(li); });
    }).catch(function(){});
}

// ── game ──────────────────────────────────────────────────────────────────
var c = document.getElementById('c'), x = c.getContext('2d');
var W=0,H=0,DPR=1;
function resize(){
  DPR = Math.min(devicePixelRatio||1, 2);
  W = c.clientWidth; H = c.clientHeight;
  c.width = Math.round(W*DPR); c.height = Math.round(H*DPR);
  x.setTransform(DPR,0,0,DPR,0,0);
}
addEventListener('resize', resize); addEventListener('orientationchange', resize);

var HUE = CFG.hue;
var FALL = 120 + CFG.speed*70;              // px/s ban đầu
var SPAWN = 1.05 - CFG.density*0.13;        // giây giữa 2 lần sinh
var player, items, score, best, alive, t, spawnT, streak, elapsed;
best = +(localStorage.getItem('best:'+CFG.gameId) || 0);
document.getElementById('best').textContent = best ? 'best ' + best : '';

function reset(){
  resize();
  player = {x: W/2, y: H - 70, r: Math.max(16, Math.min(W,H)*0.045)};
  items = []; score = 0; streak = 0; alive = true; spawnT = 0; elapsed = 0;
  document.getElementById('score').textContent = '0';
}
function spawn(){
  var bomb = MODE === 'dodge' ? true : Math.random() < 0.3;
  var r = Math.max(11, Math.min(W,H)*0.032);
  items.push({x: r + Math.random()*(W-2*r), y: -r, r: r, bomb: bomb,
              vy: FALL*(0.85+Math.random()*0.5)});
}
var keys = {};
addEventListener('keydown', function(e){ keys[e.key]=1;
  if(e.key===' '||e.key==='ArrowLeft'||e.key==='ArrowRight') e.preventDefault(); });
addEventListener('keyup', function(e){ keys[e.key]=0; });
var drag = null;
function px(e){ var t0 = e.touches ? e.touches[0] : e; return t0.clientX; }
c.addEventListener('pointerdown', function(e){ drag = px(e); c.setPointerCapture&&c.setPointerCapture(e.pointerId); });
c.addEventListener('pointermove', function(e){ if(drag===null) return;
  var nx = px(e); if(player) player.x += (nx - drag); drag = nx; });
addEventListener('pointerup', function(){ drag = null; });
addEventListener('pointercancel', function(){ drag = null; });

function step(dt){
  if(!alive) return;
  elapsed += dt;
  var sp = 1 + elapsed/45;                      // tăng dần độ khó
  var mv = (W*0.9)*dt;
  if(keys['ArrowLeft']||keys['a']) player.x -= mv;
  if(keys['ArrowRight']||keys['d']) player.x += mv;
  player.x = Math.max(player.r, Math.min(W-player.r, player.x));
  player.y = H - 70;

  spawnT -= dt;
  if(spawnT <= 0){ spawn(); spawnT = SPAWN/sp; }

  for(var i=items.length-1;i>=0;i--){
    var it = items[i];
    it.y += it.vy*sp*dt;
    var dx = it.x-player.x, dy = it.y-player.y;
    if(dx*dx+dy*dy < (it.r+player.r)*(it.r+player.r)){
      if(it.bomb){ die(); return; }
      streak++; score += 10 + streak*2;
      items.splice(i,1); continue;
    }
    if(it.y - it.r > H){
      if(!it.bomb && MODE==='collect'){ streak = 0; }
      items.splice(i,1);
    }
  }
  if(MODE==='dodge') score += Math.round(dt*60);
  document.getElementById('score').textContent = score;
}
function die(){
  alive = false;
  if(score > best){ best = score; localStorage.setItem('best:'+CFG.gameId, best); }
  document.getElementById('best').textContent = best ? 'best ' + best : '';
  submitScore(score);
  var pn = document.getElementById('panel');
  pn.querySelector('h1').textContent = 'Điểm ' + score;
  document.getElementById('go').textContent = 'Chơi lại';
  pn.classList.remove('hide');
}
function draw(){
  x.clearRect(0,0,W,H);
  var g = x.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'hsl('+HUE+' 55% 12%)'); g.addColorStop(1,'hsl('+((HUE+40)%360)+' 60% 6%)');
  x.fillStyle = g; x.fillRect(0,0,W,H);
  if(!player) return;
  for(var i=0;i<items.length;i++){
    var it = items[i];
    x.beginPath();
    if(it.bomb){
      x.fillStyle = 'hsl('+((HUE+180)%360)+' 85% 58%)';
      x.arc(it.x,it.y,it.r,0,6.284); x.fill();
      x.fillStyle='#0008'; x.beginPath(); x.arc(it.x,it.y,it.r*0.45,0,6.284); x.fill();
    } else {
      x.fillStyle = 'hsl('+HUE+' 95% 65%)';
      star(it.x,it.y,it.r); x.fill();
    }
  }
  x.fillStyle = '#fff';
  x.beginPath(); x.arc(player.x, player.y, player.r, Math.PI, 0); 
  x.lineTo(player.x+player.r, player.y+player.r*0.5);
  x.lineTo(player.x-player.r, player.y+player.r*0.5); x.closePath(); x.fill();
}
function star(cx,cy,r){
  x.beginPath();
  for(var i=0;i<10;i++){
    var a = -Math.PI/2 + i*Math.PI/5, rr = i%2 ? r*0.45 : r;
    var px2 = cx+Math.cos(a)*rr, py = cy+Math.sin(a)*rr;
    i ? x.lineTo(px2,py) : x.moveTo(px2,py);
  }
  x.closePath();
}
var last = 0;
function loop(ts){
  var dt = last ? Math.min((ts-last)/1000, 0.05) : 0; last = ts;
  step(dt); draw(); requestAnimationFrame(loop);
}
document.getElementById('go').addEventListener('click', function(){
  reset(); document.getElementById('panel').classList.add('hide');
});
resize(); reset(); alive = false; requestAnimationFrame(loop);
})();
</script>
</body>
</html>
`
}
