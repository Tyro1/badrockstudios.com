'use strict';

/*
 * Everything marked data-break on this page is a resource node, as on an island:
 * hit it, it squashes and cracks and its health bar drops; break it, it flies apart,
 * drops gold and grows back a few seconds later. Links never break - they go somewhere.
 * The gold buys looks in the shop: swing tools, trails behind the cursor, the lagoon's
 * colour and friends who walk along the bottom of the screen.
 *
 * One requestAnimationFrame loop drives all of it (the pointer, the swing, every node's
 * squash, every flying chip, the gulls and the walkers), the same way the game runs its
 * effects from one place rather than one timer per thing. Everything that flies is drawn
 * on one canvas: a break used to make a hundred elements, each on its own layer, in the
 * one frame the page could least afford them.
 */

// ---------- tuning, taken from the game where the game has an answer ----------
const TOOL_W = 132;            // one swing frame, the game's 44x24 cut at 3x
const TOOL_FRAMES = 8;
const TOOL_FPS = 32;           // eight frames in the quarter second a held click waits
const STRIKE_FRAME = 2;        // a blow starts on the arc, not on the wind-up
const ANCHOR_X = 42;           // where the head lands in the frame: (14, 20) at 3x
const ANCHOR_Y = 60;
const HOLD_INTERVAL = 0.25;    // a held click strikes again every quarter second
const BEND_SECONDS = 0.05;     // the pointer's finger folding into a click
const PRESSED_HOLD = 0.07;     // and staying down long enough for a tap to be seen
const CRIT_CHANCE = 0.12;
const RESPAWN_SECONDS = 9;
const SQUASH_SECONDS = 0.18;
const FLASH_SECONDS = 0.06;
const GRAVITY = 2200;
const MAGNET_RADIUS = 170;
const ART_PX = 4;              // one art pixel at the page's chunky scale

// the title screen's lagoon (TitleScreenView), at four page pixels to a texel
const GULL_SPEED = 44;         // 11 texels a second
const GULL_SPREAD = 0.3;       // each gull a little faster than the one before it
const GULL_FLAPS = 3.5;        // wing beats a second
const GLINT_DRIFT = 12;        // 3 texels a second
const GLINT_SLOW = 0.6;        // every other glint drifts at this share
const GLINT_BLINK = 2.2;
const PET_FPS = 8;

const INK = '#2d2832';
const RAINBOW = ['#f05a5a', '#ff9f43', '#ffcb40', '#5cc14a', '#4ea5fa', '#9b6bff', '#ff7ac8'];

const finePointer = matchMedia('(pointer: fine)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const fx = document.querySelector('.fx');
const fxCtx = fx.getContext('2d');
const tool = document.querySelector('.tool');
const main = document.querySelector('main');
const goldLabel = document.getElementById('gold');
const purse = document.querySelector('.purse');
const purseIcon = purse.querySelector('img');
const hint = document.getElementById('hint');
const root = document.documentElement;
const hero = document.querySelector('.hero');
const lagoonLayer = hero.querySelector('.lagoon');
const walkersLayer = document.querySelector('.walkers');
const newBadge = purse.querySelector('.new-badge');
const shop = document.getElementById('shop');
const shopPanel = shop.querySelector('.shop-panel');
const shopGold = document.getElementById('shop-gold');
const shopBalance = shop.querySelector('.shop-balance');
const shopCoin = shopBalance.querySelector('img');
const shopTabs = shop.querySelector('.shop-tabs');
const shopGrid = shop.querySelector('.shop-grid');

const goldImage = new Image();
goldImage.src = 'assets/sprites/gold.png';

// ---------- what a visitor keeps between visits ----------
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* this visit only */ }
  },
};

// ---------- helpers ----------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const snap = (v) => Math.round(v);
const wrap = (v, size) => ((v % size) + size) % size;

// A short squash on the purse or the shop's balance, without asking the page for its layout.
function pop(el) {
  if (el.animate && !reduceMotion) {
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.4 }, { transform: 'scale(1)' }],
      { duration: 180, easing: 'steps(3)' });
  }
}

// ---------- gold ----------
let gold = Math.max(0, parseInt(store.get('brs-gold', 0), 10) || 0);
let goldSaveTimer = 0;

function saveGold() {
  clearTimeout(goldSaveTimer);
  goldSaveTimer = 0;
  store.set('brs-gold', gold);
}

function showGold() {
  goldLabel.textContent = gold;
  shopGold.textContent = gold;
  purse.classList.toggle('can-buy', SHOP.some((it) => !owns(it) && gold >= it.price));
  showNews();
}

function addGold(amount) {
  gold += amount;
  showGold();
  pop(shopOpen ? shopBalance : purse);
  // a coin lands many times a second; the purse is written down once it settles
  if (!goldSaveTimer) goldSaveTimer = setTimeout(saveGold, 500);
  if (gold >= 25) unlock('pocket');
  if (gold >= 100) unlock('hoard');
  if (shopOpen) refreshShop();
  tellAboutShop();
}
// a coin that landed in the last half second is not lost to closing the page
addEventListener('pagehide', () => { if (goldSaveTimer) saveGold(); });

// ---------- achievements ----------
const ACHIEVEMENTS = {
  first: ['Rock Bottom', 'Broke your first thing.'],
  crit: ['Lucky Swing', 'Landed a critical hit.'],
  logo: ['Rebrand', 'Broke the logo. It grows back.'],
  ten: ['Demolition Crew', 'Broke 10 things.'],
  pocket: ['Pocket Money', 'Swept up 25 gold.'],
  hoard: ['Dragon Hoard', 'Swept up 100 gold.'],
  all: ['You Broke the Website', 'Every single thing on this page, at least once.'],
  shopper: ['Big Spender', 'Bought something in the shop.'],
  pat: ['Head Pats', 'Gave a friend on the shore a pat.'],
  collector: ['Collector', 'Own everything in the shop.'],
};
const toasts = document.querySelector('.toasts');
const unlocked = store.get('brs-achievements', {}) || {};
const brokenEver = new Set();
let breaks = parseInt(store.get('brs-breaks', 0), 10) || 0;

const TOASTS_SHOWN = 3;

function toast(small, title, text) {
  // a burst of news keeps only the latest few on screen
  const shown = toasts.querySelectorAll('.toast:not(.out)');
  for (let i = 0; i <= shown.length - TOASTS_SHOWN; i++) {
    shown[i].classList.add('out');
    setTimeout(() => shown[i].remove(), 200);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = '<img src="assets/sprites/gold.png" alt=""><div><small></small><b></b><span></span></div>';
  t.querySelector('small').textContent = small;
  t.querySelector('b').textContent = title;
  t.querySelector('span').textContent = text;
  toasts.appendChild(t);
  setTimeout(() => t.classList.add('out'), 3600);
  setTimeout(() => t.remove(), 3900);
}

function unlock(id) {
  if (unlocked[id] || !ACHIEVEMENTS[id]) return;
  unlocked[id] = 1;
  store.set('brs-achievements', unlocked);
  toast('Achievement unlocked', ...ACHIEVEMENTS[id]);
}

function countBreak(el) {
  breaks += 1;
  store.set('brs-breaks', breaks);
  brokenEver.add(el);
  unlock('first');
  if (el.classList.contains('logo-wrap')) unlock('logo');
  if (breaks >= 10) unlock('ten');
  if (brokenEver.size >= document.querySelectorAll('[data-break]').length) unlock('all');
}

// ---------- the effects canvas ----------
let fxW = 0;
let fxH = 0;
let fxScale = 1;
let fxDirty = false;

function sizeFx() {
  fxScale = clamp(window.devicePixelRatio || 1, 1, 3);
  fxW = fx.clientWidth || innerWidth;
  fxH = fx.clientHeight || innerHeight;
  fx.width = Math.round(fxW * fxScale);
  fx.height = Math.round(fxH * fxScale);
  fxCtx.setTransform(fxScale, 0, 0, fxScale, 0, 0);
  fxCtx.imageSmoothingEnabled = false;
  labels.clear();
  fxDirty = true;
}

// Floating numbers, drawn once with the ink outline and kept: "+1" lands hundreds of times.
const labels = new Map();
const LABEL_FONT = '"BRS Digits", "Pixelify Sans", ui-monospace, monospace';
const fontReady = () => !document.fonts
  || (document.fonts.check('700 22px "Pixelify Sans"') && document.fonts.check('700 22px "BRS Digits"', '0'));

function label(text, colour, size) {
  const key = `${text}|${colour}|${size}`;
  const kept = labels.get(key);
  if (kept) return kept;
  const font = `700 ${size}px ${LABEL_FONT}`;
  const pen = document.createElement('canvas').getContext('2d');
  pen.font = font;
  const w = Math.ceil(pen.measureText(text).width) + 6;
  const h = size + 8;
  pen.canvas.width = Math.ceil(w * fxScale);
  pen.canvas.height = Math.ceil(h * fxScale);
  pen.scale(fxScale, fxScale);
  pen.font = font;
  pen.textBaseline = 'middle';
  pen.fillStyle = INK;
  for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) pen.fillText(text, 3 + dx, h / 2 + dy);
  pen.fillStyle = colour;
  pen.fillText(text, 3, h / 2);
  const made = { canvas: pen.canvas, w, h };
  if (fontReady()) labels.set(key, made);
  return made;
}

// ---------- particles ----------
const particles = [];
const pick = (list) => list[Math.random() * list.length | 0];

