'use strict';

// Use Matter.js for physics simulation only.
// Custom canvas render loop reads body positions/angles from engine each frame.
// Do NOT use MatterRender or MatterRunner.
const { Engine, World, Bodies, Body, Query } = Matter;

// ── Data ──────────────────────────────────────────────────────────────────────

const HOOKS = [
  'Free shipping', 'Shop now', 'Limited offer', 'New drop',
  'Best seller', "Don't miss", 'Last chance', 'Trending',
  'Just dropped', 'Hot pick', 'Flash sale', 'Sold out soon',
];

const BRANDS = [
  { handle: 'bobby',       display: 'bobby',    init: 'B', color: '#7c5cfc',
    images: ['images/bobby/1.jpg','images/bobby/2.jpg','images/bobby/3.jpg','images/bobby/4.jpg','images/bobby/5.jpg'] },
  { handle: 'jansz',       display: 'yalumba',  init: 'Y', color: '#ff6b6b',
    images: ['images/jansz/1.jpg','images/jansz/2.jpg','images/jansz/3.jpg','images/jansz/4.jpg'] },
  { handle: 'noissue',     display: 'noissue',  init: 'N', color: '#ffa94d',
    images: ['images/noissue/1.jpg','images/noissue/2.jpg','images/noissue/3.jpg','images/noissue/4.jpg'] },
  { handle: 'henne',       display: 'henne',    init: 'H', color: '#4ecdc4',
    images: ['images/henne/1.jpg','images/henne/2.jpg','images/henne/3.jpg','images/henne/4.jpg'] },
  { handle: 'olssons',     display: 'Olssons',  init: 'O', color: '#45b7d1',
    images: [] },
  { handle: 'epicurem',    display: 'epicurem', init: 'E', color: '#f783ac',
    images: [] },
  { handle: 'brooks',      display: 'brooks',   init: 'B', color: '#a9e34b',
    images: ['images/brooks/1.jpg','images/brooks/2.jpg','images/brooks/3.jpg','images/brooks/4.jpg'] },
  { handle: 'mochiehealth',display: 'Mochi',    init: 'M', color: '#00c48c',
    images: ['images/mochiehealth/1.jpg','images/mochiehealth/2.jpg','images/mochiehealth/3.jpg','images/mochiehealth/4.jpg'] },
];

// Preloaded image cache: path → HTMLImageElement
const LOADED_IMGS = new Map();

function preloadAllImages() {
  for (const brand of BRANDS) {
    for (const path of brand.images) {
      if (!LOADED_IMGS.has(path)) {
        const img = new Image();
        img.src = path;
        LOADED_IMGS.set(path, img);
      }
    }
  }
}

// ── Physics + game constants ───────────────────────────────────────────────────

let AD_W             = 188;   // set dynamically in newGame()
let AD_H             = 265;   // header + square image + footer
const GRAVITY        = 1.0;
const FRICTION       = 0.8;
const RESTITUTION    = 0.05;
const AIR_FRICTION   = 0.03;
const FATIGUE_RATE   = 3.5;   // %/sec base (+25%)
const SPAWN_BASE     = 1800;  // ms between spawns (base)
const DAY_DURATION   = 25000; // ms per day
const SPEED_RAMP     = 0.18;
const ROAS_DAMAGE    = 12;
const PTS_BASE       = 10;
const PTS_EARLY      = 20;
const GAMEOVER_FRAC  = 0.18;  // pile reaching top 18% = game over

// ── Globals ───────────────────────────────────────────────────────────────────

let engine, phyWorld;
let canvas, ctx, containerEl;
let G;        // game state
let rafId;

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  containerEl = document.getElementById('game-container');
  canvas      = document.getElementById('game-canvas');
  ctx         = canvas.getContext('2d');

  preloadAllImages();

  document.getElementById('start-btn').addEventListener('click', newGame);
  document.getElementById('retry-btn').addEventListener('click', newGame);
  document.getElementById('linkedin-btn').addEventListener('click', shareToLinkedIn);
  canvas.addEventListener('click', onCanvasClick);
});

// ── New game ──────────────────────────────────────────────────────────────────

