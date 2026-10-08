'use strict';

/*
 * Everything marked data-break on this page is a resource node, as on an island:
 * hit it, it squashes and cracks and its health bar drops; break it, it flies apart,
 * drops gold and grows back a few seconds later. Links never break - they go somewhere.
 *
 * One requestAnimationFrame loop drives all of it (the pointer, the swing, every node's
 * squash and every flying chip), the same way the game runs its effects from one place
 * rather than one timer per thing.
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

const finePointer = matchMedia('(pointer: fine)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const fx = document.querySelector('.fx');
const tool = document.querySelector('.tool');
const main = document.querySelector('main');
const goldLabel = document.getElementById('gold');
const purse = document.querySelector('.purse');
const purseIcon = purse.querySelector('img');
const hint = document.getElementById('hint');
const root = document.documentElement;

// ---------- gold ----------
let gold = 0;
try { gold = parseInt(localStorage.getItem('brs-gold') || '0', 10) || 0; } catch (e) { /* private mode */ }
goldLabel.textContent = gold;

function addGold(amount) {
  gold += amount;
  goldLabel.textContent = gold;
  purse.classList.remove('pop');
  void purse.offsetWidth; // restart the pop
  purse.classList.add('pop');
  try { localStorage.setItem('brs-gold', String(gold)); } catch (e) { /* not kept, still counted */ }
  if (gold >= 25) unlock('pocket');
  if (gold >= 100) unlock('hoard');
}

// ---------- achievements ----------
const ACHIEVEMENTS = {
  first: ['Rock Bottom', 'Broke your first thing.'],
  crit: ['Lucky Swing', 'Landed a critical hit.'],
  logo: ['Rebrand', 'Broke the logo. It grows back.'],
  ten: ['Demolition Crew', 'Broke 10 things.'],
  pocket: ['Pocket Money', 'Swept up 25 gold.'],
  hoard: ['Dragon Hoard', 'Swept up 100 gold.'],
  all: ['You Broke the Website', 'Every single thing on this page, at least once.'],
};
const toasts = document.querySelector('.toasts');
let unlocked = {};
let brokenEver = new Set();
let breaks = 0;
try {
  unlocked = JSON.parse(localStorage.getItem('brs-achievements') || '{}');
  breaks = parseInt(localStorage.getItem('brs-breaks') || '0', 10) || 0;
} catch (e) { /* starts fresh */ }

function unlock(id) {
  if (unlocked[id] || !ACHIEVEMENTS[id]) return;
  unlocked[id] = 1;
  try { localStorage.setItem('brs-achievements', JSON.stringify(unlocked)); } catch (e) { /* this visit only */ }
  const [title, text] = ACHIEVEMENTS[id];
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = '<img src="assets/sprites/gold.png" alt=""><div><small>Achievement unlocked</small><b></b><span></span></div>';
  t.querySelector('b').textContent = title;
  t.querySelector('span').textContent = text;
  toasts.appendChild(t);
  setTimeout(() => t.classList.add('out'), 3600);
  setTimeout(() => t.remove(), 3900);
}

function countBreak(el) {
  breaks += 1;
  try { localStorage.setItem('brs-breaks', String(breaks)); } catch (e) { /* this visit only */ }
  brokenEver.add(el);
  unlock('first');
  if (el.classList.contains('logo-wrap')) unlock('logo');
  if (breaks >= 10) unlock('ten');
  if (brokenEver.size >= document.querySelectorAll('[data-break]').length) unlock('all');
}

// ---------- helpers ----------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const snap = (v) => Math.round(v);

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
  const P = 4;
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

// The colours flying off a node: what it is made of, read off the pixels struck.
const sampler = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
sampler.canvas.width = sampler.canvas.height = 1;