function spawn(p) {
  p.life = 0;
  p.rot = p.rot || 0;
  p.spin = p.spin || 0;
  p.max = p.max || 0.6;
  if (p.gravity === undefined) p.gravity = GRAVITY;
  if (p.fade === undefined) p.fade = 0.25;
  particles.push(p);
  return p;
}

function chips(x, y, colours, count, power) {
  const palette = effectOn('rainbow') ? RAINBOW : colours;
  for (let i = 0; i < count; i++) {
    const size = Math.random() < 0.3 ? 12 : 8;
    const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
    const s = rand(260, 560) * power;
    spawn({
      kind: 'chip', colour: palette[(i + (Math.random() * palette.length | 0)) % palette.length],
      x: x - size / 2, y: y - size / 2, w: size, h: size,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s, max: rand(0.35, 0.6),
    });
  }
}

function floatText(text, x, y, colour = '#ffcb40', size = 22) {
  const l = label(text, colour, size);
  spawn({
    kind: 'image', src: l.canvas, w: l.w, h: l.h,
    x: x - l.w / 2, y: y - 30, vx: rand(-30, 30), vy: -260, gravity: 500, max: 0.7, fade: 0.3,
  });
}

function heart(x, y) {
  spawn({ kind: 'pattern', pattern: HEART, colours: HEART_INK, cell: 3, x: x - 10, y: y - 10, vx: rand(-20, 20), vy: -170, gravity: 120, max: 0.9, fade: 0.35 });
}

// Small drawings, one letter to an art pixel; each letter's colour is in its ink.
const HEART = ['.hh.XX.', 'hXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
const HEART_INK = { X: '#e8455a', h: '#ff8a9a' };
const LEAF = ['..gg', '.ggd', 'ggd.', 'd...'];
const LEAF_INKS = [{ g: '#5cc14a', d: '#3c8f3a' }, { g: '#ffb340', d: '#e87838' }, { g: '#9bd34a', d: '#5c9a2c' }];
const BUBBLE = ['.bb.', 'b.wb', 'b..b', '.bb.'];
const BUBBLE_INK = { b: '#d6f0ff', w: '#ffffff' };
const FLAKE = ['.w.', 'www', '.w.'];
const FLAKE_INK = { w: '#ffffff' };

// One particle on a canvas: the effects canvas, or a card's preview in the shop.
function drawParticle(ctx, p, alpha) {
  ctx.globalAlpha = alpha * (p.alpha || 1);
  const x = snap(p.x);
  const y = snap(p.y);

  if (p.kind === 'chip') {
    ctx.fillStyle = p.colour;
    if (p.shrink) {
      // an ember burns down in whole pixels
      const size = Math.max(2, Math.round(p.w * (1 - p.life / p.max) / 2) * 2);
      const inset = (p.w - size) / 2;
      ctx.fillRect(x + inset, y + inset, size, size);
    } else {
      ctx.fillRect(x, y, p.w, p.h);
    }
  } else if (p.kind === 'spark') {
    ctx.fillStyle = p.colour;
    ctx.fillRect(x, y, 4, 4);
    if (p.life < p.max * 0.5) {
      ctx.fillRect(x - 4, y, 4, 4); ctx.fillRect(x + 4, y, 4, 4);
      ctx.fillRect(x, y - 4, 4, 4); ctx.fillRect(x, y + 4, 4, 4);
    }
  } else if (p.kind === 'pattern') {
    const cell = p.cell;
    for (let r = 0; r < p.pattern.length; r++) {
      const row = p.pattern[r];
      for (let c = 0; c < row.length; c++) {
        const colour = p.colours[row[c]];
        if (!colour) continue;
        ctx.fillStyle = colour;
        ctx.fillRect(x + c * cell, y + r * cell, cell, cell);
      }
    }
  } else {
    const src = p.src;
    if (!src || src.complete === false || p.w < 1 || p.h < 1) return;
    // spin in 15 degree steps so pieces tumble like sprites rather than smear
    const r = p.spin ? Math.round(p.rot / 15) * 15 : 0;
    if (r) {
      ctx.save();
      ctx.translate(x + p.w / 2, y + p.h / 2);
      ctx.rotate(r * Math.PI / 180);
      if (p.sw) ctx.drawImage(src, p.sx, p.sy, p.sw, p.sh, -p.w / 2, -p.h / 2, p.w, p.h);
      else ctx.drawImage(src, -p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    } else if (p.sw) {
      ctx.drawImage(src, p.sx, p.sy, p.sw, p.sh, x, y, p.w, p.h);
    } else {
      ctx.drawImage(src, x, y, p.w, p.h);
    }
  }
}

function drawFx() {
  if (!particles.length) {
    if (fxDirty) {
      fxCtx.clearRect(0, 0, fxW, fxH);
      fxDirty = false;
    }
    return;
  }
  fxCtx.clearRect(0, 0, fxW, fxH);
  fxDirty = true;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const left = p.max - p.life;
    drawParticle(fxCtx, p, p.fade > 0 && left < p.fade ? Math.max(0, left / p.fade) : 1);
  }
  fxCtx.globalAlpha = 1;
}

// ---------- trails behind the cursor ----------
const handImage = new Image();
handImage.src = 'assets/sprites/hand.png';
let trailTimer = 0;
let trailFrom = null;
let trailCount = 0;

// Each trail makes one piece where the pointer is; `every` is the spacing in seconds of
// movement, `step` in pixels for the ribbon, which has to read as one unbroken stripe.
const TRAILS = {
  sparkle: {
    every: 0.03,
    make: (x, y) => ({
      kind: 'spark', colour: pick(['#ffcb40', '#ffffff', '#fff3b0']),
      x: x + rand(-6, 6), y: y + rand(-6, 6), vx: rand(-50, 50), vy: rand(-80, 10),
      gravity: 260, max: rand(0.3, 0.5), fade: 0.25,
    }),
  },
  leaves: {
    every: 0.07,
    make: (x, y) => ({
      kind: 'pattern', pattern: LEAF, colours: pick(LEAF_INKS), cell: 3,
      x: x - 6, y: y - 6, vx: rand(-30, 30), vy: rand(-30, 10), gravity: 140,
      sway: 50, swayRate: rand(5, 8), phase: rand(0, 6), max: rand(0.9, 1.3), fade: 0.4,
    }),
  },
  bubbles: {
    every: 0.08,
    make: (x, y) => ({
      kind: 'pattern', pattern: BUBBLE, colours: BUBBLE_INK, cell: 3,
      x: x - 6, y: y - 6, vx: rand(-15, 15), vy: rand(-60, -20), gravity: -160,
      sway: 30, swayRate: 7, phase: rand(0, 6), max: rand(0.7, 1), fade: 0.3,
    }),
  },
  snow: {
    every: 0.05,
    make: (x, y) => ({
      kind: 'pattern', pattern: FLAKE, colours: FLAKE_INK, cell: 3,
      x: x - 4 + rand(-8, 8), y: y - 4, vx: rand(-10, 10), vy: rand(20, 60), gravity: 40,
      sway: 35, swayRate: 4, phase: rand(0, 6), max: rand(0.9, 1.3), fade: 0.4,
    }),
  },
  hearts: {
    every: 0.09,
    make: (x, y) => ({
      kind: 'pattern', pattern: HEART, colours: HEART_INK, cell: 2,
      x: x - 7, y: y - 6, vx: rand(-20, 20), vy: -60, gravity: -90,
      sway: 20, swayRate: 6, phase: rand(0, 6), max: 0.9, fade: 0.35,
    }),
  },
  fire: {
    every: 0.016,
    make: (x, y) => {
      const size = pick([8, 8, 12]);
      return {
        kind: 'chip', shrink: true, colour: pick(['#ffcb40', '#ff9f43', '#f05a5a', '#fff3b0']),
        x: x - size / 2 + rand(-4, 4), y: y - size / 2, w: size, h: size,
        vx: rand(-40, 40), vy: rand(-60, -20), gravity: -380, max: rand(0.3, 0.5), fade: 0.2,
      };
    },
  },
  ribbon: {
    step: 6,
    make: (x, y, i) => ({
      kind: 'chip', colour: RAINBOW[i % RAINBOW.length],
      x: x - 4, y: y - 4, w: 8, h: 8, vx: 0, vy: 0, gravity: 0, max: 0.45, fade: 0.45,
    }),
  },
  ooze: {
    every: 0.035,
    make: (x, y) => {
      const size = pick([4, 8, 8]);
      return {
        kind: 'chip', colour: pick(['#8e3bbf', '#b04fd8', '#5d2382', '#d58cf2']),
        x: x - size / 2 + rand(-5, 5), y, w: size, h: size + 4,
        vx: rand(-10, 10), vy: rand(0, 60), gravity: 700, max: rand(0.5, 0.8), fade: 0.3,
      };
    },
  },
  ghost: {
    every: 0.06,
    make: (x, y) => ({
      kind: 'image', src: handImage, w: 36, h: 34, x: x - 4, y: y - 4,
      vx: 0, vy: 0, gravity: 0, max: 0.35, fade: 0.35, alpha: 0.55,
    }),
  },
};

function trailOn() {
  return reduceMotion ? null : TRAILS[looks.trail] || null;
}

function layTrail(dt) {
  const trail = trailOn();
  if (!trail || !pointer.inside) {
    trailFrom = null;
    return;
  }
  if (trail.step) {
    if (!trailFrom) {
      trailFrom = { x: pointer.x, y: pointer.y };
      return;
    }
    const dx = pointer.x - trailFrom.x;
    const dy = pointer.y - trailFrom.y;
    const steps = Math.min(24, Math.floor(Math.hypot(dx, dy) / trail.step));
    for (let i = 1; i <= steps; i++) {
      spawn(trail.make(trailFrom.x + dx * i / steps, trailFrom.y + dy * i / steps, trailCount++));
    }
    if (steps) trailFrom = { x: pointer.x, y: pointer.y };
    return;
  }
  trailTimer -= dt;
  if (pointer.moved && trailTimer <= 0) {
    spawn(trail.make(pointer.x, pointer.y, trailCount++));
    trailTimer = trail.every;
  }
}

// a finger leaves no trail, so a tap leaves a small burst of it instead
function tapTrail(x, y) {
  const trail = trailOn();
  if (!trail) return;
  for (let i = 0; i < 6; i++) spawn(trail.make(x + rand(-14, 14), y + rand(-14, 14), trailCount++));
}

// ---------- nodes ----------
const nodes = new Map();
const live = new Set();

function nodeFor(el) {
  let n = nodes.get(el);
  if (n) return n;
  const media = el.querySelector('img, video');
  n = {
    el,
    media,
    kind: media ? 'media' : 'text',
    maxHp: 0,
    hp: 0,
    canvas: null,
    bar: null,
    fill: null,
    chunk: null,
    chunkFrac: 1,
    chunkDelay: 0,
    squash: 0,
    squashDepth: 0,
    shake: 0,
    shakeDir: 1,
    flash: 0,
    arrive: 0,
    broken: false,
    respawnIn: 0,
  };
  n.maxHp = n.hp = maxHpFor(el);
  nodes.set(el, n);
  if (media) readAhead(n);
  return n;
}

// Bigger things take more blows, as a boulder does next to a pebble.
function maxHpFor(el) {
  const area = el.offsetWidth * el.offsetHeight;
  return clamp(Math.round(Math.sqrt(area) / 60), 3, 8);
}

function ensureOverlay(n) {
  const w = n.el.offsetWidth;
  const h = n.el.offsetHeight;
  if (!n.canvas) {
    n.canvas = document.createElement('canvas');
    n.canvas.className = 'cracks';
    n.el.appendChild(n.canvas);
  }
  if (n.canvas.width !== w || n.canvas.height !== h) {
    n.canvas.width = w;
    n.canvas.height = h;
    n.canvas.style.width = w + 'px';
    n.canvas.style.height = h + 'px';
  }
  if (!n.bar) {
    n.bar = document.createElement('span');
    n.bar.className = 'hp';
    n.chunk = document.createElement('b');
    n.fill = document.createElement('i');
    n.bar.append(n.chunk, n.fill);
    n.el.appendChild(n.bar);
  }
}

// Cracks grow out of the point that was struck, drawn on a 4px grid like the art.
function crack(n, lx, ly, strength) {
  const ctx = n.canvas.getContext('2d');
  const P = ART_PX;
  const w = n.canvas.width;
  const h = n.canvas.height;
  const reach = Math.max(w, h) * 0.09 * strength + 16;
  const dark = n.kind === 'media' ? 'rgba(29,26,33,.9)' : 'rgba(45,40,50,.75)';
  const lite = 'rgba(255,255,255,.55)';
  const branches = 2 + Math.round(strength);

  const sx = Math.floor(lx / P) * P;
  const sy = Math.floor(ly / P) * P;
  ctx.fillStyle = dark;
  ctx.fillRect(sx - P, sy, P * 3, P);
  ctx.fillRect(sx, sy - P, P, P * 3);

  for (let b = 0; b < branches; b++) {
    let x = sx;
    let y = sy;
    const angle = rand(0, Math.PI * 2);
    let dx = Math.cos(angle);
    let dy = Math.sin(angle);
    const steps = Math.round(reach / P * rand(0.6, 1.1));
    for (let s = 0; s < steps; s++) {
      dx += rand(-0.45, 0.45);
      dy += rand(-0.45, 0.45);
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      x += Math.round(dx) * P;
      y += Math.round(dy) * P;
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      ctx.fillStyle = dark;
      ctx.fillRect(x, y, P, P);
      ctx.fillStyle = lite;
      ctx.fillRect(x + P, y + P, P, P);
      // a short side crack now and then
      if (Math.random() < 0.12) {
        const ox = Math.random() < 0.5 ? -1 : 1;
        const oy = Math.random() < 0.5 ? -1 : 1;
        ctx.fillStyle = dark;
        for (let k = 1; k <= 3; k++) {
          ctx.fillRect(x + ox * k * P, y + oy * Math.floor(k / 2) * P, P, P);
        }
      }
    }
  }
}

// A cracked logo cracks along its letters, not across the water around it: the cracks are
// kept only where the picture has pixels. Opaque pictures lose nothing to this.
function clipToPicture(n) {
  const m = n.media;
  if (!m || m.tagName !== 'IMG' || !m.complete || !m.naturalWidth) return;
  const ctx = n.canvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(m, n.el.clientLeft + m.offsetLeft, n.el.clientTop + m.offsetTop, m.offsetWidth, m.offsetHeight);
  ctx.restore();
}

// A clip's poster stands in for it until its first frame is ready.
const posters = new Map();
function posterOf(video) {
  let im = posters.get(video);
  if (!im && video.poster) {
    im = new Image();
    im.src = video.poster;
    posters.set(video, im);
  }
  return im;
}

// Pictures are read ahead of time, while they scroll into view, and off the main thread: a
// small thumbnail for the colours of the chips, and a copy at the size the picture is shown,
// for its pieces. Read on the blow itself, a screenshot had to be decoded from its full
// 1920x1080 file in the middle of the frame that broke it, which is the stutter players saw.
// A clip is read off its poster, which is the same scene; reading a playing clip back from
// the graphics card on every hit was the other stutter.
const sampler = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
const readings = new WeakMap();
const awaited = new WeakSet();
const THUMB_W = 64;

function sourceOf(m) {
  return m.tagName === 'VIDEO' ? posterOf(m) : m;
}

function readAhead(n) {
  if (n.kind !== 'media') return;
  const src = sourceOf(n.media);
  if (!src) return;
  if (!src.complete || !src.naturalWidth) {
    if (!awaited.has(src)) {
      awaited.add(src);
      src.addEventListener('load', () => readAhead(n), { once: true });
    }
    return;
  }
  let r = readings.get(src);
  if (!r) {
    r = { thumb: null, copy: null, copyW: 0, copyH: 0, busy: false };
    readings.set(src, r);
  }
  if (r.busy || !window.createImageBitmap) return;
  const k = fxScale;
  const w = Math.max(1, Math.round(n.media.offsetWidth * k));
  const h = Math.max(1, Math.round(n.media.offsetHeight * k));
  const needThumb = !r.thumb;
  const needCopy = r.copyW !== w || r.copyH !== h;
  if (!needThumb && !needCopy) return;
  r.busy = true;
  const th = Math.max(1, Math.round(THUMB_W * src.naturalHeight / src.naturalWidth));
  const pixelated = w >= src.naturalWidth;
  Promise.all([
    needThumb ? createImageBitmap(src, { resizeWidth: THUMB_W, resizeHeight: th, resizeQuality: 'pixelated' }) : null,
    needCopy ? createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: pixelated ? 'pixelated' : 'high' }) : null,
  ]).then(([thumb, copy]) => {
    if (thumb) {
      sampler.canvas.width = THUMB_W;
      sampler.canvas.height = th;
      sampler.drawImage(thumb, 0, 0, THUMB_W, th);
      r.thumb = { data: sampler.getImageData(0, 0, THUMB_W, th).data, w: THUMB_W, h: th };
      thumb.close();
    }
    if (copy) {
      if (r.copy) r.copy.close();
      r.copy = copy;
      r.copyW = w;
      r.copyH = h;
    }
  }).catch(() => { /* drawn straight from the picture instead */ }).finally(() => { r.busy = false; });
}