function newGame() {
  if (rafId) cancelAnimationFrame(rafId);

  showScreen('game-screen');

  // Match canvas pixels to container layout size
  canvas.width  = containerEl.offsetWidth;
  canvas.height = containerEl.offsetHeight;

  // Responsive card size — target ~4 cards per row, cap at desktop size
  AD_W = Math.round(Math.min(188, canvas.width / 4.2));
  AD_H = Math.round(AD_W * (265 / 188));

  // Remove any leftover DOM overlays
  containerEl.querySelectorAll('.float, .day-banner').forEach(e => e.remove());

  // Fresh physics world
  engine   = Engine.create({ gravity: { y: GRAVITY } });
  phyWorld = engine.world;

  const W = canvas.width, H = canvas.height;
  World.add(phyWorld, [
    // Ground
    Bodies.rectangle(W / 2, H + 25,   W + 200, 50,  { isStatic: true }),
    // Left wall
    Bodies.rectangle(-25,   H / 2,    50, H + 100,  { isStatic: true }),
    // Right wall
    Bodies.rectangle(W + 25, H / 2,   50, H + 100,  { isStatic: true }),
  ]);

  G = {
    day:          1,
    score:        0,
    refreshed:    0,
    died:         0,
    roas:         100,
    ads:          new Map(),    // Matter body.id → body
    speed:        1,
    fatigueMulti: 1,           // increases each time any ad is refreshed
    dayMs:        0,
    spawnMs:      SPAWN_BASE,   // fire on first frame
    prevTs:       null,
    over:         false,
  };

  updateHUD();
  rafId = requestAnimationFrame(loop);
}

// ── Main loop ─────────────────────────────────────────────────────────────────

function loop(ts) {
  if (G.over) return;
  if (!G.prevTs) G.prevTs = ts;
  const dt = Math.min((ts - G.prevTs) / 1000, 0.1);
  G.prevTs = ts;

  // Fixed-timestep physics step (16.67ms = 60fps)
  Engine.update(engine, 1000 / 60);

  update(dt, ts);
  render(ts);

  rafId = requestAnimationFrame(loop);
}

// ── Update ────────────────────────────────────────────────────────────────────

function update(dt, ts) {
  const ms = dt * 1000;

  // Day progression
  G.dayMs += ms;
  if (G.dayMs >= DAY_DURATION) {
    G.dayMs -= DAY_DURATION;
    G.day++;
    G.speed = 1 + (G.day - 1) * SPEED_RAMP;
    showDayBanner(G.day);
  }

  // Spawn
  G.spawnMs += ms;
  const interval = SPAWN_BASE / G.speed;
  while (G.spawnMs >= interval) {
    G.spawnMs -= interval;
    spawnAd(ts);
  }

  // Drain fatigue on all settled-ish ads
  const dead = [];
  for (const [id, body] of G.ads) {
    const ad = body.adData;
    if (ad.dying) continue;
    // Give each card ~1.2s to fall before draining starts
    if (ts - ad.spawnTs > 1200) {
      ad.fatigue -= FATIGUE_RATE * G.speed * G.fatigueMulti * dt;
      if (ad.fatigue <= 0) dead.push(id);
    }
  }
  dead.forEach(killAd);

  // Game over: a SETTLED body (speed < 1.5 px/step) has its center
  // above the danger line. Falling bodies have much higher speed so
  // they never false-trigger, regardless of frame rate.
  const limit = canvas.height * GAMEOVER_FRAC;
  for (const [, body] of G.ads) {
    if (!body.adData.dying && body.speed < 1.5 && body.position.y < limit) {
      gameOver(); return;
    }
  }

  if (G.roas <= 0) { gameOver(); return; }

  updateHUD();
}

// ── Spawn ─────────────────────────────────────────────────────────────────────

function spawnAd(ts) {
  const margin = AD_W / 2 + 10;
  const x      = margin + Math.random() * (canvas.width - 2 * margin);
  const angle  = (Math.random() - 0.5) * (Math.PI / 6); // ±15°

  const body = Bodies.rectangle(x, -AD_H / 2 - 10, AD_W, AD_H, {
    friction:    FRICTION,
    restitution: RESTITUTION,
    frictionAir: AIR_FRICTION,
    angle,
    label: 'ad',
  });

  // Gentle sideways drift + slow fall
  Body.setVelocity(body, {
    x: (Math.random() - 0.5) * 2,
    y: 2,
  });

  const brand = pick(BRANDS);
  body.adData = {
    hook:    pick(HOOKS),
    brand,
    imgIdx:  brand.images.length > 0 ? randInt(0, brand.images.length - 1) : 0,
    type:    Math.random() < 0.5 ? 'ig' : 'fb',
    likes:   randInt(100, 9900),
    fatigue: 100,
    dying:   false,
    flash:   0,
    spawnTs: ts,
  };

  World.add(phyWorld, body);
  G.ads.set(body.id, body);
}

// ── Kill / refresh ────────────────────────────────────────────────────────────

function killAd(id) {
  const body = G.ads.get(id);
  if (!body || body.adData.dying) return;

  body.adData.dying   = true;
  body.adData.dyingTs = performance.now();
  G.died++;
  G.roas = Math.max(0, G.roas - ROAS_DAMAGE);

  floatText(body.position.x, body.position.y, `-${ROAS_DAMAGE} ROAS`, 'red');

  setTimeout(() => {
    World.remove(phyWorld, body);
    G.ads.delete(id);
  }, 500);
}