function chipColours(n, x, y) {
  if (n.kind === 'media') {
    const src = n.media;
    const r = src.getBoundingClientRect();
    const natW = src.videoWidth || src.naturalWidth;
    const natH = src.videoHeight || src.naturalHeight;
    const ready = src.tagName === 'VIDEO' ? src.readyState >= 2 : src.complete && natW > 0;
    if (ready && r.width > 0) {
      const colours = [];
      for (let i = 0; i < 4; i++) {
        const px = clamp(((x + rand(-12, 12)) - r.left) / r.width * natW, 0, natW - 1);
        const py = clamp(((y + rand(-12, 12)) - r.top) / r.height * natH, 0, natH - 1);
        try {
          sampler.clearRect(0, 0, 1, 1);
          sampler.drawImage(src, px, py, 1, 1, 0, 0, 1, 1);
          const d = sampler.getImageData(0, 0, 1, 1).data;
          if (d[3] > 0) colours.push(`rgb(${d[0]},${d[1]},${d[2]})`);
        } catch (e) { break; }
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

// ---------- particles ----------
const particles = [];

function spawn(el, x, y, vx, vy, opts = {}) {
  fx.appendChild(el);
  const p = {
    el, x, y, vx, vy,
    rot: opts.rot || 0,
    spin: opts.spin || 0,
    life: 0,
    max: opts.max || 0.6,
    gravity: opts.gravity === undefined ? GRAVITY : opts.gravity,
    fade: opts.fade === undefined ? 0.25 : opts.fade,
    floor: opts.floor,
    kind: opts.kind || 'chip',
  };
  particles.push(p);
  place(p);
  return p;
}

function place(p) {
  // spin in 15 degree steps so pieces tumble like sprites rather than smear
  const r = p.spin ? Math.round(p.rot / 15) * 15 : 0;
  p.el.style.transform = `translate3d(${snap(p.x)}px, ${snap(p.y)}px, 0)` + (r ? ` rotate(${r}deg)` : '');
}

function chips(x, y, colours, count, power) {
  for (let i = 0; i < count; i++) {
    const c = document.createElement('div');
    c.className = 'chip';
    const size = Math.random() < 0.3 ? 12 : 8;
    c.style.width = c.style.height = size + 'px';
    c.style.background = colours[i % colours.length];
    const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
    const s = rand(260, 560) * power;
    spawn(c, x - size / 2, y - size / 2, Math.cos(a) * s, Math.sin(a) * s, { max: rand(0.35, 0.6) });
  }
}

function floatText(text, x, y) {
  const t = document.createElement('div');
  t.className = 'plus';
  t.textContent = text;
  spawn(t, x - 20, y - 30, rand(-30, 30), -260, { gravity: 500, max: 0.7, fade: 0.3 });
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
  if (n.canvas) n.canvas.getContext('2d').clearRect(0, 0, n.canvas.width, n.canvas.height);
  if (n.bar) n.bar.style.display = 'none';
  if (n.media && n.media.tagName === 'VIDEO') n.media.pause();

  n.broken = true;
  n.respawnIn = RESPAWN_SECONDS;
  n.squash = n.shake = n.flash = 0;
  if (!reduceMotion) shakeScreen = Math.max(shakeScreen, 0.22);

  if (!firstBreakDone && hint) {
    firstBreakDone = true;
    hint.textContent = 'It all grows back. Keep swinging.';
    setTimeout(() => hint.classList.add('done'), 3500);
  }
}

const posters = new Map();
document.querySelectorAll('video[poster]').forEach((v) => {
  const im = new Image();
  im.src = v.poster;
  posters.set(v, im);
});

function shatterPicture(n, r, x, y) {
  const el = n.el;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const snapCanvas = document.createElement('canvas');
  snapCanvas.width = w;
  snapCanvas.height = h;
  const ctx = snapCanvas.getContext('2d');
  const bg = getComputedStyle(el).backgroundColor;
  if (bg && bg !== 'rgba(0, 0, 0, 0)') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  const m = n.media;
  let src = m;
  let natW = m.videoWidth || m.naturalWidth;
  if (m.tagName === 'VIDEO' && m.readyState < 2) {
    src = posters.get(m);
    natW = src ? src.naturalWidth : 0;
  }
  if (src && natW > 0) {
    ctx.imageSmoothingEnabled = m.offsetWidth < natW;
    try {
      ctx.drawImage(src, el.clientLeft + m.offsetLeft, el.clientTop + m.offsetTop, m.offsetWidth, m.offsetHeight);
    } catch (e) { /* nothing to draw */ }
  }

  const cols = clamp(Math.round(w / 80), 3, 8);
  const rows = clamp(Math.round(h / 80), 2, 6);
  const tw = Math.ceil(w / cols);
  const th = Math.ceil(h / rows);
  const cx = x - r.left;
  const cy = y - r.top;
  const sx = r.width / (w || 1);
  const sy = r.height / (h || 1);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const piece = document.createElement('canvas');
      piece.className = 'piece';
      piece.width = tw;
      piece.height = th;
      piece.getContext('2d').drawImage(snapCanvas, col * tw, row * th, tw, th, 0, 0, tw, th);
      piece.style.width = tw * sx + 'px';
      piece.style.height = th * sy + 'px';
      const px = r.left + col * tw * sx;
      const py = r.top + row * th * sy;
      const dx = px + tw * sx / 2 - (r.left + cx);
      const dy = py + th * sy / 2 - (r.top + cy);
      const d = Math.hypot(dx, dy) || 1;
      const push = rand(220, 520);
      spawn(piece, px, py, dx / d * push + rand(-60, 60), dy / d * push - rand(380, 700), {
        spin: rand(-540, 540), max: rand(0.8, 1.15), fade: 0.35,
      });
    }
  }
}

function shatterWords(n, x, y) {
  const el = n.el;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) => (t.textContent.trim() && !t.parentElement.closest('.hp')
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const range = document.createRange();
  let node;
  while ((node = walker.nextNode())) {
    const cs = getComputedStyle(node.parentElement);
    const text = node.textContent;
    const words = /\S+/g;
    let m;
    while ((m = words.exec(text))) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rect = range.getClientRects()[0];
      if (!rect) continue;
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = m[0];
      span.style.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      span.style.lineHeight = rect.height + 'px';
      span.style.color = cs.color;
      span.style.textShadow = cs.textShadow;
      span.style.letterSpacing = cs.letterSpacing;
      const dx = rect.left + rect.width / 2 - x;
      const dy = rect.top + rect.height / 2 - y;
      const d = Math.hypot(dx, dy) || 1;
      const push = rand(160, 420);
      spawn(span, rect.left, rect.top, dx / d * push + rand(-50, 50), dy / d * push * 0.5 - rand(300, 620), {
        spin: rand(-420, 420), max: rand(0.8, 1.2), fade: 0.35,
      });
    }
  }
}

// ---------- gold ----------
const coins = [];

function dropGold(n, x, y) {
  const count = clamp(1 + Math.round(n.maxHp / 2), 2, 5);
  for (let i = 0; i < count; i++) {
    const c = document.createElement('img');
    c.className = 'coin';
    c.src = 'assets/sprites/gold.png';
    c.alt = '';
    const p = spawn(c, x - 16, y - 16, rand(-260, 260), rand(-720, -420), {
      max: Infinity, fade: 0, floor: y + rand(10, 70) - 16,
    });
    p.kind = 'coin';
    p.rest = rand(1.0, 1.6);
    p.homing = false;
    coins.push(p);
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
  if (finePointer && pointer.inside && Math.hypot(pointer.x - cx, pointer.y - cy) < MAGNET_RADIUS && p.life > 0.25) {
    return { x: pointer.x, y: pointer.y };
  }
  if (p.homing || p.life > p.rest) {
    p.homing = true;
    const r = purseIcon.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return null;
}

// ---------- pointer ----------
const pointer = { x: -999, y: -999, down: false, inside: false, over: null, justPressed: false };
let holdTimer = 0;
let bend = 0;
let pressLatch = 0;
let shownPose = 0;

function breakableAt(target) {
  if (!target || !target.closest) return null;
  if (target.closest('a, button, input, textarea, select, summary, dialog')) return null;
  const el = target.closest('[data-break]');
  return el && !el.classList.contains('broken') ? el : null;
}

window.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inside = true;
  pointer.over = breakableAt(e.target);
}, { passive: true });

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
});
window.addEventListener('pointerup', () => { pointer.down = false; });
window.addEventListener('pointercancel', () => { pointer.down = false; });
document.addEventListener('dragstart', (e) => { if (breakableAt(e.target)) e.preventDefault(); });