function thumbOf(n) {
  const r = readings.get(sourceOf(n.media));
  if (!r || !r.thumb) readAhead(n);
  return r && r.thumb;
}

// the pictures nearest the screen are read first, each while the page is idle
const idle = window.requestIdleCallback || ((f) => setTimeout(f, 60));
if ('IntersectionObserver' in window) {
  const reader = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) idle(() => readAhead(nodeFor(entry.target)));
    });
  }, { rootMargin: '400px 0px' });
  document.querySelectorAll('[data-break]').forEach((el) => {
    if (el.querySelector('img, video')) reader.observe(el);
  });
}

function chipColours(n, x, y) {
  if (n.kind === 'media') {
    const t = thumbOf(n);
    const r = n.media.getBoundingClientRect();
    if (t && t.data && r.width > 0) {
      const colours = [];
      for (let i = 0; i < 6 && colours.length < 4; i++) {
        const px = clamp(Math.floor(((x + rand(-12, 12)) - r.left) / r.width * t.w), 0, t.w - 1);
        const py = clamp(Math.floor(((y + rand(-12, 12)) - r.top) / r.height * t.h), 0, t.h - 1);
        const o = (py * t.w + px) * 4;
        if (t.data[o + 3] > 0) colours.push(`rgb(${t.data[o]},${t.data[o + 1]},${t.data[o + 2]})`);
      }
      if (colours.length) return colours;
    }
    return ['#2d2832', '#4ea5fa', '#ffcb40'];
  }
  const cs = getComputedStyle(n.el);
  const out = [cs.color, cs.color, '#ffcb40'];
  if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') out.push(cs.backgroundColor);
  return out;
}

// ---------- hitting ----------
let sinceSwing = Infinity;
let shakeScreen = 0;
let firstBreakDone = false;