function refreshAd(id) {
  const body = G.ads.get(id);
  if (!body || body.adData.dying) return;

  const pts = PTS_BASE + (body.adData.fatigue > 60 ? PTS_EARLY : 0);
  G.score        += pts;
  G.refreshed++;
  G.fatigueMulti  = 1 + G.refreshed * 0.08; // +8% faster per refresh

  let h;
  do { h = pick(HOOKS); } while (h === body.adData.hook);
  body.adData.hook    = h;
  body.adData.imgIdx  = (body.adData.imgIdx + 1) % body.adData.brand.images.length;
  body.adData.fatigue = 100;
  body.adData.flash   = performance.now();

  floatText(body.position.x, body.position.y - 20, `+${pts}`, 'green');
}

// ── Click detection ───────────────────────────────────────────────────────────

function onCanvasClick(e) {
  if (!G || G.over) return;
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx     = (e.clientX - rect.left) * scaleX;
  const my     = (e.clientY - rect.top)  * scaleY;

  const hits = Query.point(Array.from(G.ads.values()), { x: mx, y: my });
  if (!hits.length) return;

  // Top-most hit
  const body = hits[hits.length - 1];
  if (body.adData && !body.adData.dying) refreshAd(body.id);
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(ts) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Subtle danger-zone line
  const dangerY = canvas.height * GAMEOVER_FRAC;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,86,133,0.18)';
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, dangerY);
  ctx.lineTo(canvas.width, dangerY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  for (const [, body] of G.ads) {
    drawCard(body);
  }
}

// ── Draw a single card at body position + angle ───────────────────────────────

function drawCard(body) {
  const { x, y } = body.position;
  const ad = body.adData;
  const hw = AD_W / 2, hh = AD_H / 2;
  const s  = AD_W / 188; // scale factor relative to design size
  const now = performance.now();

  const flashAge = now - (ad.flash || 0);
  const isFlash  = flashAge < 280;
  const dyingAge = ad.dying ? now - ad.dyingTs : 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(body.angle);

  if (ad.dying) ctx.globalAlpha = Math.max(0, 1 - dyingAge / 500);

  // ── Background ──
  ctx.fillStyle = ad.dying   ? '#1e0808' :
                  isFlash    ? '#12201a' :
                  ad.type === 'ig' ? '#1c1c1e' : '#1e1e24';
  roundRect(ctx, -hw, -hh, AD_W, AD_H, 10 * s);
  ctx.fill();

  // ── Border ──
  ctx.strokeStyle = isFlash  ? 'rgba(178,254,21,0.7)' :
                    ad.dying ? 'rgba(255,86,133,0.35)' :
                               'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── Avatar circle ──
  ctx.fillStyle = ad.brand.color;
  ctx.beginPath();
  ctx.arc(-hw + 16*s, -hh + 16*s, 11*s, 0, Math.PI * 2);
  ctx.fill();

  // Instagram ring
  if (ad.type === 'ig') {
    ctx.strokeStyle = '#c13584';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(-hw + 16*s, -hh + 16*s, 14*s, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Initial letter
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(7, Math.round(10*s))}px system-ui,sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ad.brand.init, -hw + 16*s, -hh + 16*s);

  // Brand name
  ctx.fillStyle = ad.dying ? '#555' : '#e8e8e8';
  ctx.font = `bold ${Math.max(7, Math.round(10*s))}px system-ui,sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const name = ad.type === 'ig' ? ad.brand.handle : ad.brand.display;
  ctx.fillText(name, -hw + 34*s, -hh + 14*s);

  // Sponsored
  ctx.fillStyle = '#555';
  ctx.font = `${Math.max(6, Math.round(9*s))}px system-ui,sans-serif`;
  ctx.fillText('Sponsored', -hw + 34*s, -hh + 27*s);

  // ── Photo strip (square) ──
  const STRIP_Y = -hh + 38*s, STRIP_H = AD_W;
  const imgPath = ad.brand.images[ad.imgIdx];
  const img     = LOADED_IMGS.get(imgPath);
  if (img && img.complete && img.naturalWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-hw, STRIP_Y, AD_W, STRIP_H);
    ctx.clip();
    const imgScale = Math.max(AD_W / img.naturalWidth, STRIP_H / img.naturalHeight);
    const dw = img.naturalWidth  * imgScale;
    const dh = img.naturalHeight * imgScale;
    ctx.drawImage(img, -hw + (AD_W - dw) / 2, STRIP_Y + (STRIP_H - dh) / 2, dw, dh);
    if (ad.dying) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(-hw, STRIP_Y, AD_W, STRIP_H);
    }
    ctx.restore();
  } else {
    ctx.fillStyle = ad.dying ? '#111' : ad.brand.color;
    ctx.fillRect(-hw, STRIP_Y, AD_W, STRIP_H);
  }

  // ── Hook text ──
  ctx.fillStyle = ad.dying   ? '#444'    :
                  isFlash    ? '#b2fe15' : '#e0e0e0';
  ctx.font = `bold ${Math.max(7, Math.round(10*s))}px system-ui,sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  let hook = ad.hook.toUpperCase();
  const maxW = AD_W - 20*s;
  while (hook.length > 1 && ctx.measureText(hook).width > maxW) {
    hook = hook.slice(0, -1);
  }
  ctx.fillText(hook, -hw + 10*s, -hh + 38*s + AD_W + 14*s);

  // ── FB: Shop Now  /  IG: likes ──
  if (ad.type === 'fb') {
    ctx.fillStyle = '#2e2e38';
    roundRect(ctx, hw - 72*s, hh - 25*s, 62*s, 17*s, 4*s);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.fillStyle = '#bbb';
    ctx.font = `${Math.max(6, Math.round(8*s))}px system-ui,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Shop Now', hw - 41*s, hh - 17*s);
  } else {
    const lk = ad.likes > 999
      ? '♡ ' + (ad.likes / 1000).toFixed(1) + 'K likes'
      : '♡ ' + ad.likes + ' likes';
    ctx.fillStyle = '#777';
    ctx.font = `${Math.max(6, Math.round(9*s))}px system-ui,sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(lk, -hw + 10*s, -hh + 38*s + AD_W + 27*s);
  }

  // ── Fatigue bar ──
  if (!ad.dying) {
    const pct = Math.max(0, ad.fatigue) / 100;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(-hw, hh - 5*s, AD_W, 5*s);
    ctx.fillStyle = pct < 0.25 ? '#ff5685' : pct < 0.55 ? '#ffa94d' : '#b2fe15';
    ctx.fillRect(-hw, hh - 5*s, AD_W * pct, 5*s);
  }

  ctx.restore();
}