window.addEventListener('resize', () => {
  nodes.forEach((n) => {
    if (n.canvas && !n.broken) ensureOverlay(n);
  });
});

// ---------- the one loop ----------
let last = performance.now();

function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  updatePointer(dt);
  updateNodes(dt);
  updateParticles(dt);
  updateScreenShake(dt);

  requestAnimationFrame(tick);
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

  // scrolling slides the page under a still pointer
  if (pointer.inside) {
    const under = document.elementFromPoint(pointer.x, pointer.y);
    pointer.over = breakableAt(under);
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
    tool.style.display = 'block';
    tool.style.backgroundPosition = `${-frame * TOOL_W}px 0`;
    tool.style.transform = `translate3d(${snap(pointer.x - ANCHOR_X)}px, ${snap(pointer.y - ANCHOR_Y)}px, 0)`;
  } else {
    tool.style.display = 'none';
    sinceSwing = Infinity; // leaving the work ends the blow with it
  }
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

    el.style.transform = tx || ty || sx !== 1 || sy !== 1
      ? `translate(${tx}px, ${ty}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`
      : '';

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
      alive = p.life < p.max;
      const left = p.max - p.life;
      if (p.fade > 0 && left < p.fade) p.el.style.opacity = String(Math.max(0, left / p.fade));
    }
    if (!alive) {
      p.el.remove();
      particles.splice(i, 1);
      continue;
    }
    place(p);
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

requestAnimationFrame(tick);

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