function hit(el, x, y) {
  const n = nodeFor(el);
  if (n.broken || n.arrive > 0) return;

  const crit = Math.random() < CRIT_CHANCE;
  const damage = crit ? 2 : 1;
  const before = n.hp / n.maxHp;
  n.hp = Math.max(0, n.hp - damage);

  sinceSwing = 0;

  ensureOverlay(n);
  const r = el.getBoundingClientRect();
  const lx = (x - r.left) * (el.offsetWidth / (r.width || 1));
  const ly = (y - r.top) * (el.offsetHeight / (r.height || 1));
  crack(n, lx, ly, damage);
  clipToPicture(n);

  n.flash = FLASH_SECONDS;
  el.classList.add(n.kind === 'media' ? 'flash' : 'flash-text');
  n.squash = SQUASH_SECONDS;
  n.squashDepth = crit ? 0.16 : 0.08;
  n.shake = crit ? 0.2 : 0.14;
  n.shakeDir = x < r.left + r.width / 2 ? 1 : -1;

  n.bar.style.display = 'block';
  n.fill.style.width = (n.hp / n.maxHp * 100) + '%';
  n.chunkFrac = Math.max(n.chunkFrac, before);
  n.chunk.style.width = (n.chunkFrac * 100) + '%';
  n.chunkDelay = 0.25;

  chips(x, y, chipColours(n, x, y), crit ? 14 : 8, crit ? 1.25 : 1);
  if (crit) {
    unlock('crit');
    floatText('CRIT!', x, y);
    if (!reduceMotion) shakeScreen = Math.max(shakeScreen, 0.12);
  }

  live.add(n);
  if (n.hp <= 0) shatter(n, x, y);
}

function shatter(n, x, y) {
  const el = n.el;
  const r = el.getBoundingClientRect();

  if (n.kind === 'media') shatterPicture(n, r, x, y);
  else shatterWords(n, x, y);

  // a card or a framed thing also throws bits of its frame
  const cs = getComputedStyle(el);
  const frame = [];
  if (parseFloat(cs.borderTopWidth) > 0) frame.push(cs.borderTopColor);
  if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') frame.push(cs.backgroundColor);
  if (frame.length) chips(x, y, frame, 10, 1.3);

  dropGold(n, x, y);
  countBreak(el);

  el.classList.add('broken');
  el.classList.remove('flash', 'flash-text');
  el.style.transform = '';
  n.transform = '';
  if (n.canvas) n.canvas.getContext('2d').clearRect(0, 0, n.canvas.width, n.canvas.height);
  if (n.bar) n.bar.style.display = 'none';
  if (n.media && n.media.tagName === 'VIDEO') n.media.pause();

  n.broken = true;
  n.respawnIn = RESPAWN_SECONDS;
  n.squash = n.shake = n.flash = 0;
  pointerStale = true;
  if (!reduceMotion) shakeScreen = Math.max(shakeScreen, 0.22);

  if (!firstBreakDone && hint) {
    firstBreakDone = true;
    hint.textContent = 'It all grows back. Keep swinging.';
    setTimeout(() => hint.classList.add('done'), 3500);
  }
}

// Draws one picture of the node where it stands on screen, so the pieces start exactly where
// the picture was, mid-bob and mid-tap included.
function drawMedia(ctx, el, er, m, k) {
  let src = m;
  let natW = m.videoWidth || m.naturalWidth;
  if (m.tagName === 'VIDEO' && m.readyState < 2) {
    src = posterOf(m);
    natW = src && src.complete ? src.naturalWidth : 0;
  }
  if (!src || !natW) return;
  const mr = m.getBoundingClientRect();
  const sx = el.offsetWidth / (er.width || 1);
  const sy = el.offsetHeight / (er.height || 1);
  const x = (mr.left - er.left) * sx;
  const y = (mr.top - er.top) * sy;
  const w = mr.width * sx;
  const h = mr.height * sy;
  // the copy read ahead, when it is ready and still the size the picture is shown at
  const r = src !== m || m.tagName === 'IMG' ? readings.get(src) : null;
  if (r && r.copy && r.copyW === Math.round(m.offsetWidth * k) && r.copyH === Math.round(m.offsetHeight * k)) {
    ctx.drawImage(r.copy, x, y, w, h);
    return;
  }
  ctx.imageSmoothingEnabled = w * k < natW;
  try {
    ctx.drawImage(src, x, y, w, h);
  } catch (e) { /* nothing to draw */ }
}

function shatterPicture(n, r, x, y) {
  const el = n.el;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (!w || !h) return;
  const k = fxScale;
  const picture = document.createElement('canvas');
  picture.width = Math.ceil(w * k);
  picture.height = Math.ceil(h * k);
  const ctx = picture.getContext('2d');
  ctx.scale(k, k);
  const bg = getComputedStyle(el).backgroundColor;
  if (bg && bg !== 'rgba(0, 0, 0, 0)') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  // the hand goes with the name; the click's strokes are only a flash
  el.querySelectorAll('img:not(.title-click), video').forEach((m) => drawMedia(ctx, el, r, m, k));

  const cols = clamp(Math.round(w / 80), 3, 8);
  const rows = clamp(Math.round(h / 80), 2, 6);
  const tw = w / cols;
  const th = h / rows;
  const sx = r.width / w;
  const sy = r.height / h;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const px = r.left + col * tw * sx;
      const py = r.top + row * th * sy;
      const dx = px + tw * sx / 2 - x;
      const dy = py + th * sy / 2 - y;
      const d = Math.hypot(dx, dy) || 1;
      const push = rand(220, 520);
      spawn({
        kind: 'image', src: picture,
        sx: col * tw * k, sy: row * th * k, sw: tw * k, sh: th * k,
        x: px, y: py, w: tw * sx, h: th * sy,
        vx: dx / d * push + rand(-60, 60), vy: dy / d * push - rand(380, 700),
        spin: rand(-540, 540), max: rand(0.8, 1.15), fade: 0.35,
      });
    }
  }
}

// "rgb(1, 2, 3) 0px 2px 0px, ..." into [{ colour, x, y }]
function parseShadows(value) {
  const out = [];
  if (!value || value === 'none') return out;
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= value.length; i++) {
    const c = value[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (i === value.length || (c === ',' && depth === 0)) {
      const part = value.slice(start, i).trim();
      start = i + 1;
      const colour = (part.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i) || ['rgba(0,0,0,.5)'])[0];
      const nums = part.replace(colour, '').match(/-?[\d.]+px/g) || [];
      out.push({ colour, x: parseFloat(nums[0]) || 0, y: parseFloat(nums[1]) || 0 });
    }
  }
  return out;
}

// Words fly off one by one. They are drawn once into a single sheet and flown from there.
function shatterWords(n, x, y) {
  const el = n.el;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) => (t.textContent.trim() && !t.parentElement.closest('.hp')
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const range = document.createRange();
  const words = [];
  let node;
  while ((node = walker.nextNode())) {
    const cs = getComputedStyle(node.parentElement);
    const look = {
      font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
      colour: cs.color,
      shadows: parseShadows(cs.textShadow),
    };
    const text = node.textContent;
    const pattern = /\S+/g;
    let m;
    while ((m = pattern.exec(text))) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rect = range.getClientRects()[0];
      if (rect && rect.width) words.push({ text: m[0], rect, look });
    }
  }
  if (!words.length) return;

  const k = fxScale;
  const pad = 4;
  const widest = 1024;
  let ax = 0;
  let ay = 0;
  let rowH = 0;
  let sheetW = 0;
  for (const word of words) {
    word.w = Math.ceil(word.rect.width) + pad * 2;
    word.h = Math.ceil(word.rect.height) + pad * 2;
    if (ax + word.w > widest) { ax = 0; ay += rowH; rowH = 0; }
    word.ax = ax;
    word.ay = ay;
    ax += word.w;
    rowH = Math.max(rowH, word.h);
    sheetW = Math.max(sheetW, ax);
  }
  const sheet = document.createElement('canvas');
  sheet.width = Math.ceil(sheetW * k);
  sheet.height = Math.ceil((ay + rowH) * k);
  const ctx = sheet.getContext('2d');
  ctx.scale(k, k);
  ctx.textBaseline = 'middle';

  for (const word of words) {
    const tx = word.ax + pad;
    const ty = word.ay + pad + word.rect.height / 2;
    ctx.font = word.look.font;
    for (const s of word.look.shadows) {
      ctx.fillStyle = s.colour;
      ctx.fillText(word.text, tx + s.x, ty + s.y);
    }
    ctx.fillStyle = word.look.colour;
    ctx.fillText(word.text, tx, ty);

    const r = word.rect;
    const dx = r.left + r.width / 2 - x;
    const dy = r.top + r.height / 2 - y;
    const d = Math.hypot(dx, dy) || 1;
    const push = rand(160, 420);
    spawn({
      kind: 'image', src: sheet,
      sx: word.ax * k, sy: word.ay * k, sw: word.w * k, sh: word.h * k,
      x: r.left - pad, y: r.top - pad, w: word.w, h: word.h,
      vx: dx / d * push + rand(-50, 50), vy: dy / d * push * 0.5 - rand(300, 620),
      spin: rand(-420, 420), max: rand(0.8, 1.2), fade: 0.35,
    });
  }
}

// ---------- gold ----------
let coinTarget = { x: 0, y: 0 };