// ── Canvas helpers ────────────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

// ── DOM overlays (float text, day banners) ────────────────────────────────────

function floatText(cx, cy, text, type) {
  const el = document.createElement('div');
  el.className = `float float-${type}`;
  el.textContent = text;
  el.style.left = cx + 'px';
  el.style.top  = cy + 'px';
  containerEl.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

const DAY_MSGS = [
  '📸 photographer just cancelled',
  '📂 Dropbox link expired',
  '🎨 designer went MIA',
  '🤳 creator ghosted us',
  '🔁 same ad, day 47',
  '😴 audience falling asleep',
  '📉 CTR hits the floor',
  '🧟 zombie creative detected',
  '💸 budget still burning',
  '🖼️ art director on vacation',
  '🤡 intern approved the brief',
  '🔥 brand guidelines? never heard of em',
  '📝 copy deck in 12 revision hell',
  '🎬 video editor MIA since Tuesday',
  '🧨 campaign going nowhere fast',
  '🕳️ creative fell into a black hole',
  '📧 "can you just reuse last month\'s?"',
  '🤦 client wants more stock photos',
];

function showDayBanner(day) {
  const el = document.createElement('div');
  el.className = 'day-banner';
  el.textContent = DAY_MSGS[(day - 2) % DAY_MSGS.length];
  containerEl.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// ── Utility ───────────────────────────────────────────────────────────────────

function pick(arr)          { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max)  { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ── HUD / Screens ─────────────────────────────────────────────────────────────

function updateHUD() {
  document.getElementById('hud-day').textContent     = G.day;
  document.getElementById('hud-score').textContent   = G.score.toLocaleString();
  document.getElementById('hud-ref').textContent     = G.refreshed;
  document.getElementById('hud-died').textContent    = G.died;

  const r = Math.max(0, G.roas);
  document.getElementById('hud-roas-val').textContent = Math.ceil(r);
  const fill = document.getElementById('roas-fill');
  fill.style.width      = r + '%';
  fill.style.background = r < 30 ? '#ff5685' : r < 60 ? '#ffa94d' : '#b2fe15';
}

function gameOver() {
  G.over = true;
  cancelAnimationFrame(rafId);
  document.getElementById('go-days').textContent = G.day;
  document.getElementById('go-ref').textContent  = G.refreshed;
  setTimeout(() => showScreen('gameover-screen'), 500);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function shareToLinkedIn() {
  const days = G ? G.day : 0;
  const refreshed = G ? G.refreshed : 0;
  const text = `I just played the Ad Fatigue Simulator — survived ${days} day${days !== 1 ? 's' : ''} and refreshed ${refreshed} ads before my campaign died. 😅\n\nTry to beat my score 👇\nhttps://cuttable.com\n\nBuilt by Will Gerard using AI × @cuttable`;
  const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent('https://cuttable.com')}&summary=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener,width=600,height=600');
}