function dropGold(n, x, y) {
  const count = clamp(1 + Math.round(n.maxHp / 2), 2, 5);
  for (let i = 0; i < count; i++) {
    spawn({
      kind: 'coin', src: goldImage, w: 32, h: 32,
      x: x - 16, y: y - 16, vx: rand(-260, 260), vy: rand(-720, -420),
      max: Infinity, fade: 0, floor: y + rand(10, 70) - 16,
      rest: rand(1.0, 1.6), homing: false,
    });
  }
}

function updateCoin(p, dt) {
  const target = homingTarget(p);
  if (target) {
    p.homing = true;
    const dx = target.x - (p.x + 16);
    const dy = target.y - (p.y + 16);
    const d = Math.hypot(dx, dy);
    const speed = 900 + p.life * 900;
    if (d < 18) {
      addGold(1);
      floatText('+1', p.x + 16, p.y);
      return false;
    }
    p.x += dx / d * Math.min(d, speed * dt);
    p.y += dy / d * Math.min(d, speed * dt);
    return true;
  }
  // falling and one bounce, then lying where it landed
  p.vy += GRAVITY * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (p.y > p.floor) {
    p.y = p.floor;
    p.vy = Math.abs(p.vy) > 220 ? -Math.abs(p.vy) * 0.35 : 0;
    p.vx *= 0.5;
  }
  return true;
}

function homingTarget(p) {
  const cx = p.x + 16;
  const cy = p.y + 16;
  // the cursor sweeps loot up, as in-game
  if (finePointer && pointer.inside && !shopOpen && Math.hypot(pointer.x - cx, pointer.y - cy) < MAGNET_RADIUS && p.life > 0.25) {
    return { x: pointer.x, y: pointer.y };
  }
  if (p.homing || p.life > p.rest) {
    p.homing = true;
    return coinTarget;
  }
  return null;
}

// Where the coins fly: the purse, or the shop's balance while the shop is open. Read once a
// frame, before anything on the page is moved, so the read never waits on a layout.
function aimCoins() {
  const r = (shopOpen ? shopCoin : purseIcon).getBoundingClientRect();
  coinTarget = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ---------- pointer ----------
const pointer = { x: -999, y: -999, down: false, inside: false, over: null, justPressed: false, moved: false };
let pointerStale = true;
let holdTimer = 0;
let bend = 0;
let pressLatch = 0;
let shownPose = 0;

function breakableAt(target) {
  if (!target || !target.closest) return null;
  if (target.closest('a, button, input, textarea, select, summary, dialog, .shop')) return null;
  const el = target.closest('[data-break]');
  return el && !el.classList.contains('broken') ? el : null;
}

window.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inside = true;
  pointer.moved = true;
  pointer.over = breakableAt(e.target);
  pointerStale = false;
}, { passive: true });

// scrolling slides the page under a still pointer
window.addEventListener('scroll', () => { pointerStale = true; }, { passive: true });

document.addEventListener('mouseout', (e) => {
  if (!e.relatedTarget) { pointer.inside = false; pointer.over = null; }
});
window.addEventListener('blur', () => { pointer.down = false; });

window.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inside = true;
  pointer.down = true;
  pointer.justPressed = true;
  const el = breakableAt(e.target);
  pointer.over = el;
  if (el) {
    e.preventDefault();
    hit(el, e.clientX, e.clientY);
    holdTimer = HOLD_INTERVAL;
  }
  if (!finePointer) tapTrail(e.clientX, e.clientY);
});
window.addEventListener('pointerup', () => { pointer.down = false; });
window.addEventListener('pointercancel', () => { pointer.down = false; });
document.addEventListener('dragstart', (e) => { if (breakableAt(e.target)) e.preventDefault(); });

window.addEventListener('resize', () => {
  sizeFx();
  measureLagoon();
  pointerStale = true;
  nodes.forEach((n) => {
    if (n.canvas && !n.broken) ensureOverlay(n);
  });
});

// The swing sprite, written only when something about it changes.
const toolShown = { visible: false, frame: -1, x: NaN, y: NaN };

function showTool(visible, frame, x, y) {
  if (visible !== toolShown.visible) {
    tool.style.display = visible ? 'block' : 'none';
    toolShown.visible = visible;
  }
  if (!visible) return;
  if (frame !== toolShown.frame) {
    tool.style.backgroundPosition = `${-frame * TOOL_W}px 0`;
    toolShown.frame = frame;
  }
  if (x !== toolShown.x || y !== toolShown.y) {
    tool.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    toolShown.x = x;
    toolShown.y = y;
  }
}

function updatePointer(dt) {
  // the finger bends into a click and back out of it
  pressLatch = pointer.justPressed ? PRESSED_HOLD + BEND_SECONDS : Math.max(0, pressLatch - dt);
  pointer.justPressed = false;
  const target = pointer.down || pressLatch > 0 ? 1 : 0;
  bend = target > bend ? Math.min(target, bend + dt / BEND_SECONDS) : Math.max(target, bend - dt / BEND_SECONDS);
  const pose = bend >= 1 ? 2 : bend > 0 ? 1 : 0;
  if (pose !== shownPose) {
    root.classList.toggle('bending', pose === 1);
    root.classList.toggle('pressed', pose === 2);
    shownPose = pose;
  }

  if (!finePointer) return;

  if (pointer.inside && pointerStale) {
    pointer.over = breakableAt(document.elementFromPoint(pointer.x, pointer.y));
    pointerStale = false;
  }

  // a held click keeps swinging
  if (pointer.down && pointer.over) {
    holdTimer -= dt;
    if (holdTimer <= 0) {
      hit(pointer.over, pointer.x, pointer.y);
      holdTimer += HOLD_INTERVAL;
    }
  }

  if (pointer.over && pointer.inside) {
    sinceSwing += dt;
    const into = sinceSwing + STRIKE_FRAME / TOOL_FPS;
    const frame = into < TOOL_FRAMES / TOOL_FPS ? Math.floor(into * TOOL_FPS) : 0;
    showTool(true, frame, snap(pointer.x - ANCHOR_X), snap(pointer.y - ANCHOR_Y));
  } else {
    showTool(false);
    sinceSwing = Infinity; // leaving the work ends the blow with it
  }

  layTrail(dt);
  pointer.moved = false;
}

// ---------- the one loop ----------
let last = performance.now();

function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (particles.length) aimCoins();
  updatePointer(dt);
  updateNodes(dt);
  updateParticles(dt);
  updateLagoon(dt);
  updateWalkers(dt);
  updateScreenShake(dt);
  drawFx();

  requestAnimationFrame(tick);
}

function updateNodes(dt) {
  live.forEach((n) => {
    const el = n.el;

    if (n.broken) {
      n.respawnIn -= dt;
      if (n.respawnIn <= 0) regrow(n);
      return;
    }

    if (n.flash > 0) {
      n.flash -= dt;
      if (n.flash <= 0) el.classList.remove('flash', 'flash-text');
    }

    let tx = 0;
    let ty = 0;
    let sx = 1;
    let sy = 1;

    if (n.squash > 0) {
      n.squash = Math.max(0, n.squash - dt);
      // stepped back to the drawn size, the way a sprite squash snaps
      const k = Math.ceil((n.squash / SQUASH_SECONDS) * 3) / 3;
      sy = 1 - n.squashDepth * k;
      sx = 1 + n.squashDepth * 0.6 * k;
    }
    if (n.shake > 0) {
      n.shake = Math.max(0, n.shake - dt);
      const flip = Math.floor(n.shake / 0.035) % 2 ? 1 : -1;
      tx = n.shakeDir * flip * Math.ceil(n.shake * 30);
    }
    if (n.arrive > 0) {
      n.arrive = Math.max(0, n.arrive - dt);
      const t = 1 - n.arrive / 0.36;
      if (t < 0.4) {
        // the white shape drops in from above
        ty = -Math.round((1 - t / 0.4) * 6) * 4;
      } else {
        const k = Math.ceil((1 - (t - 0.4) / 0.6) * 3) / 3;
        sy = 1 - 0.14 * k;
        sx = 1 + 0.1 * k;
      }
      if (n.arrive <= 0) el.classList.remove('flash', 'flash-text');
    }

    const transform = tx || ty || sx !== 1 || sy !== 1
      ? `translate(${tx}px, ${ty}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`
      : '';
    if (transform !== n.transform) {
      el.style.transform = transform;
      n.transform = transform;
    }

    if (n.chunkDelay > 0) {
      n.chunkDelay -= dt;
    } else if (n.chunk) {
      const frac = n.hp / n.maxHp;
      if (n.chunkFrac > frac) {
        n.chunkFrac = Math.max(frac, n.chunkFrac - dt * 1.6);
        n.chunk.style.width = (n.chunkFrac * 100) + '%';
      }
    }

    const busy = n.squash > 0 || n.shake > 0 || n.flash > 0 || n.arrive > 0 || n.chunkDelay > 0
      || (n.chunk && n.chunkFrac > n.hp / n.maxHp);
    if (!busy && n.hp === n.maxHp) live.delete(n);
    else if (!busy && n.hp < n.maxHp) {
      // a struck node mends slowly if left alone, so a page left open heals
      n.mend = (n.mend || 0) + dt;
      if (n.mend > 6) { heal(n); }
    }
    if (n.squash > 0 || n.shake > 0) n.mend = 0;
  });
}

function heal(n) {
  n.hp = n.maxHp;
  n.chunkFrac = 1;
  n.mend = 0;
  if (n.bar) n.bar.style.display = 'none';
  if (n.canvas) n.canvas.getContext('2d').clearRect(0, 0, n.canvas.width, n.canvas.height);
  live.delete(n);
}

function regrow(n) {
  const el = n.el;
  n.broken = false;
  n.maxHp = maxHpFor(el) || n.maxHp;
  n.hp = n.maxHp;
  n.chunkFrac = 1;
  n.mend = 0;
  el.classList.remove('broken');
  el.classList.add(n.kind === 'media' ? 'flash' : 'flash-text');
  n.arrive = 0.36;
  pointerStale = true;
  if (n.bar) n.bar.style.display = 'none';
  if (n.media && n.media.tagName === 'VIDEO' && n.media.dataset.inView) n.media.play().catch(() => {});

  const r = el.getBoundingClientRect();
  if (r.bottom > 0 && r.top < innerHeight) {
    const dust = ['#fdf6e8', '#ffffff', '#ffcb40'];
    for (let i = 0; i < 6; i++) {
      chips(r.left + rand(0.1, 0.9) * r.width, r.bottom - 4, dust, 1, 0.5);
    }
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;
    let alive;
    if (p.kind === 'coin') {
      alive = updateCoin(p, dt);
    } else {
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      // leaves, bubbles and flakes rock from side to side on the way
      if (p.sway) p.x += Math.cos(p.life * p.swayRate + p.phase) * p.sway * dt;
      alive = p.life < p.max;
    }
    if (!alive) particles.splice(i, 1);
  }
}

function updateScreenShake(dt) {
  if (shakeScreen > 0) {
    shakeScreen = Math.max(0, shakeScreen - dt);
    const a = Math.ceil(shakeScreen * 24);
    main.style.transform = shakeScreen > 0
      ? `translate(${(Math.random() < 0.5 ? -1 : 1) * a}px, ${(Math.random() < 0.5 ? -1 : 1) * Math.ceil(a / 2)}px)`
      : '';
  }
}

// ---------- the lagoon: gulls crossing, glints drifting and blinking ----------
const lagoon = { gulls: [], glints: [], t: 0, width: 0, height: 0, visible: true };

function buildLagoon() {
  lagoonLayer.textContent = '';
  lagoon.gulls = [];
  lagoon.glints = [];
  const gulls = effectOn('flock') ? 9 : 3;
  for (let i = 0; i < gulls; i++) {
    const el = document.createElement('i');
    el.className = 'gull';
    lagoonLayer.appendChild(el);
    lagoon.gulls.push({ el, across: Math.random(), height: rand(0.05, 0.55), frame: -1, x: NaN });
  }
  const glints = hero.dataset.lagoon === 'night' ? 22 : 12;
  for (let i = 0; i < glints; i++) {
    const el = document.createElement('i');
    el.className = 'glint';
    el.style.width = (Math.random() < 0.5 ? 2 : 3) * ART_PX + 'px';
    lagoonLayer.appendChild(el);
    lagoon.glints.push({
      el, across: Math.random(), height: rand(0.04, 0.9), phase: rand(0, Math.PI * 2),
      speed: GLINT_DRIFT * (i % 2 ? GLINT_SLOW : 1), lit: null, x: NaN,
    });
  }
  measureLagoon();
  lagoon.t = reduceMotion ? 0 : lagoon.t;
  placeLagoon(true);
}

function measureLagoon() {
  lagoon.width = hero.clientWidth;
  lagoon.height = hero.clientHeight;
  lagoon.gulls.forEach((g) => { g.y = snap(g.height * lagoon.height); g.x = NaN; });
  lagoon.glints.forEach((g) => { g.y = Math.round(g.height * lagoon.height / ART_PX) * ART_PX; g.x = NaN; });
}

function placeLagoon(force) {
  const W = lagoon.width;
  if (!W) return;
  const t = lagoon.t;
  lagoon.gulls.forEach((g, i) => {
    // right to left and round again, from off one side to off the other
    const span = 28;
    const room = W + span * 2;
    const pace = GULL_SPEED * (1 + GULL_SPREAD * (i % 4));
    const x = snap(wrap(g.across * room - t * pace, room) - span);
    if (x !== g.x || force) {
      g.el.style.transform = `translate3d(${x}px, ${g.y}px, 0)`;
      g.x = x;
    }
    const frame = Math.floor(t * GULL_FLAPS + i) % 2;
    if (frame !== g.frame) {
      g.el.style.backgroundPosition = frame ? '-28px 0' : '0 0';
      g.frame = frame;
    }
  });
  lagoon.glints.forEach((g) => {
    const lit = Math.sin(t * Math.PI * 2 / GLINT_BLINK + g.phase) > -0.2;
    if (lit !== g.lit) {
      g.el.style.visibility = lit ? '' : 'hidden';
      g.lit = lit;
    }
    if (!lit) return;
    const x = Math.round(wrap(g.across * W + t * g.speed, W) / ART_PX) * ART_PX;
    if (x !== g.x || force) {
      g.el.style.transform = `translate3d(${x}px, ${g.y}px, 0)`;
      g.x = x;
    }
  });
}

function updateLagoon(dt) {
  if (!lagoon.visible || reduceMotion) return;
  lagoon.t += dt;
  placeLagoon(false);
}

if ('IntersectionObserver' in window) {
  new IntersectionObserver((entries) => {
    lagoon.visible = entries[0].isIntersecting;
  }).observe(hero);
}

// ---------- friends along the bottom of the screen ----------
// The walkers bought in the shop live on the bottom edge of the screen, wherever the page is
// scrolled to. The page carries them while it moves: scroll down and they ride up with it,
// then drop back onto the edge with a puff of sand; scroll up and they are pushed under the
// edge, then hop back up onto it.
const WALKERS = {
  chick: { frames: 6, w: 36, h: 36, speed: 44 },
  duck: { frames: 6, w: 36, h: 33, speed: 38 },
  pig: { frames: 6, w: 60, h: 36, speed: 32 },
  sheep: { frames: 6, w: 60, h: 42, speed: 28 },
  miner: { frames: 8, w: 48, h: 60, speed: 52 },
  lumberjack: { frames: 8, w: 48, h: 60, speed: 52 },
  slime: { frames: 6, w: 60, h: 42, speed: 36 },
};
const PET_GRAVITY = 1800;
const PET_HOP = 28;        // how far above the edge a walker pushed under it hops back up to
const PET_GRIP = 0.12;     // seconds the page keeps hold of them after it stops moving
let walkers = [];
let lastScroll = window.scrollY;

function buildWalkers() {
  walkersLayer.textContent = '';
  walkers = [];
  const W = root.clientWidth;
  Object.keys(WALKERS).forEach((id) => {
    if (!effectOn(id)) return;
    const look = WALKERS[id];
    const el = document.createElement('i');
    el.className = 'pet';
    el.dataset.pet = id;
    el.style.width = look.w + 'px';
    el.style.height = look.h + 'px';
    el.style.backgroundImage = `url("assets/sprites/pet_${id}.png")`;
    el.style.backgroundSize = `${look.w * look.frames}px ${look.h}px`;
    walkersLayer.appendChild(el);
    const x = rand(8, Math.max(9, W - look.w - 8));
    walkers.push({
      el, look, x, target: x, dir: Math.random() < 0.5 ? -1 : 1, idle: rand(0, 2), clock: 0,
      y: 0, vy: 0, held: 0, carry: rand(0.6, 1), lift: rand(70, 150), shown: '', frame: -1,
    });
  });
}

function updateWalkers(dt) {
  const moved = window.scrollY - lastScroll;
  lastScroll = window.scrollY;
  if (!walkers.length) return;
  const W = root.clientWidth;
  walkers.forEach((p) => {
    let frame = 0;
    if (!reduceMotion) {
      if (moved) {
        // carried by the page while it moves
        p.y = clamp(p.y + moved * p.carry, -(p.look.h + 6), p.lift);
        p.vy = 0;
        p.held = PET_GRIP;
      } else if (p.held > 0) {
        p.held -= dt;
        // let go: under the edge it hops back up, above it it falls
        if (p.held <= 0 && p.y < 0) p.vy = Math.sqrt(2 * PET_GRAVITY * (PET_HOP - p.y));
      }
      if (p.held <= 0 && (p.y !== 0 || p.vy !== 0)) {
        p.vy -= PET_GRAVITY * dt;
        p.y += p.vy * dt;
        if (p.y <= 0 && p.vy < 0) {
          // a hard landing kicks up sand
          if (p.vy < -420) chips(p.x + p.look.w / 2, fxH - 4, ['#fdf6e8', '#eadfc8', '#ffffff'], 5, 0.4);
          p.y = 0;
          p.vy = 0;
        }
      }
      if (p.y === 0 && p.held <= 0) {
        if (p.idle > 0) {
          p.idle -= dt;
          if (p.idle <= 0) p.target = rand(8, Math.max(9, W - p.look.w - 8));
        } else {
          const dx = p.target - p.x;
          const step = p.look.speed * dt;
          if (Math.abs(dx) <= step) {
            p.x = p.target;
            p.idle = rand(1, 3.5);
          } else {
            p.dir = dx > 0 ? 1 : -1;
            p.x += p.dir * step;
            p.clock += dt;
            frame = Math.floor(p.clock * PET_FPS) % p.look.frames;
          }
        }
      } else {
        frame = 1; // legs out, in the air
      }
    }
    p.x = clamp(p.x, 0, Math.max(0, W - p.look.w));
    const shown = `translate3d(${snap(p.x)}px, ${-snap(p.y)}px, 0) scaleX(${p.dir})`;
    if (shown !== p.shown) {
      p.el.style.transform = shown;
      p.shown = shown;
    }
    if (frame !== p.frame) {
      p.el.style.backgroundPosition = `${-frame * p.look.w}px 0`;
      p.frame = frame;
    }
  });
}

// a pat on the head: a hop and a heart
walkersLayer.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.pet');
  const p = el && walkers.find((w) => w.el === el);
  if (!p) return;
  if (p.y === 0 && p.held <= 0 && !reduceMotion) p.vy = Math.sqrt(2 * PET_GRAVITY * 20);
  const r = el.getBoundingClientRect();
  heart(r.left + r.width / 2, r.top);
  unlock('pat');
});

// ---------- the shop: everything in it is for looks ----------
const SHOP = [
  { id: 'pickaxe_gold', kind: 'tool', name: 'Gold Pickaxe', price: 0, note: 'The one you came in with.' },
  { id: 'axe_gold', kind: 'tool', name: 'Gold Axe', price: 10, note: 'Made for trees. Works on headings too.' },
  { id: 'pickaxe_ruby', kind: 'tool', name: 'Ruby Pickaxe', price: 18, note: 'Red, sharp and a little smug.' },
  { id: 'scythe_ruby', kind: 'tool', name: 'Ruby Scythe', price: 25, note: 'Harvests paragraphs.' },
  { id: 'pickaxe_onix', kind: 'tool', name: 'Onyx Pickaxe', price: 35, note: 'Black as the rock it was cut from.' },
  { id: 'pickaxe_diamond', kind: 'tool', name: 'Diamond Pickaxe', price: 50, note: 'The last pickaxe on the island.' },

  { id: 'none', kind: 'trail', name: 'No Trail', price: 0, note: 'Just the cursor.' },
  { id: 'sparkle', kind: 'trail', name: 'Sparkles', price: 10, note: 'Gold and white glitter.' },
  { id: 'leaves', kind: 'trail', name: 'Falling Leaves', price: 12, note: 'Shaken off the island\'s trees.' },
  { id: 'bubbles', kind: 'trail', name: 'Bubbles', price: 12, note: 'Straight up out of the lagoon.' },
  { id: 'snow', kind: 'trail', name: 'Snowfall', price: 15, note: 'Brought back from the snowy island.' },
  { id: 'hearts', kind: 'trail', name: 'Hearts', price: 18, note: 'For a cursor in love.' },
  { id: 'fire', kind: 'trail', name: 'Embers', price: 22, note: 'Hot off the forge.' },
  { id: 'ribbon', kind: 'trail', name: 'Rainbow Ribbon', price: 28, note: 'A stripe of every colour.' },
  { id: 'ooze', kind: 'trail', name: 'Purple Ooze', price: 32, note: 'The corruption, dripping. It washes off.' },
  { id: 'ghost', kind: 'trail', name: 'Ghost Hands', price: 40, note: 'The hand, a few times over.' },

  { id: 'chick', kind: 'pet', name: 'Chick', price: 8, note: 'Walks along the bottom of your screen.' },
  { id: 'duck', kind: 'pet', name: 'Duck', price: 10, note: 'Waddles. Mostly waddles.' },
  { id: 'pig', kind: 'pet', name: 'Pig', price: 15, note: 'Came for the scrolling, stayed for the snacks.' },
  { id: 'sheep', kind: 'pet', name: 'Sheep', price: 15, note: 'Fluffy, slow and very sure of itself.' },
  { id: 'miner', kind: 'pet', name: 'Miner', price: 25, note: 'Off duty. Still wearing the helmet.' },
  { id: 'lumberjack', kind: 'pet', name: 'Lumberjack', price: 25, note: 'Looking for a tree that is not on a website.' },
  { id: 'slime', kind: 'pet', name: 'Slime', price: 35, note: 'From the nests. This one is friendly. Probably.' },

  { id: 'night', kind: 'lagoon', name: 'Night Swim', price: 0, note: 'The lagoon after dark, glittering.' },
  { id: 'day', kind: 'lagoon', name: 'Blue Lagoon', price: 10, note: 'Clear daytime water, a few gulls.' },
  { id: 'turquoise', kind: 'lagoon', name: 'Turquoise Lagoon', price: 15, note: 'The water from the game\'s title screen.' },
  { id: 'sunset', kind: 'lagoon', name: 'Sunset', price: 30, note: 'The hour the villagers walk home.' },

  { id: 'flock', kind: 'fx', name: 'Gull Flock', price: 8, note: 'Six more gulls over the lagoon.' },
  { id: 'rainbow', kind: 'fx', name: 'Rainbow Chips', price: 20, note: 'Everything you hit bleeds colours.' },
];
const ITEMS = Object.fromEntries(SHOP.map((it) => [it.id, it]));
const TABS = [['tool', 'Tools'], ['trail', 'Trails'], ['pet', 'Friends'], ['lagoon', 'Lagoon'], ['fx', 'Effects']];
// a tool, a trail and a lagoon are worn one at a time; a friend or an effect is switched on and off
const WORN = { tool: 'pickaxe_gold', trail: 'none', lagoon: 'night' };

const looks = (() => {
  const saved = store.get('brs-shop', null);
  const out = { owned: {}, on: {}, ...WORN };
  if (saved && typeof saved === 'object') {
    if (saved.owned && typeof saved.owned === 'object') out.owned = saved.owned;
    if (saved.on && typeof saved.on === 'object') out.on = saved.on;
    Object.keys(WORN).forEach((kind) => {
      if (ITEMS[saved[kind]] && ITEMS[saved[kind]].kind === kind) out[kind] = saved[kind];
    });
  }
  return out;
})();

function owns(it) { return it.price === 0 || !!looks.owned[it.id]; }
function worn(it) { return it.kind in WORN ? looks[it.kind] === it.id : !!looks.on[it.id]; }
function effectOn(id) { return !!looks.on[id] && !!looks.owned[id]; }
function saveLooks() { store.set('brs-shop', looks); }

function applyLooks(changed) {
  if (!changed || changed === 'tool') {
    tool.style.backgroundImage = `url("assets/sprites/${owns(ITEMS[looks.tool]) ? looks.tool : WORN.tool}.png")`;
  }
  if (!changed || changed === 'lagoon' || changed === 'fx') {
    hero.dataset.lagoon = owns(ITEMS[looks.lagoon]) ? looks.lagoon : WORN.lagoon;
    buildLagoon();
  }
  if (!changed || changed === 'pet') buildWalkers();
  if (changed === 'trail') trailFrom = null;
}

let shopOpen = false;
let shopTab = 'tool';
let shopReturn = null;
let shopTold = !!store.get('brs-shop-told', 0);

function tellAboutShop() {
  if (shopTold || !SHOP.some((it) => !owns(it) && gold >= it.price)) return;
  shopTold = true;
  store.set('brs-shop-told', 1);
  toast('The shop is open', 'Spend your gold', 'Click your purse at the top of the page.');
}

// ---------- "NEW": things the purse has only just come to afford ----------
// Marked on the purse, on their tab and on their card, until the visitor has looked at them.
const seen = store.get('brs-shop-seen', {}) || {};
const looking = new Set();
let newsShown = 0;

function isNew(it) {
  return it.price > 0 && !owns(it) && !seen[it.id] && gold >= it.price;
}

function showNews() {
  const fresh = SHOP.filter(isNew).length;
  newBadge.hidden = !fresh;
  newBadge.textContent = fresh > 1 ? `${fresh} NEW` : 'NEW';
  if (fresh > newsShown) pop(newBadge);
  newsShown = fresh;
}

// what was new on the tab just looked at is not new any more
function markSeen() {
  if (!looking.size) return;
  looking.forEach((id) => { seen[id] = 1; });
  looking.clear();
  store.set('brs-shop-seen', seen);
  showNews();
}

function openShop() {
  if (shopOpen) return;
  shopOpen = true;
  shopReturn = document.activeElement;
  shop.hidden = false;
  root.classList.add('shop-open');
  sizeFx();
  pointer.over = null;
  pointerStale = true;
  if (!shopTold) { shopTold = true; store.set('brs-shop-told', 1); }
  // open on the first tab with something new on it
  const fresh = SHOP.find(isNew);
  if (fresh) shopTab = fresh.kind;
  renderShop();
  shop.querySelector('.shop-close').focus();
}

function closeShop() {
  if (!shopOpen) return;
  shopOpen = false;
  shop.hidden = true;
  root.classList.remove('shop-open');
  markSeen();
  sizeFx();
  pointerStale = true;
  if (shopReturn && shopReturn.focus) shopReturn.focus();
}

purse.addEventListener('click', openShop);
shop.querySelector('.shop-close').addEventListener('click', closeShop);
shop.addEventListener('click', (e) => { if (e.target === shop) closeShop(); });
document.addEventListener('keydown', (e) => {
  if (!shopOpen) return;
  if (e.key === 'Escape') { e.preventDefault(); closeShop(); return; }
  if (e.key !== 'Tab') return;
  // keep the keyboard inside the shop while it is open
  const stops = [...shop.querySelectorAll('button:not([disabled])')];
  if (!stops.length) return;
  const first = stops[0];
  const lastStop = stops[stops.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastStop.focus(); }
  else if (!e.shiftKey && document.activeElement === lastStop) { e.preventDefault(); first.focus(); }
});

function renderShop() {
  shopTabs.textContent = '';
  TABS.forEach(([kind, title]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shop-tab';
    b.setAttribute('role', 'tab');
    b.dataset.kind = kind;
    b.setAttribute('aria-selected', String(kind === shopTab));
    b.innerHTML = '<span></span><small></small><b class="new-dot" hidden>NEW</b>';
    b.firstChild.textContent = title;
    b.addEventListener('click', () => {
      markSeen();
      shopTab = kind;
      renderShop();
      shopTabs.querySelector('[aria-selected="true"]').focus();
    });
    shopTabs.appendChild(b);
  });
  shopGrid.textContent = '';
  shopGrid.scrollTop = 0;
  SHOP.filter((it) => it.kind === shopTab).forEach((it) => shopGrid.appendChild(card(it)));
  refreshShop();
}

function card(it) {
  const c = document.createElement('article');
  c.className = 'card';
  c.dataset.id = it.id;
  c.innerHTML = '<b class="new" hidden>NEW</b><div class="pv"></div><h3></h3><p></p><button class="buy" type="button"></button>';
  preview(c.querySelector('.pv'), it);
  c.querySelector('h3').textContent = it.name;
  c.querySelector('p').textContent = it.note;
  c.querySelector('.buy').addEventListener('click', (e) => act(it, c, e.currentTarget));
  return c;
}

function preview(pv, it) {
  const add = (cls, style, tag = 'i') => {
    const el = document.createElement(tag);
    el.className = cls;
    if (style) Object.assign(el.style, style);
    pv.appendChild(el);
    return el;
  };
  if (it.kind === 'tool') {
    add('pv-tool', { backgroundImage: `url("assets/sprites/${it.id}.png")` });
  } else if (it.kind === 'trail') {
    pv.classList.add('dark');
    drawTrailPreview(add('pv-trail', null, 'canvas'), it.id);
  } else if (it.kind === 'lagoon') {
    const tile = it.id === 'day' ? 'water.png' : `water_${it.id}.png`;
    add('pv-lagoon', { backgroundImage: `url("assets/${tile}")` });
    add('gull');
  } else if (it.kind === 'pet') {
    const look = WALKERS[it.id];
    add('pv-sand');
    const el = add('pet-pv', {
      width: look.w + 'px', height: look.h + 'px', marginLeft: -look.w / 2 + 'px',
      backgroundImage: `url("assets/sprites/pet_${it.id}.png")`,
      backgroundSize: `${look.w * look.frames}px ${look.h}px`,
    });
    if (el.animate && !reduceMotion) {
      el.animate([{ backgroundPosition: '0 0' }, { backgroundPosition: `${-look.w * look.frames}px 0` }],
        { duration: look.frames / PET_FPS * 1000, iterations: Infinity, easing: `steps(${look.frames})` });
    }
  } else if (it.id === 'rainbow') {
    const row = add('pv-rainbow');
    RAINBOW.slice(0, 6).forEach((colour) => {
      const b = document.createElement('b');
      b.style.background = colour;
      row.appendChild(b);
    });
  } else if (it.id === 'flock') {
    const row = add('pv-flock');
    for (let i = 0; i < 3; i++) {
      const g = document.createElement('i');
      g.className = 'gull';
      if (i === 1) g.style.backgroundPosition = '-28px 0';
      row.appendChild(g);
    }
  }
}

// A trail drawn once along a curve, fading in towards the hand at its end, with the same
// pieces the cursor will drop.
function drawTrailPreview(canvas, id) {
  if (!handImage.complete || !handImage.naturalWidth) {
    handImage.addEventListener('load', () => drawTrailPreview(canvas, id), { once: true });
    return;
  }
  const W = 168;
  const H = 84;
  const k = fxScale;
  canvas.width = Math.round(W * k);
  canvas.height = Math.round(H * k);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(k, k);
  ctx.imageSmoothingEnabled = false;
  const along = (t) => ({ x: 14 + t * 124, y: 44 + Math.sin(t * Math.PI * 2) * 16 });
  const trail = TRAILS[id];
  if (trail) {
    const count = trail.step ? 22 : 11;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const at = along(t);
      const p = trail.make(at.x, at.y, i);
      p.life = 0;
      drawParticle(ctx, p, 0.3 + 0.7 * t);
    }
  }
  const end = along(1);
  ctx.globalAlpha = 1;
  ctx.drawImage(handImage, end.x - 4, end.y - 4, 36, 34);
}

// Brings every card's button and badge up to date. A button is only rewritten when what it
// says changes, so a breathing button keeps breathing while gold keeps landing.
function refreshShop() {
  if (!shopOpen) return;
  shopGrid.querySelectorAll('.card').forEach((c) => {
    const it = ITEMS[c.dataset.id];
    if (isNew(it)) looking.add(it.id);
    c.querySelector('.new').hidden = !(looking.has(it.id) && !owns(it));
    const b = c.querySelector('.buy');
    if (b.classList.contains('nope')) return;
    const have = owns(it);
    const on = have && worn(it);
    const oneAtATime = it.kind in WORN;
    let state;
    if (!have) state = gold >= it.price ? 'affordable' : 'short';
    else if (oneAtATime) state = on ? 'equipped' : 'owned';
    else state = on ? 'on' : 'off';
    c.classList.toggle('equipped', on);
    if (b.dataset.state === state) return;
    b.dataset.state = state;
    b.className = 'buy';
    b.disabled = false;
    b.removeAttribute('aria-pressed');
    if (!have) {
      b.innerHTML = '<img src="assets/sprites/gold.png" alt=""><span></span>';
      b.lastChild.textContent = it.price;
      b.setAttribute('aria-label', `Buy ${it.name} for ${it.price} gold`);
      b.classList.add(state);
    } else {
      b.removeAttribute('aria-label');
      if (oneAtATime) {
        b.textContent = on ? 'In use' : 'Use';
        b.disabled = on;
        b.classList.add('owned');
      } else {
        b.textContent = on ? 'On' : 'Off';
        b.setAttribute('aria-pressed', String(on));
        b.classList.add(on ? 'on' : 'owned');
      }
    }
  });
  shopTabs.querySelectorAll('.shop-tab').forEach((t) => {
    const items = SHOP.filter((it) => it.kind === t.dataset.kind);
    t.querySelector('small').textContent = `${items.filter(owns).length}/${items.length}`;
    t.querySelector('.new-dot').hidden = !items.some(isNew);
  });
}

function act(it, c, b) {
  const r = b.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;

  if (!owns(it)) {
    if (gold < it.price) {
      // too poor: a red shake and the shortfall
      b.classList.remove('nope');
      void b.offsetWidth;
      b.classList.add('nope');
      floatText(`Need ${it.price - gold} more`, cx, cy, '#ff8a8a', 18);
      setTimeout(() => { b.classList.remove('nope'); b.dataset.state = ''; refreshShop(); }, 320);
      return;
    }
    gold -= it.price;
    saveGold();
    looks.owned[it.id] = 1;
    wear(it, true);
    showGold();
    pop(shopBalance);

    // the bang: a burst off the button, the price flying off, the panel jolted
    chips(cx, cy, ['#ffcb40', '#e87838', '#ffffff', '#fff3b0'], 22, 1.2);
    floatText(`-${it.price}`, cx, cy - 10, '#ff8a8a', 24);
    c.classList.remove('flash');
    void c.offsetWidth;
    c.classList.add('flash');
    if (!reduceMotion) {
      shopPanel.classList.remove('shake');
      void shopPanel.offsetWidth;
      shopPanel.classList.add('shake');
    }
    const status = it.kind === 'pet' ? 'Walking along the bottom of your screen.'
      : it.kind === 'trail' ? 'Move your cursor.'
        : it.kind in WORN ? 'Now in use.' : 'Switched on.';
    toast('Bought', it.name, status);
    unlock('shopper');
    if (SHOP.every(owns)) unlock('collector');
  } else if (it.kind in WORN) {
    wear(it, true);
    chips(cx, cy, ['#ffffff', '#ffcb40'], 8, 0.8);
  } else {
    wear(it, !worn(it));
    chips(cx, cy, worn(it) ? ['#5cc14a', '#ffffff'] : ['#c9c2d1'], 8, 0.8);
  }
  refreshShop();
}

function wear(it, on) {
  if (it.kind in WORN) looks[it.kind] = it.id;
  else if (on) looks.on[it.id] = 1;
  else delete looks.on[it.id];
  saveLooks();
  applyLooks(it.kind);
}

// ---------- clips play only while on screen ----------
const clips = document.querySelectorAll('.frame video');
if (!reduceMotion && 'IntersectionObserver' in window) {
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target;
      const n = nodes.get(video.parentElement);
      video.dataset.inView = entry.isIntersecting ? '1' : '';
      if (entry.isIntersecting && !(n && n.broken)) video.play().catch(() => {});
      else video.pause();
    }
  }, { threshold: 0.35 });
  clips.forEach((video) => watcher.observe(video));
} else {
  clips.forEach((video) => { video.controls = true; });
}

// ---------- screenshots, full size ----------
const box = document.querySelector('.lightbox');
const boxImg = box.querySelector('img');
document.querySelectorAll('.zoom').forEach((zoom) => {
  zoom.addEventListener('click', () => {
    boxImg.src = zoom.dataset.full;
    boxImg.alt = zoom.parentElement.querySelector('img').alt;
    box.showModal();
  });
});
box.querySelector('.close').addEventListener('click', () => box.close());
box.addEventListener('click', (e) => { if (e.target === box) box.close(); });

document.getElementById('year').textContent = new Date().getFullYear();

// ---------- start ----------
document.querySelectorAll('video[poster]').forEach(posterOf);
sizeFx();
applyLooks();
showGold();
if (document.fonts) {
  document.fonts.ready.then(() => {
    labels.clear();
    measureLagoon();
    placeLagoon(true);
  });
}
requestAnimationFrame(tick);
