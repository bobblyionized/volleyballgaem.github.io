/* =====================================================================
   2D WORLD: canvas, camera, day / night, 2D rig, balls, the dynamic net, scenery, effects, icons
   ===================================================================== */
/* The game is a side view: x runs along the court (the net is at x = 0 in a match), y is up, both in metres.
   Everything is drawn with the plain Canvas 2D API in a soft, flat, pastel style. */
const canvas = $('#c');
const ctx = canvas.getContext('2d', { alpha: false });
let C = ctx;                                          // the context every draw helper paints into (swapped to render icons)
let VW = innerWidth, VH = innerHeight, DPR = 1, PIX_CAP = 1.5;
const CAM = { x: 0, y: 4, s: 50 };
let shakeX = 0, shakeY = 0;
function resize() {
  VW = innerWidth; VH = innerHeight; DPR = Math.min(window.devicePixelRatio || 1, PIX_CAP);
  canvas.width = Math.max(1, Math.round(VW * DPR)); canvas.height = Math.max(1, Math.round(VH * DPR));
  canvas.style.width = VW + 'px'; canvas.style.height = VH + 'px';
}
addEventListener('resize', resize); resize();
function worldTf() { const s = CAM.s * DPR; C.setTransform(s, 0, 0, -s, DPR * (VW / 2 + shakeX) - CAM.x * s, DPR * (VH / 2 + shakeY) + CAM.y * s); }
function screenTf() { C.setTransform(DPR, 0, 0, DPR, 0, 0); }
const toSX = x => (x - CAM.x) * CAM.s + VW / 2 + shakeX, toSY = y => VH / 2 - (y - CAM.y) * CAM.s + shakeY;
const viewX0 = () => CAM.x - VW / 2 / CAM.s, viewX1 = () => CAM.x + VW / 2 / CAM.s;
const viewY0 = () => CAM.y - VH / 2 / CAM.s, viewY1 = () => CAM.y + VH / 2 / CAM.s;
const onScreen = (x0, x1, pad = 2) => x1 > viewX0() - pad && x0 < viewX1() + pad;

/* ---- colour helpers (memoised: the same few hundred mixes are asked for every frame) ---- */
const COL_MEMO = new Map();
function hexToRgb(h) {
  if (Array.isArray(h)) return h;
  if (typeof h === 'number') return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  if (h[0] === 'r') { const m = h.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2]]; }
  let s = h.replace('#', ''); if (s.length === 3) s = s.split('').map(c => c + c).join('');
  const n = parseInt(s, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbStr = (r, g, b, a = 1) => a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${+a.toFixed(3)})`;
function memo(key, fn) { let v = COL_MEMO.get(key); if (v === undefined) { v = fn(); if (COL_MEMO.size > 4000) COL_MEMO.clear(); COL_MEMO.set(key, v); } return v; }
function mix(a, b, t) { t = clamp(t, 0, 1); return memo('m' + a + b + t.toFixed(3), () => { const A = hexToRgb(a), B = hexToRgb(b); return rgbStr(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }); }
function shade(c, k) { return memo('s' + c + k, () => { const A = hexToRgb(c); return k >= 0 ? rgbStr(A[0] + (255 - A[0]) * k, A[1] + (255 - A[1]) * k, A[2] + (255 - A[2]) * k) : rgbStr(A[0] * (1 + k), A[1] * (1 + k), A[2] * (1 + k)); }); }
function alpha(c, a) { return memo('a' + c + a, () => { const A = hexToRgb(c); return rgbStr(A[0], A[1], A[2], a); }); }
const hexStr = n => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);

/* ---- path helpers (all in whatever transform is current) ---- */
function rrPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  C.beginPath(); C.moveTo(x + r, y); C.lineTo(x + w - r, y); C.arcTo(x + w, y, x + w, y + r, r); C.lineTo(x + w, y + h - r); C.arcTo(x + w, y + h, x + w - r, y + h, r);
  C.lineTo(x + r, y + h); C.arcTo(x, y + h, x, y + h - r, r); C.lineTo(x, y + r); C.arcTo(x, y, x + r, y, r); C.closePath();
}
function rr(x, y, w, h, r, fill, stroke, lw) { rrPath(x, y, w, h, r); if (fill) { C.fillStyle = fill; C.fill(); } if (stroke) { C.strokeStyle = stroke; C.lineWidth = lw || 0.04; C.stroke(); } }
function rect(x, y, w, h, fill) { C.fillStyle = fill; C.fillRect(x, y, w, h); }
function circle(x, y, r, fill, stroke, lw) { C.beginPath(); C.arc(x, y, Math.max(0.0001, r), 0, TAU); if (fill) { C.fillStyle = fill; C.fill(); } if (stroke) { C.strokeStyle = stroke; C.lineWidth = lw || 0.04; C.stroke(); } }
function ellipse(x, y, rx, ry, rot, fill, stroke, lw) { C.beginPath(); C.ellipse(x, y, Math.max(0.0001, rx), Math.max(0.0001, ry), rot || 0, 0, TAU); if (fill) { C.fillStyle = fill; C.fill(); } if (stroke) { C.strokeStyle = stroke; C.lineWidth = lw || 0.04; C.stroke(); } }
function poly(pts, fill, stroke, lw) { C.beginPath(); C.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) C.lineTo(pts[i], pts[i + 1]); C.closePath(); if (fill) { C.fillStyle = fill; C.fill(); } if (stroke) { C.strokeStyle = stroke; C.lineWidth = lw || 0.04; C.lineJoin = 'round'; C.stroke(); } }
function line(x1, y1, x2, y2, color, w, cap = 'round') { C.beginPath(); C.moveTo(x1, y1); C.lineTo(x2, y2); C.strokeStyle = color; C.lineWidth = w; C.lineCap = cap; C.stroke(); }
function seg(x1, y1, x2, y2, w, color, outline) {            // a chunky limb: a darker rim, then the fill
  C.lineCap = 'round';
  if (outline !== false) { C.beginPath(); C.moveTo(x1, y1); C.lineTo(x2, y2); C.strokeStyle = outline || shade(color, -0.28); C.lineWidth = w + 0.045; C.stroke(); }
  C.beginPath(); C.moveTo(x1, y1); C.lineTo(x2, y2); C.strokeStyle = color; C.lineWidth = w; C.stroke();
}
/* text placed in the world but drawn crisp in screen space */
function worldText(str, x, y, size, color, weight = '900', align = 'center', italic = false, maxW = 0) {
  C.save(); screenTf(); const px = Math.max(6, size * CAM.s);
  C.font = `${italic ? 'italic ' : ''}${weight} ${px.toFixed(1)}px Montserrat, Arial`; C.textAlign = align; C.textBaseline = 'middle'; C.fillStyle = color;
  let sx = 1; if (maxW) { const w = C.measureText(str).width, mw = maxW * CAM.s; if (w > mw) sx = mw / w; }
  C.translate(toSX(x), toSY(y)); C.scale(sx, 1); C.fillText(str, 0, 0); C.restore();
}
/* deterministic noise so scenery scatter never changes between frames or clients */
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

/* =====================================================================
   DAY / NIGHT (real Eastern time, or forced from Settings)
   ===================================================================== */
function estHours() {
  try { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date()); const g = t => +(p.find(x => x.type === t) || {}).value || 0; return (g('hour') % 24) + g('minute') / 60 + g('second') / 3600; }
  catch (e) { const d = new Date(); return (d.getUTCHours() + 19) % 24 + d.getUTCMinutes() / 60; }
}
const SKYP = {
  day:   { top: '#62b6ee', bot: '#cdeefb', sea: '#56b4d8', seaFar: '#9ad8ea', sun: '#fff6c9', cloud: '#ffffff', tint: [0, 0, 0, 0], sand: '#f4e3b5' },
  dusk:  { top: '#51619f', bot: '#ffc28e', sea: '#6c8ec4', seaFar: '#f0b491', sun: '#ffb36e', cloud: '#ffe0cc', tint: [255, 130, 70, 0.1], sand: '#f0d3a8' },
  night: { top: '#0e1640', bot: '#2d3d7c', sea: '#1e3668', seaFar: '#3a5596', sun: '#e8edff', cloud: '#5a6795', tint: [18, 26, 78, 0.42], sand: '#b9ae93' },
};
let PAL = Object.assign({}, SKYP.day), isNight = false, SUN = { u: 0.5, el: 1 };
let TOD = 'relative'; try { TOD = localStorage.getItem('vg_tod') || 'relative'; } catch (e) { }
function blendPal(a, b, k) { const o = {}; for (const key in a) o[key] = key === 'tint' ? a.tint.map((v, i) => v + (b.tint[i] - v) * k) : mix(a[key], b[key], k); return o; }
function updateDayNight() {
  const h = TOD === 'day' ? 12.5 : TOD === 'night' ? 1 : estHours(); const day = h >= 8 && h < 20; isNight = !day;
  const u = day ? (h - 8) / 12 : (((h - 20) + 24) % 24) / 12; const el = Math.sin(u * Math.PI); SUN = { u, el };
  PAL = day ? blendPal(SKYP.dusk, SKYP.day, clamp(el / 0.35, 0, 1)) : Object.assign({}, SKYP.night);
}
updateDayNight(); setInterval(updateDayNight, 15000);

/* =====================================================================
   2D RIG: a chunky, friendly character built from rounded limbs.
   Joint angles use the old 3D poses (converted to a side view): 0 = limb hanging straight down,
   positive = swung toward the way the character faces. The near arm (R) is the hitting arm.
   ===================================================================== */
const RIG = { hipY: 0.84, torso: 0.56, upArm: 0.31, foreArm: 0.29, thigh: 0.42, shin: 0.42, headR: 0.25 };
const JOINTS = ['spine', 'neck', 'shL', 'elL', 'shR', 'elR', 'hipL', 'knL', 'hipR', 'knR'];
const P2 = (spine, neck, shL, elL, shR, elR, hipL, knL, hipR, knR) => ({ spine, neck, shL, elL, shR, elR, hipL, knL, hipR, knR });
const POSES = {
  idle:        P2(0, 0, 4, 8, -4, 8, 0, 0, 0, 0),
  jumpUp:      P2(-6, -12, 150, 40, 150, 40, 10, -4, 10, -4),
  air:         P2(-12, -6, 120, 22, 168, 72, -34, -98, -34, -98),
  airDown:     P2(6, 4, 16, 28, 22, 28, -12, -32, -12, -32),
  land:        P2(18, -8, 38, 30, 38, 30, 34, -64, 34, -64),
  bump:        P2(20, -12, 60, 0, 60, 0, 28, -40, 28, -40),
  set:         P2(-2, -18, 118, 60, 118, 60, 8, -14, 8, -14),
  block:       P2(-3, -8, 172, 0, 172, 0, 8, -16, 8, -16),
  spikeCharge: P2(-18, -14, 146, 12, 178, 55, -42, -104, -42, -104),
  spikeHit:    P2(26, 12, 26, 34, 52, 16, 46, -22, 46, -22),
  tip:         P2(-3, -12, 65, 25, 160, 12, 18, -36, 18, -36),
  dive:        P2(0, -25, 100, 0, 100, 0, -6, -8, -6, -8),
  diveB:       P2(-10, -20, 150, 10, 150, 10, 35, -55, 35, -55),
  hold:        P2(0, 0, 75, 12, 0, 6, 0, 0, 0, 0),
  sit:         P2(-6, 4, 28, 58, 28, 58, 76, -76, 76, -76),
  lie:         P2(0, 6, 150, 20, 150, 20, 4, -10, 4, -10),
  dash:        P2(24, -14, -38, 24, -38, 24, 38, -30, -26, -52),
  toss:        P2(-4, -16, 160, 0, 15, 6, 0, 0, 0, 0),
};
const POSE_SNAP = { jumpUp: 22, land: 20, spikeCharge: 26, spikeHit: 32 };
const JERSEY2 = { black: { shirt: '#24252d', trim: '#d9b44a', shorts: '#1b1c22' }, white: { shirt: '#f6f6f3', trim: '#d4b45a', shorts: '#fbfbfb' } };
function lookFor(variant, model) {
  const j = JERSEY2[variant] || JERSEY2.white;
  const L = { skin: '#f3d1b0', hair: '#e8cf7a', hairTip: '#2a5fe0', style: 'boy', shirt: j.shirt, trim: j.trim, shorts: j.shorts, longSleeve: false, pants: false, shoe: '#26262e', hands: null, acc: [], size: [1, 1], hood: null, eye: '#27314d' };
  const who = variant === 'dealer' || variant === 'bigdealer' || variant === 'wdealer' ? variant : model;
  switch (who) {
    case 'girl': L.style = 'girl'; break;
    case 'dealer': Object.assign(L, { skin: '#6b4a30', style: 'none', shirt: '#17171b', trim: null, shorts: '#1d1d22', longSleeve: true, pants: true, hood: '#17171b', acc: ['cap', 'shades', 'chain'] }); break;
    case 'bigdealer': Object.assign(L, { skin: '#6b4a30', style: 'none', shirt: '#b3242a', trim: null, shorts: '#1a1a1a', longSleeve: true, pants: true, hood: '#b3242a', acc: ['cap', 'shades', 'chain', 'medallion', 'beard'], size: [1.14, 1.06] }); break;
    case 'wdealer': Object.assign(L, { style: 'girl', shirt: '#e0559a', trim: null, shorts: '#2a2a2a', longSleeve: true, pants: true, hood: '#e0559a', acc: ['shades', 'chain'] }); break;
    case 'tux': Object.assign(L, { style: 'slick', hair: '#161616', shirt: '#151519', trim: null, shorts: '#151519', longSleeve: true, pants: true, acc: ['tux'] }); break;
    case 'lifeguard': Object.assign(L, { skin: '#d9a878', hair: '#3b2a1a', style: 'short', shirt: '#e5342b', trim: null, shorts: '#e5342b', acc: ['cross', 'visor', 'whistle'] }); break;
    case 'surfer': Object.assign(L, { skin: '#e6b27f', hair: '#f2dc8a', style: 'long', shirt: '#16181c', trim: '#20c9b8', shorts: '#16181c', longSleeve: true, pants: true, acc: ['wetsuit', 'shadesUp'] }); break;
    case 'pirate': Object.assign(L, { skin: '#d5a57a', style: 'none', shirt: '#f4f4f4', trim: null, shorts: '#2b2b33', pants: true, acc: ['stripes', 'bandana', 'eyepatch', 'beard', 'belt'] }); break;
    case 'robot': Object.assign(L, { skin: '#aab4bd', style: 'none', shirt: '#b9c2cb', trim: null, shorts: '#8f99a3', longSleeve: true, pants: true, hands: '#6e7780', shoe: '#5b636b', acc: ['rvisor', 'antenna', 'panel'], metal: true }); break;
    case 'astronaut': Object.assign(L, { hair: '#5a3b22', style: 'short', shirt: '#f2f2f2', trim: '#ff7a1a', shorts: '#f2f2f2', longSleeve: true, pants: true, hands: '#f2f2f2', shoe: '#d8d8d8', acc: ['pack', 'helmet'] }); break;
  }
  if (!L.hands) L.hands = L.skin;
  return L;
}
function spring1(o, k, tg, w, dt) { const e = Math.exp(-w * dt); const x = o.c[k] - tg; const tmp = (o.v[k] + w * x) * dt; o.c[k] = tg + (x + tmp) * e; o.v[k] = (o.v[k] - w * tmp) * e; }
class Rig2D {
  constructor(variant = 'white', model = 'boy') {
    this.variant = variant; this.model = model; this.look = lookFor(variant, model);
    this.c = {}; this.v = {}; this.tg = {}; for (const k of JOINTS) { this.c[k] = 0; this.v[k] = 0; this.tg[k] = 0; }
    this.anim = 'idle'; this.animUntil = 0; this.base = 'idle'; this.moveSpeed = 0; this.runPhase = Math.random() * 6; this.runBlend = 0;
    this.squash = 0; this.squashV = 0; this.pitch = 0; this.pitchTarget = 0; this.bob = 0; this.emote = null; this.emoteT = 0;
    this.x = 0; this.y = 0; this.f = 1; this.grounded = true; this.drop = 0; this.seed = Math.random() * 100; this.blinkAt = 2 + Math.random() * 3;
    this.sk = null; this.setPose('idle'); this.snap();
  }
  setPose(name, until = 0) { this.anim = POSES[name] ? name : 'idle'; this.animUntil = until; }
  impact(v) { this.squashV += v * 9; }
  snap() { this.computeTargets(0, 0); for (const k of JOINTS) { this.c[k] = this.tg[k]; this.v[k] = 0; } this.skeleton(); }
  place(x, y, f, grounded) { this.x = x; this.y = y; if (f) this.f = f; this.grounded = grounded; }
  computeTargets(dt, t) {
    const p = POSES[this.anim] || POSES.idle; const tg = this.tg;
    for (const k of JOINTS) tg[k] = p[k] * D;
    const run = this.anim === 'idle' && this.moveSpeed > 0.4 && !this.emote && this.grounded;
    this.runBlend += ((run ? 1 : 0) - this.runBlend) * smoothT(10, dt || 1);
    if (run) this.runPhase += dt * (5 + this.moveSpeed * 1.35);
    const rb = this.runBlend, ph = this.runPhase;
    if (rb > 0.01) {
      const s = Math.sin(ph), s2 = Math.sin(ph + Math.PI);
      tg.hipL += rb * s * 42 * D; tg.hipR += rb * s2 * 42 * D;
      tg.knL += rb * (-Math.max(0, Math.cos(ph)) * 78 - 10) * D; tg.knR += rb * (-Math.max(0, Math.cos(ph + Math.PI)) * 78 - 10) * D;
      tg.shL += rb * s2 * 38 * D; tg.shR += rb * s * 38 * D; tg.elL += rb * 55 * D; tg.elR += rb * 55 * D; tg.spine += rb * 12 * D;
    }
    this.bob = rb * Math.abs(Math.sin(ph)) * 0.07;
    if (this.anim === 'idle' && rb < 0.5 && !this.emote) { const b = Math.sin(t * 2.2 + this.seed); tg.spine += b * 1.5 * D; tg.shL += b * 3 * D; tg.shR -= b * 3 * D; tg.neck += Math.sin(t * 0.7 + this.seed) * 3 * D; }
    if (this.emote) {
      const e = this.emoteT;
      if (this.emote === 'wave') { tg.shR = 165 * D; tg.elR = (20 + Math.sin(e * 10) * 30) * D; tg.neck = -8 * D; }
      else if (this.emote === 'clap') { const o = 0.5 + 0.5 * Math.sin(e * 9); tg.shL = 75 * D; tg.shR = 75 * D; tg.elL = (40 + o * 55) * D; tg.elR = (40 + o * 55) * D; tg.neck = 4 * D; }
      else if (this.emote === 'worm') { const w = Math.sin(e * 6), w2 = Math.sin(e * 6 - 1.2); tg.shL = (140 + w * 40) * D; tg.shR = (140 - w * 40) * D; tg.elL = tg.elR = (15 + Math.abs(w) * 35) * D; tg.spine = w * 40 * D; tg.hipL = tg.hipR = (-20 + w2 * 40) * D; tg.knL = tg.knR = (-20 - Math.abs(w2) * 50) * D; }
    }
  }
  update(dt, t) {
    if (this.animUntil && t > this.animUntil) { this.anim = this.base; this.animUntil = 0; }
    if (this.emote) this.emoteT += dt;
    this.computeTargets(dt, t);
    const w = POSE_SNAP[this.anim] || 17;
    for (const k of JOINTS) spring1(this, k, this.tg[k], w, dt);
    this.squashV += (-this.squash * 230 - this.squashV * 15) * dt; this.squash = clamp(this.squash + this.squashV * dt, -0.35, 0.35);
    let pt = this.pitchTarget; if (this.emote === 'worm') pt = 1.25 + Math.sin(this.emoteT * 6 + 0.6) * 0.2;
    this.pitch += (pt - this.pitch) * smoothT(12, dt);
    this.blinkAt -= dt; if (this.blinkAt < -0.12) this.blinkAt = 2 + Math.random() * 4;
    this.skeleton();
  }
  skeleton() {
    const c = this.c, P = this.pitch; const sin = Math.sin, cos = Math.cos;
    const hy = RIG.hipY + this.bob - (1 - cos(P)) * 0.5 + (this.emote === 'worm' ? -0.3 : 0);
    const H = [0, hy];
    const s = c.spine + P;                                                         // torso lean (forward positive)
    const S = [H[0] + sin(s) * RIG.torso, H[1] + cos(s) * RIG.torso];
    const hd = s + c.neck; const Cc = [S[0] + sin(s) * 0.06 + sin(hd) * (RIG.headR + 0.02), S[1] + cos(s) * 0.06 + cos(hd) * (RIG.headR + 0.02)];
    const sh = [S[0] - sin(s) * 0.05, S[1] - cos(s) * 0.05];
    const arm = (a0, e0) => { const a = s + a0, e = a + e0; const E = [sh[0] + sin(a) * RIG.upArm, sh[1] - cos(a) * RIG.upArm]; const W = [E[0] + sin(e) * RIG.foreArm, E[1] - cos(e) * RIG.foreArm]; return { E, W, a, e }; };
    const leg = (h0, k0) => { const a = P + h0, k = a + k0; const K = [H[0] + sin(a) * RIG.thigh, H[1] - cos(a) * RIG.thigh]; const F = [K[0] + sin(k) * RIG.shin, K[1] - cos(k) * RIG.shin]; return { K, F, a, k }; };
    const aL = arm(c.shL, c.elL), aR = arm(c.shR, c.elR), lL = leg(c.hipL, c.knL), lR = leg(c.hipR, c.knR);
    let drop = 0; if (this.grounded) drop = -(Math.min(lL.F[1], lR.F[1]) - 0.03);  // feet on the floor whatever the knees do
    this.sk = { H, S, C: Cc, sh, s, hd, aL, aR, lL, lR }; this.drop = this.grounded ? drop : 0;
  }
  scaleXY() { const q = this.squash, sz = this.look.size; return [sz[0] * (1 - q * 0.55), sz[1] * (1 + q)]; }
  handPos(side = 'L') { const sk = this.sk; if (!sk) return { x: this.x, y: this.y + 1 }; const W = (side === 'L' ? sk.aL : sk.aR).W; const [sx, sy] = this.scaleXY(); return { x: this.x + this.f * W[0] * sx, y: this.y + (W[1] + this.drop) * sy }; }
  headTop() { const sk = this.sk; const [, sy] = this.scaleXY(); return this.y + ((sk ? sk.C[1] : 1.72) + RIG.headR + 0.1 + this.drop) * sy; }
  draw(x = this.x, y = this.y, f = this.f, opts = {}) {
    const sk = this.sk; if (!sk) return; const L = this.look; const [sx, sy] = this.scaleXY();
    C.save(); C.translate(x, y + this.drop * sy); C.scale(f * sx, sy);
    if (opts.alpha !== undefined) C.globalAlpha = opts.alpha;
    const far = k => shade(k, -0.16);
    // --- behind the body ---
    if (L.acc.includes('pack')) { C.save(); C.translate(sk.H[0], sk.H[1]); C.rotate(-sk.s); rr(-0.4, 0.12, 0.24, 0.42, 0.06, '#e3e3e3', '#b9b9b9', 0.03); rect(-0.36, 0.44, 0.07, 0.08, '#ff7a1a'); C.restore(); }
    if (L.style === 'girl' || L.style === 'long') this.hairBack(L);
    if (L.hood) { C.save(); C.translate(sk.C[0], sk.C[1]); C.rotate(-sk.hd); ellipse(-0.14, -0.12, 0.2, 0.24, 0.3, shade(L.hood, -0.1)); C.restore(); }
    // --- far arm + far leg ---
    this.limbArm(sk.aL, L, true); this.limbLeg(sk.lL, L, true);
    // --- torso ---
    this.torso(L);
    // --- near leg, head, near arm ---
    this.limbLeg(sk.lR, L, false);
    this.head(L);
    this.limbArm(sk.aR, L, false);
    if (opts.mine) { C.globalAlpha = 1; }
    C.restore();
  }
  limbArm(A, L, isFar) {
    const sk = this.sk; const sh = sk.sh; const k = isFar ? far2 : same;
    const skin = k(L.skin), sleeve = k(L.longSleeve ? L.shirt : L.shirt), fore = k(L.longSleeve ? L.shirt : L.skin);
    if (L.longSleeve) seg(sh[0], sh[1], A.E[0], A.E[1], 0.15, sleeve);
    else { seg(sh[0], sh[1], A.E[0], A.E[1], 0.14, skin); const mx = sh[0] + (A.E[0] - sh[0]) * 0.5, my = sh[1] + (A.E[1] - sh[1]) * 0.5; seg(sh[0], sh[1], mx, my, 0.17, sleeve); }
    seg(A.E[0], A.E[1], A.W[0], A.W[1], 0.13, fore);
    circle(A.W[0], A.W[1], 0.075, k(L.hands), shade(k(L.hands), -0.28), 0.03);
    if (L.metal && !isFar) circle(A.E[0], A.E[1], 0.05, '#6e7780');
  }
  limbLeg(G, L, isFar) {
    const H = this.sk.H; const k = isFar ? far2 : same;
    const skin = k(L.skin), sh = k(L.shorts), shoe = k(L.shoe);
    if (L.pants) { seg(H[0], H[1], G.K[0], G.K[1], 0.19, sh); seg(G.K[0], G.K[1], G.F[0], G.F[1], 0.165, sh); }
    else { seg(H[0], H[1], G.K[0], G.K[1], 0.18, skin); const mx = H[0] + (G.K[0] - H[0]) * 0.62, my = H[1] + (G.K[1] - H[1]) * 0.62; seg(H[0], H[1], mx, my, 0.21, sh); seg(G.K[0], G.K[1], G.F[0], G.F[1], 0.155, skin); }
    const fx = Math.cos(G.k), fy = Math.sin(G.k);
    ellipse(G.F[0] + fx * 0.07, G.F[1] + fy * 0.07 - 0.02, 0.145, 0.07, G.k, shoe, shade(shoe, -0.3), 0.03);
    if (!L.pants || L.shoe !== L.shorts) line(G.F[0] - fx * 0.05, G.F[1] - fy * 0.05 - 0.07, G.F[0] + fx * 0.2, G.F[1] + fy * 0.2 - 0.07, k('#ece6da'), 0.03);
  }
  torso(L) {
    const sk = this.sk; C.save(); C.translate(sk.H[0], sk.H[1]); C.rotate(-sk.s);
    const T = RIG.torso;
    circle(0, 0.02, 0.2, L.shorts, shade(L.shorts, -0.25), 0.035);               // hips / shorts
    poly([-0.19, 0.02, 0.18, 0.02, 0.215, T - 0.06, 0.13, T + 0.03, -0.15, T + 0.03, -0.21, T - 0.08], L.shirt, shade(L.shirt, -0.28), 0.045);
    const A = L.acc;
    if (L.trim && !A.includes('wetsuit')) { line(-0.18, 0.06, 0.18, 0.06, L.trim, 0.05, 'butt'); line(-0.1, T + 0.01, 0.1, T + 0.01, L.trim, 0.05); }
    if (A.includes('wetsuit')) { line(-0.02, 0.05, 0.03, T, '#20c9b8', 0.06); line(-0.17, 0.04, -0.2, T - 0.08, '#20c9b8', 0.04); }
    if (A.includes('stripes')) for (let i = 0; i < 4; i++) line(-0.19, 0.12 + i * 0.12, 0.2, 0.12 + i * 0.12, '#b8262b', 0.05, 'butt');
    if (A.includes('tux')) { poly([0.1, 0.08, 0.2, 0.08, 0.215, T - 0.06, 0.13, T + 0.02, 0.08, T - 0.04], '#f7f7f7'); poly([0.17, T - 0.05, 0.25, T - 0.01, 0.25, T - 0.11], '#111'); poly([0.17, T - 0.05, 0.1, T - 0.01, 0.1, T - 0.11], '#111'); for (const y of [0.18, 0.28, 0.38]) circle(0.155, y, 0.018, '#222'); }
    if (A.includes('cross')) { rect(-0.03, 0.2, 0.07, 0.24, '#fff'); rect(-0.11, 0.285, 0.23, 0.07, '#fff'); }
    if (A.includes('whistle')) { line(0.02, T, 0.18, T - 0.18, '#222', 0.015); rr(0.15, T - 0.24, 0.08, 0.05, 0.01, '#f5c542'); }
    if (A.includes('chain')) { C.beginPath(); C.moveTo(-0.02, T); C.quadraticCurveTo(0.12, T - 0.26, 0.22, T - 0.08); C.strokeStyle = '#f5c542'; C.lineWidth = 0.035; C.stroke(); }
    if (A.includes('medallion')) circle(0.19, T - 0.2, 0.055, '#ffd84a', '#b8902a', 0.02);
    if (A.includes('belt')) { line(-0.2, 0.08, 0.2, 0.08, '#5a3a1a', 0.07, 'butt'); rr(0.13, 0.05, 0.08, 0.07, 0.01, '#f5c542'); }
    if (A.includes('panel')) { rr(-0.1, 0.24, 0.2, 0.14, 0.02, '#3a4148'); circle(-0.05, 0.31, 0.022, '#22f3ff'); circle(0, 0.31, 0.022, '#f5c542'); circle(0.05, 0.31, 0.022, '#ff3b3b'); }
    if (L.trim && A.includes('pack')) line(-0.19, 0.3, 0.2, 0.3, '#ff7a1a', 0.05, 'butt');
    if (L.metal) line(-0.16, 0.12, 0.16, 0.12, '#8f99a3', 0.03);
    C.restore();
  }
  hairBack(L) {
    const sk = this.sk; C.save(); C.translate(sk.C[0], sk.C[1]); C.rotate(-sk.hd * 0.5);
    if (L.style === 'girl') { poly([-0.1, 0.22, -0.3, 0.1, -0.34, -0.3, -0.28, -0.52, -0.06, -0.5, -0.02, -0.1], L.hair, shade(L.hair, -0.25), 0.03); poly([-0.33, -0.34, -0.28, -0.52, -0.08, -0.5, -0.1, -0.38], L.hairTip); }
    else poly([-0.1, 0.22, -0.3, 0.12, -0.33, -0.2, -0.24, -0.36, -0.04, -0.3, 0, -0.05], L.hair, shade(L.hair, -0.25), 0.03);
    C.restore();
  }
  head(L) {
    const sk = this.sk; const R = RIG.headR; C.save(); C.translate(sk.C[0], sk.C[1]); C.rotate(-sk.hd);
    const A = L.acc;
    circle(-0.02, -R + 0.02, 0.07, L.skin);                                         // neck
    rr(-R, -R, R * 2, R * 2, 0.12, L.skin, shade(L.skin, -0.3), 0.045);             // head
    if (L.metal) { rr(-R + 0.03, R - 0.12, 0.2, 0.06, 0.03, 'rgba(255,255,255,.35)'); }
    // face
    const blink = this.blinkAt < 0;
    if (!A.includes('rvisor')) {
      const ey = 0.03;
      if (blink) { line(0.08, ey, 0.17, ey, L.eye, 0.025); line(0.0, ey, 0.05, ey, L.eye, 0.022); }
      else { ellipse(0.13, ey, 0.032, 0.05, 0, L.eye); ellipse(0.02, ey + 0.005, 0.026, 0.045, 0, L.eye); circle(0.14, ey + 0.02, 0.011, '#fff'); }
      C.beginPath(); C.arc(0.12, -0.07, 0.06, -2.4, -0.7); C.strokeStyle = shade(L.skin, -0.45); C.lineWidth = 0.022; C.lineCap = 'round'; C.stroke();
      if (L.style === 'girl') { ellipse(0.07, -0.05, 0.035, 0.022, 0, 'rgba(255,120,150,.45)'); line(0.1, 0.085, 0.14, 0.11, L.eye, 0.018); line(0.13, 0.085, 0.18, 0.105, L.eye, 0.018); }
    }
    // hair
    const hair = L.hair;
    if (L.style === 'boy') { poly([-0.27, -0.02, -0.28, 0.15, -0.17, 0.27, 0, 0.31, 0.17, 0.28, 0.28, 0.14, 0.25, 0.07, 0.16, 0.13, 0.08, 0.07, -0.02, 0.13, -0.1, 0.06, -0.19, 0.09, -0.21, -0.04], hair, shade(hair, -0.25), 0.03); poly([-0.27, -0.02, -0.3, 0.1, -0.22, 0.06, -0.2, -0.1], L.hairTip); }
    else if (L.style === 'girl') { poly([-0.28, -0.1, -0.28, 0.15, -0.17, 0.28, 0, 0.31, 0.17, 0.28, 0.28, 0.13, 0.22, 0.1, 0.12, 0.16, 0.02, 0.12, -0.12, 0.16, -0.22, 0.02], hair, shade(hair, -0.25), 0.03); poly([-0.04, 0.3, 0.1, 0.4, 0.1, 0.26], '#ff5aa0'); poly([-0.04, 0.3, -0.18, 0.4, -0.16, 0.25], '#ff5aa0'); circle(-0.04, 0.3, 0.03, '#ff5aa0'); }
    else if (L.style === 'slick') poly([-0.27, -0.04, -0.27, 0.16, -0.12, 0.29, 0.1, 0.3, 0.25, 0.19, 0.27, 0.11, 0.1, 0.17, -0.1, 0.15, -0.22, 0.02], hair, shade(hair, -0.25), 0.03);
    else if (L.style === 'short') poly([-0.27, -0.02, -0.28, 0.16, -0.15, 0.29, 0.05, 0.31, 0.22, 0.25, 0.27, 0.13, 0.18, 0.15, 0.08, 0.11, -0.05, 0.15, -0.2, 0.04], hair, shade(hair, -0.25), 0.03);
    else if (L.style === 'long') poly([-0.29, -0.1, -0.28, 0.16, -0.16, 0.29, 0.02, 0.32, 0.2, 0.27, 0.29, 0.12, 0.2, 0.14, 0.12, 0.18, 0, 0.12, -0.14, 0.17, -0.22, 0.02], hair, shade(hair, -0.25), 0.03);
    // head accessories
    if (A.includes('cap')) { C.beginPath(); C.arc(0, 0.06, R + 0.035, 0.15, Math.PI - 0.05); C.closePath(); C.fillStyle = '#141416'; C.fill(); rr(0.05, 0.12, 0.36, 0.06, 0.03, '#141416'); }
    if (A.includes('shades')) { rr(-0.02, -0.01, 0.29, 0.085, 0.03, '#0b0b0d'); line(0.14, 0.05, 0.2, 0.05, 'rgba(255,255,255,.5)', 0.012); }
    if (A.includes('shadesUp')) { rr(-0.02, 0.24, 0.29, 0.07, 0.03, '#0b0b0d'); }
    if (A.includes('visor')) { line(-0.27, 0.15, 0.25, 0.15, '#fff', 0.06, 'butt'); rr(0.1, 0.12, 0.3, 0.05, 0.02, '#fff'); }
    if (A.includes('bandana')) { C.beginPath(); C.arc(0, 0.04, R + 0.03, 0.2, Math.PI - 0.1); C.closePath(); C.fillStyle = '#b8262b'; C.fill(); poly([-0.24, 0.12, -0.42, 0.18, -0.38, 0.04], '#b8262b'); poly([-0.24, 0.1, -0.4, -0.04, -0.3, -0.06], '#9c1f24'); }
    if (A.includes('eyepatch')) { circle(0.13, 0.03, 0.055, '#111'); line(0.13, 0.05, -0.25, 0.17, '#111', 0.02); }
    if (A.includes('beard')) poly([0.0, -0.1, 0.27, -0.06, 0.22, -0.27, 0.06, -0.3, -0.04, -0.2], '#2a1a10');
    if (A.includes('rvisor')) { rr(-0.04, -0.02, 0.32, 0.1, 0.04, '#22f3ff'); rr(-0.04, -0.02, 0.32, 0.1, 0.04, null, 'rgba(255,255,255,.6)', 0.015); }
    if (A.includes('antenna')) { line(-0.02, R, -0.02, R + 0.18, '#6e7780', 0.03); circle(-0.02, R + 0.21, 0.045, '#ff3b3b'); }
    if (A.includes('helmet')) { circle(0.02, 0.0, 0.37, 'rgba(255,200,90,.22)', 'rgba(255,255,255,.9)', 0.05); C.beginPath(); C.arc(0.02, 0, 0.3, 1.9, 2.6); C.strokeStyle = 'rgba(255,255,255,.7)'; C.lineWidth = 0.035; C.stroke(); }
    C.restore();
  }
}
const same = c => c, far2 = c => shade(c, -0.16);

/* =====================================================================
   COURTS, BALL, COSMETICS DATA
   ===================================================================== */
const NET_H = 2.93, NET_MESH = 1.5, COURT_L = 22.5, INDOOR_SCALE = 1.1;
const COURTS_BY_MAP = {
  indoor: { l: COURT_L * INDOOR_SCALE, half: COURT_L * INDOOR_SCALE / 2, wall: COURT_L * INDOOR_SCALE / 2 + 6, ceil: 10.7, walls: true },
  beach:  { l: COURT_L, half: COURT_L / 2, wall: COURT_L / 2 + 13, ceil: 80, walls: false },
};
const courtDims = () => COURTS_BY_MAP[(S.match && S.match.map) || 'indoor'];
const TEAM_NAME = { A: 'BLACK', B: 'WHITE' };
const BALL_R = 0.3, BALL_G = 12.5;
const SKINS = {
  default:    { name: 'Classic', price: 0, rarity: 'common' },
  black:      { name: 'Black', price: 500, rarity: 'common' },
  beach:      { name: 'Beach', price: 1000, rarity: 'common' },
  lowpoly:    { name: 'Low Poly', price: 1500, rarity: 'rare' },
  basketball: { name: 'Basketball', price: 2000, rarity: 'rare' },
  fire:       { name: 'Fire', price: 2500, rarity: 'epic' },
  gold:       { name: 'Gold', price: 5000, rarity: 'epic' },
  chromatic:  { name: 'Chromatic', price: 10000, rarity: 'legendary' },
  soccer:     { name: 'Soccer Ball', price: 800, rarity: 'common' },
  neutron:    { name: 'Neutron Star', price: 25000, rarity: 'mythic' },
};
const MODELS = {
  boy: { name: 'Boy', price: 0, rarity: 'common' }, girl: { name: 'Girl', price: 0, rarity: 'common' },
  dealer: { name: 'Lil Man Dealer', price: 10000, rarity: 'epic' }, bigdealer: { name: 'Big Man Dealer', price: 20000, rarity: 'legendary' }, tux: { name: 'Tuxedo Man', price: 3000, rarity: 'rare' },
  lifeguard: { name: 'Lifeguard', price: 2500, rarity: 'rare' }, surfer: { name: 'Surfer', price: 3000, rarity: 'rare' },
  pirate: { name: 'Pirate', price: 7500, rarity: 'epic' }, robot: { name: 'Robot', price: 8000, rarity: 'epic' }, astronaut: { name: 'Astronaut', price: 9000, rarity: 'epic' },
};
const EMOTES = { wave: { name: 'Wave', price: 500, rarity: 'common' }, clap: { name: 'Clap', price: 500, rarity: 'common' }, worm: { name: 'Worm', price: 7500, rarity: 'epic' } };
const RARITY_ORDER = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
const FXS = { none: { name: 'None', price: 0, rarity: 'common' }, confetti: { name: 'Confetti', price: 3000, rarity: 'rare' }, heart: { name: 'Heart', price: 5000, rarity: 'rare' }, smite: { name: 'Smite', price: 10000, rarity: 'legendary' }, timestop: { name: 'Time Stop', price: 12500, rarity: 'legendary' }, hammock: { name: 'Hammock', price: 10000, rarity: 'epic' }, blackhole: { name: 'Black Hole', price: 20000, rarity: 'mythic' } };
const CHEST_TIERS = { 1: { body: '#8b5a2b', band: '#cd7f32', glow: '#ffd9a0' }, 2: { body: '#55636f', band: '#d0d6dd', glow: '#d8f0ff' }, 3: { body: '#7a4a10', band: '#f5c542', glow: '#fff0a0' }, 4: { body: '#7a1218', band: '#ff4a55', glow: '#ffb0b8' } };
let ULTRA = false;                                   // Graphics = Ultra low: no effects, still scenery, classic balls for everyone

/* ---- ball skins: same size and hitbox, looks only ---- */
function drawBallSkin(x, y, id, rot, t, r = BALL_R, mine = false) {
  if (ULTRA || !SKINS[id]) id = 'default';
  if (id === 'neutron') { drawNeutron(x, y, r, rot, t); if (mine) circle(x, y, r * 1.06, 'rgba(255,40,40,.5)'); return; }
  if (id === 'chromatic' || id === 'fire') { C.save(); C.globalCompositeOperation = 'lighter'; const hue = (t * 120) % 360; const col = id === 'fire' ? 'rgba(255,120,30,' : `hsla(${hue},100%,60%,`; circle(x, y, r * 1.55, col + '0.18)'); circle(x, y, r * 1.25, col + '0.28)'); C.restore(); }
  C.save(); C.translate(x, y); C.rotate(rot);
  C.beginPath(); C.arc(0, 0, r, 0, TAU); C.save(); C.clip();
  const band = (cx, cy, R, w, col) => { C.beginPath(); C.arc(cx * r, cy * r, R * r, 0, TAU); C.strokeStyle = col; C.lineWidth = w * r; C.stroke(); };
  switch (id) {
    case 'black': rect(-r, -r, 2 * r, 2 * r, '#1b1b21'); band(1.0, 0.45, 1.05, 0.06, '#3a3a44'); band(-0.95, 0.5, 1.0, 0.06, '#3a3a44'); band(0, -1.25, 1.0, 0.06, '#3a3a44'); break;
    case 'beach': { const cols = ['#ffffff', '#e5484d', '#f5c542', '#3b8ff0', '#ffffff', '#3ecf5a']; for (let i = 0; i < 6; i++) { C.beginPath(); C.moveTo(0, 0); C.arc(0, 0, r * 1.1, i * TAU / 6, (i + 1) * TAU / 6); C.closePath(); C.fillStyle = cols[i]; C.fill(); } circle(0, 0, r * 0.18, '#fff'); break; }
    case 'lowpoly': { const pts = []; for (let i = 0; i < 6; i++) pts.push([Math.cos(i * TAU / 6 + 0.3) * r * 1.25, Math.sin(i * TAU / 6 + 0.3) * r * 1.25]); const cols = ['#d6eef3', '#b6dbe3', '#c4e3ea', '#a9d0da', '#cde8ee', '#bde0e8']; for (let i = 0; i < 6; i++) { const a = pts[i], b = pts[(i + 1) % 6]; poly([0.12 * r, 0.1 * r, a[0], a[1], b[0], b[1]], cols[i], 'rgba(120,170,185,.6)', r * 0.04); } break; }
    case 'basketball': rect(-r, -r, 2 * r, 2 * r, '#e8702a'); line(0, -r, 0, r, '#1a1a1a', r * 0.07); line(-r, 0, r, 0, '#1a1a1a', r * 0.07); band(-1.35, 0, 1.0, 0.07, '#1a1a1a'); band(1.35, 0, 1.0, 0.07, '#1a1a1a'); break;
    case 'fire': { const g = C.createRadialGradient(-0.2 * r, 0.25 * r, 0.05 * r, 0, 0, r); g.addColorStop(0, '#fff3a0'); g.addColorStop(0.4, '#ffb02a'); g.addColorStop(0.75, '#ff5a1f'); g.addColorStop(1, '#8a0f0f'); C.fillStyle = g; C.fillRect(-r, -r, 2 * r, 2 * r); for (let i = 0; i < 3; i++) band(0.9 - i * 0.9, -0.6, 0.8, 0.08, 'rgba(60,10,5,.55)'); break; }
    case 'gold': { const g = C.createLinearGradient(-r, r, r, -r); g.addColorStop(0, '#9a6a0a'); g.addColorStop(0.45, '#f2c040'); g.addColorStop(0.6, '#fff0b0'); g.addColorStop(1, '#c48a18'); C.fillStyle = g; C.fillRect(-r, -r, 2 * r, 2 * r); band(1.0, 0.45, 1.05, 0.06, 'rgba(120,80,0,.45)'); band(-0.95, 0.5, 1.0, 0.06, 'rgba(120,80,0,.45)'); break; }
    case 'chromatic': { rect(-r, -r, 2 * r, 2 * r, '#ffffff'); const hue = (t * 120) % 360; band(1.0, 0.45, 1.05, 0.3, `hsl(${hue},95%,62%)`); band(-0.95, 0.5, 1.0, 0.3, `hsl(${(hue + 120) % 360},95%,62%)`); band(0, -1.25, 1.0, 0.3, `hsl(${(hue + 240) % 360},95%,62%)`); break; }
    case 'soccer': { rect(-r, -r, 2 * r, 2 * r, '#f4f4f4'); const pent = (cx, cy, s, a0, fill) => { const p = []; for (let i = 0; i < 5; i++) { const a = a0 + i * TAU / 5; p.push(cx + Math.cos(a) * s, cy + Math.sin(a) * s); } poly(p, fill, '#b8b8b8', r * 0.04); }; pent(0, 0, r * 0.34, Math.PI / 2, '#151515'); for (let i = 0; i < 5; i++) { const a = Math.PI / 2 + Math.PI / 5 + i * TAU / 5; pent(Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98, r * 0.3, a, '#151515'); } break; }
    default: rect(-r, -r, 2 * r, 2 * r, '#f7f7f7'); band(1.0, 0.45, 1.05, 0.34, '#2f6bff'); band(-0.95, 0.5, 1.0, 0.34, '#ffd000'); band(0, -1.25, 1.0, 0.34, '#2f6bff');
  }
  C.restore();
  const sh = C.createRadialGradient(-0.35 * r, 0.4 * r, 0.05 * r, 0, 0, r * 1.05);             // soft light from the top left
  sh.addColorStop(0, 'rgba(255,255,255,.45)'); sh.addColorStop(0.45, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,40,.28)');
  C.beginPath(); C.arc(0, 0, r, 0, TAU); C.fillStyle = sh; C.fill(); C.strokeStyle = 'rgba(40,40,70,.35)'; C.lineWidth = r * 0.07; C.stroke();
  C.restore();
  if (id === 'gold') { const k = (t * 0.8) % 1; if (k < 0.3) { C.save(); C.globalCompositeOperation = 'lighter'; const a = Math.sin(k / 0.3 * Math.PI); line(x + r * 0.2 - 0.12 * a, y + r * 0.35, x + r * 0.2 + 0.12 * a, y + r * 0.35, `rgba(255,255,220,${a})`, 0.03); line(x + r * 0.2, y + r * 0.35 - 0.12 * a, x + r * 0.2, y + r * 0.35 + 0.12 * a, `rgba(255,255,220,${a})`, 0.03); C.restore(); } }
  if (mine) circle(x, y, r * 1.06, 'rgba(255,40,40,.5)');
}
function drawNeutron(x, y, r, rot, t) {
  C.save(); C.globalCompositeOperation = 'lighter';
  const p = 0.5 + 0.5 * Math.sin(t * 25);
  circle(x, y, r * 2.6, `rgba(90,156,255,${0.06 + p * 0.05})`); circle(x, y, r * 1.7, `rgba(143,194,255,${0.18 + p * 0.1})`); circle(x, y, r * 1.25, `rgba(214,233,255,${0.35 + p * 0.15})`);
  const a = t * 25 * 0.25 + 0.55;                                         // two pulsar beams sweeping round a tilted axis
  for (const s of [1, -1]) { const dx = Math.cos(a) * s, dy = Math.sin(a) * s; const nx = -dy, ny = dx; C.beginPath(); C.moveTo(x + nx * r * 0.08, y + ny * r * 0.08); C.lineTo(x + dx * r * 4.6 + nx * r * 0.5, y + dy * r * 4.6 + ny * r * 0.5); C.lineTo(x + dx * r * 4.6 - nx * r * 0.5, y + dy * r * 4.6 - ny * r * 0.5); C.lineTo(x - nx * r * 0.08, y - ny * r * 0.08); C.closePath(); const g = C.createLinearGradient(x, y, x + dx * r * 4.6, y + dy * r * 4.6); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(0.4, 'rgba(180,220,255,.45)'); g.addColorStop(1, 'rgba(120,180,255,0)'); C.fillStyle = g; C.fill(); }
  C.restore();
  ellipse(x, y, r * 1.55, r * 0.35, t * 3 * 0.3 + 0.2, null, `rgba(207,230,255,${0.55 + p * 0.25})`, r * 0.08);
  const g = C.createRadialGradient(x - r * 0.25, y + r * 0.3, 0, x, y, r); g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#d6ebff'); g.addColorStop(1, '#7fb6ff'); circle(x, y, r, g);
}

/* =====================================================================
   THE DYNAMIC NET (what you see)
   The ball's physics against the net is deterministic (it only depends on the ball, so every client agrees -
   see ballNets in the game part). This is the cloth you see: a column of points from the tape down to the
   bottom cable, each pulled back into line by the tension between the posts and by its neighbours. A ball
   driving into it wraps the mesh around itself; a player pressing on it bulges it; afterwards it wobbles
   and settles. The tape is stiff, the mesh in the middle gives the most.
   ===================================================================== */
class Net2D {
  constructor(x, style) { this.x = x; this.style = style; this.n = 16; this.u = new Float32Array(this.n); this.v = new Float32Array(this.n); this.shake = 0; }
  yOf(i) { return NET_H - i * NET_MESH / (this.n - 1); }
  touchBall(bx, by, bvx, r, side) {             // wrap the mesh round a ball that is pushing into it (side: the side it came in from, from the physics)
    const dx = bx - this.x; if (!side || Math.abs(dx) > r + 0.9 || by > NET_H + r || by < NET_H - NET_MESH - r) return;
    const dir = -side;                                                                     // the mesh is pushed away from the side the ball came from
    for (let i = 0; i < this.n; i++) {
      const dy = this.yOf(i) - by; if (Math.abs(dy) >= r) continue; const w = Math.sqrt(r * r - dy * dy) * (i === 0 ? 0.35 : 1);
      if (dir > 0) { const want = dx + w; if (want > this.u[i] && dx - w < this.u[i] + 0.05) { this.u[i] = want; this.v[i] = Math.max(this.v[i], bvx * 0.6); } }
      else { const want = dx - w; if (want < this.u[i] && dx + w > this.u[i] - 0.05) { this.u[i] = want; this.v[i] = Math.min(this.v[i], bvx * 0.6); } }
    }
  }
  touchBody(px, py, h, side) {                  // a player leaning on the net from one side (side = -1: they are on the left)
    for (let i = 0; i < this.n; i++) { const y = this.yOf(i); if (y < py || y > py + h) continue; const edge = px - this.x + side * -0.22; if (side < 0 && edge > this.u[i]) this.u[i] += (edge - this.u[i]) * 0.3; if (side > 0 && edge < this.u[i]) this.u[i] += (edge - this.u[i]) * 0.3; }
  }
  kick(amount) { for (let i = 0; i < this.n; i++) this.v[i] += (Math.random() - 0.5) * amount * (i === 0 ? 0.3 : 1); }
  step(dt, t, wind = 0) {
    const n = this.n, u = this.u, v = this.v; const h = Math.min(dt, 1 / 30);
    for (let k = 0; k < 2; k++) {
      const hh = h / 2;
      for (let i = 0; i < n; i++) {
        const stiff = i === 0 ? 420 : i === n - 1 ? 160 : 55;                  // tape > bottom cable > the loose mesh between them
        const nb = (i > 0 ? u[i - 1] : 0) + (i < n - 1 ? u[i + 1] : 0) - (i > 0 && i < n - 1 ? 2 : 1) * u[i];
        const a = -stiff * u[i] + 160 * nb - 6.5 * v[i] + wind * 0.35 * Math.sin(t * 2.3 + i * 0.5);
        v[i] += a * hh;
      }
      for (let i = 0; i < n; i++) { u[i] += v[i] * hh; u[i] = clamp(u[i], -1.1, 1.1); }
    }
  }
  draw(t) {
    const x = this.x, beach = this.style === 'beach'; const top = NET_H, bot = NET_H - NET_MESH; const n = this.n;
    // post (right behind the net in a side view) and the antenna above the tape
    const postC = beach ? '#c9a06a' : '#8d97a6';
    rr(x - 0.09, 0, 0.18, top + 0.15, 0.06, postC, shade(postC, -0.3), 0.03);
    if (!beach) rr(x - 0.16, 0, 0.32, 1.6, 0.1, '#2f5fd0', '#1f3f90', 0.03);        // post padding
    else circle(x, top + 0.2, 0.08, '#e9d2a8');
    for (let i = 0; i < 8; i++) rect(x - 0.025, top + i * 0.1, 0.05, 0.1, i % 2 ? '#ffffff' : '#e5484d');
    // the mesh: a strip whose rows follow the displaced points
    const W = 0.26; const px = i => x + this.u[i];
    const meshC = beach ? 'rgba(255,255,255,.85)' : 'rgba(25,25,32,.8)';
    C.beginPath(); C.moveTo(px(0) - W, top); for (let i = 1; i < n; i++) C.lineTo(px(i) - W, this.yOf(i)); for (let i = n - 1; i >= 0; i--) C.lineTo(px(i) + W, this.yOf(i)); C.closePath();
    C.fillStyle = beach ? 'rgba(30,50,90,.18)' : 'rgba(0,0,0,.14)'; C.fill();
    C.beginPath();
    for (let i = 0; i < n - 1; i++) { const y0 = this.yOf(i), y1 = this.yOf(i + 1); C.moveTo(px(i) - W, y0); C.lineTo(px(i + 1) + W, y1); C.moveTo(px(i) + W, y0); C.lineTo(px(i + 1) - W, y1); }
    for (let i = 0; i < n; i++) { const y = this.yOf(i); C.moveTo(px(i) - W, y); C.lineTo(px(i) + W, y); }
    C.strokeStyle = meshC; C.lineWidth = 0.022; C.stroke();
    C.beginPath(); C.moveTo(px(0) - W, top); for (let i = 1; i < n; i++) C.lineTo(px(i) - W, this.yOf(i)); C.moveTo(px(0) + W, top); for (let i = 1; i < n; i++) C.lineTo(px(i) + W, this.yOf(i)); C.strokeStyle = meshC; C.lineWidth = 0.03; C.stroke();
    rr(px(0) - W - 0.03, top - 0.06, W * 2 + 0.06, 0.12, 0.04, beach ? '#3b8ff0' : '#ffffff', 'rgba(0,0,0,.35)', 0.02);   // the tape
    line(px(n - 1) - W, bot, px(n - 1) + W, bot, '#333', 0.04);
  }
}

/* =====================================================================
   WIND (identical on every client: derived from server time) - outside only, blows balls along x
   ===================================================================== */
const WIND = { x: 0 };
function updateWind() {
  const t = snow() / 1000;
  const ang = t * 0.011 + Math.sin(t * 0.037) * 1.2 + Math.sin(t * 0.0071) * 2.0;
  const str = 1.2 + 1.6 * (0.5 + 0.5 * Math.sin(t * 0.021)) + 0.6 * Math.sin(t * 0.09) + 0.35 * Math.sin(t * 0.6);
  WIND.x = Math.cos(ang) * str;
}

/* =====================================================================
   LOBBY LAYOUT (metres). Left to right: the hut at the end of the pier, the pier over the sea, the beach with
   its court, then the two-storey beach house (door on its left wall, stairs at its right end).
   ===================================================================== */
const LOBBY = {
  x0: -121, x1: 36.6,
  shore: -75, pierY: 0.55, hut: { x0: -121, x1: -106 },
  house: { x0: -20, x1: 36, door: 3.0, f2: 5.5, roof: 11, stairs: { x0: 24, x1: 34 } },
  beachNet: -50,
};
const F2 = LOBBY.house.f2;
/* walkable surfaces: plain floors, the one-way stairs (you have to step onto them with Up), and the walls */
const FLOORS = [
  { x1: -121, x2: -75.2, y: LOBBY.pierY, kind: 'pier' },
  { x1: -75.2, x2: 36, y: 0, kind: 'ground' },
  { x1: -20, x2: LOBBY.house.stairs.x0, y: F2, kind: 'upstairs' },
];
const STAIRS = { x1: LOBBY.house.stairs.x0, x2: LOBBY.house.stairs.x1, y1: F2, y2: 0 };   // top at x1, bottom at x2
const stairsY = x => STAIRS.y1 + (STAIRS.y2 - STAIRS.y1) * clamp((x - STAIRS.x1) / (STAIRS.x2 - STAIRS.x1), 0, 1);
const WALLS = [
  { x: -121, y1: -5, y2: 40 },                                   // the hut's far wall = the end of the world
  { x: -106, y1: LOBBY.pierY + 2.7, y2: 4.8 },                   // above the hut's doorway
  { x: -20, y1: LOBBY.house.door, y2: LOBBY.house.roof },         // above the house door, and the upstairs wall
  { x: 36, y1: -5, y2: 40 },                                     // the house's far wall
];
const CEILS = [
  { x1: -121, x2: -106, y: 4.6 },                                // hut roof
  { x1: -20, x2: LOBBY.house.stairs.x0, y: F2 - 0.3 },            // underside of the upstairs floor
  { x1: -20, x2: 36, y: LOBBY.house.roof },                       // house roof
];
const indoors = x => x >= LOBBY.house.x0 && x <= LOBBY.house.x1;
const inHut = x => x >= LOBBY.hut.x0 && x <= LOBBY.hut.x1;
/* NPCs and pads */
const NPCS = [
  { id: 'lil', name: 'Lil Man Dealer', variant: 'dealer', x: 2.2, y: 0, f: 1, rig: null, tab: 'skins' },
  { id: 'big', name: 'Big Man Dealer', variant: 'bigdealer', x: 4.6, y: F2, f: 1, rig: null, tab: 'boxes' },
  { id: 'woman', name: 'Lil Woman Dealer', variant: 'wdealer', x: -113.4, y: LOBBY.pierY, f: 1, rig: null, tab: 'emotes' },
];
const PADS = {
  practice: { id: 'practice', label: 'PRACTICE', mode: 'practice', x: -7, count: 0 },
  c2v2: { id: 'c2v2', label: '2v2', mode: '2v2', x: 9, count: 0 },
  c3v3: { id: 'c3v3', label: '3v3', mode: '3v3', x: 14.5, count: 0 },
  c6v6: { id: 'c6v6', label: '6v6', mode: '6v6', x: 20, count: 0 },
};
const PAD_HALF = 1.35;

/* =====================================================================
   SCENERY (drawn every frame, culled to the view; soft flat shapes, nothing realistic)
   ===================================================================== */
function drawSkyScreen(indoorOnly) {
  screenTf();
  const g = C.createLinearGradient(0, 0, 0, VH); g.addColorStop(0, PAL.top); g.addColorStop(1, PAL.bot);
  C.fillStyle = g; C.fillRect(0, 0, VW, VH);
  if (indoorOnly) return;
  // sun or moon: slides across with the time of day, a touch of parallax
  const sx = VW * (0.12 + 0.76 * (1 - SUN.u)) - (CAM.x * CAM.s * 0.02) % VW, sy = VH * (0.7 - 0.55 * SUN.el);
  if (isNight) {
    C.fillStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i < 70; i++) { const x = ((hash(i) * VW * 1.3 - CAM.x * CAM.s * 0.01) % VW + VW) % VW, y = hash(i + 99) * VH * 0.55; const tw = 0.5 + 0.5 * Math.sin(T * 2 + i); C.globalAlpha = 0.3 + tw * 0.6; C.fillRect(x, y, 2, 2); } C.globalAlpha = 1;
    const mg = C.createRadialGradient(sx, sy, 0, sx, sy, 90); mg.addColorStop(0, 'rgba(220,230,255,.35)'); mg.addColorStop(1, 'rgba(220,230,255,0)'); C.fillStyle = mg; C.fillRect(sx - 90, sy - 90, 180, 180);
    C.beginPath(); C.arc(sx, sy, 26, 0, TAU); C.fillStyle = '#eef2ff'; C.fill(); C.beginPath(); C.arc(sx + 10, sy - 6, 22, 0, TAU); C.fillStyle = mix(PAL.top, PAL.bot, sy / VH); C.fill();
  } else {
    const sg = C.createRadialGradient(sx, sy, 0, sx, sy, 130); sg.addColorStop(0, 'rgba(255,250,210,.55)'); sg.addColorStop(1, 'rgba(255,250,210,0)'); C.fillStyle = sg; C.fillRect(sx - 130, sy - 130, 260, 260);
    C.beginPath(); C.arc(sx, sy, 34, 0, TAU); C.fillStyle = PAL.sun; C.fill();
  }
  // clouds drift slowly, far parallax
  for (let i = 0; i < 7; i++) {
    const w = 140 + hash(i + 7) * 160, span = VW + 600;
    const cx = ((hash(i) * span + T * (6 + hash(i + 3) * 8) - CAM.x * CAM.s * 0.06) % span + span) % span - 300, cy = VH * (0.08 + hash(i + 11) * 0.3);
    C.fillStyle = alpha(PAL.cloud, 0.85);
    C.beginPath(); C.ellipse(cx, cy, w * 0.5, w * 0.16, 0, 0, TAU); C.ellipse(cx - w * 0.18, cy - w * 0.1, w * 0.2, w * 0.15, 0, 0, TAU); C.ellipse(cx + w * 0.12, cy - w * 0.13, w * 0.24, w * 0.18, 0, 0, TAU); C.fill();
  }
  // seagulls
  if (!isNight) { C.strokeStyle = 'rgba(60,70,90,.7)'; C.lineWidth = 2; for (let i = 0; i < 3; i++) { const span = VW + 400; const gx = ((T * (30 + i * 9) + hash(i + 40) * span - CAM.x * CAM.s * 0.1) % span + span) % span - 200, gy = VH * (0.18 + 0.1 * i) + Math.sin(T * 1.3 + i) * 12; const fl = Math.sin(T * 8 + i) * 4; C.beginPath(); C.moveTo(gx - 9, gy - fl); C.quadraticCurveTo(gx - 4, gy - 6, gx, gy); C.quadraticCurveTo(gx + 4, gy - 6, gx + 9, gy - fl); C.stroke(); } }
}
/* the sea along the horizon behind everything (a screen-wide band from the horizon down to the sand line) */
function drawHorizonSea(horizonY = 2.2) {
  worldTf(); const x0 = viewX0() - 1, x1 = viewX1() + 1;
  const g = C.createLinearGradient(0, horizonY, 0, 0); g.addColorStop(0, PAL.seaFar); g.addColorStop(1, PAL.sea);
  C.fillStyle = g; C.fillRect(x0, -0.2, x1 - x0, horizonY + 0.2);
  // distant islands (parallax: they move slower than the world)
  const par = 0.7;
  for (let i = 0; i < 6; i++) { const ix = -150 + i * 55 + CAM.x * par; const w = 5 + hash(i + 5) * 9, h = 0.5 + hash(i + 8) * 0.9; if (!onScreen(ix - w, ix + w)) continue; C.beginPath(); C.moveTo(ix - w, horizonY); C.quadraticCurveTo(ix - w * 0.4, horizonY + h, ix, horizonY + h * 0.9); C.quadraticCurveTo(ix + w * 0.5, horizonY + h * 1.1, ix + w, horizonY); C.closePath(); C.fillStyle = mix('#7e9c86', PAL.seaFar, 0.45); C.fill(); }
  C.globalAlpha = 0.35; for (let i = 0; i < 6; i++) { const y = horizonY * (0.15 + i * 0.14); const off = (T * (0.4 + i * 0.1)) % 3; C.beginPath(); for (let x = Math.floor(x0 / 3) * 3 - 3 + off; x < x1; x += 3) { C.moveTo(x, y); C.lineTo(x + 1.2, y); } C.strokeStyle = '#ffffff'; C.lineWidth = 0.04; C.stroke(); } C.globalAlpha = 1;
}
function drawPalm(x, y, h, t, lean = 0.15) {
  if (!onScreen(x - 4, x + 4)) return;
  const sway = ULTRA ? 0 : Math.sin(t * 1.1 + x) * 0.12 + WIND.x * 0.03;
  const tx = x + (lean + sway) * h, ty = y + h;
  C.beginPath(); C.moveTo(x - 0.22, y); C.quadraticCurveTo(x + lean * h * 0.3, y + h * 0.55, tx - 0.12, ty); C.lineTo(tx + 0.12, ty); C.quadraticCurveTo(x + lean * h * 0.3 + 0.25, y + h * 0.55, x + 0.22, y); C.closePath(); C.fillStyle = '#b98555'; C.fill();
  for (let i = 0; i < 6; i++) { const yy = y + h * (0.15 + i * 0.13); line(x + (lean) * (yy - y) * 0.55 - 0.18, yy, x + lean * (yy - y) * 0.55 + 0.2, yy + 0.05, '#9c6c42', 0.05); }
  const fronds = [[-2.3, -0.9], [-1.6, 0.3], [-0.4, 0.9], [0.9, 0.7], [2.1, -0.4], [1.3, -1.3], [-1.1, -1.5]];
  for (let i = 0; i < fronds.length; i++) { const [fx, fy] = fronds[i]; const w = Math.sin(t * 1.6 + i + x) * 0.15 * (ULTRA ? 0 : 1); const ex = tx + fx * 1.15, ey = ty + fy * 1.0 + w; C.beginPath(); C.moveTo(tx, ty); C.quadraticCurveTo((tx + ex) / 2 + fy * 0.3, (ty + ey) / 2 + 0.7, ex, ey); C.quadraticCurveTo((tx + ex) / 2 - fy * 0.1, (ty + ey) / 2 + 0.2, tx, ty); C.fillStyle = i % 2 ? '#4fb35f' : '#3f9a52'; C.fill(); }
  circle(tx - 0.12, ty - 0.12, 0.16, '#7a5230'); circle(tx + 0.12, ty - 0.18, 0.15, '#6b4628');
}
function drawUmbrella(x, y, color) {
  if (!onScreen(x - 2, x + 2)) return;
  line(x, y, x + 0.25, y + 2.4, '#e9e2d0', 0.07);
  C.beginPath(); C.moveTo(x + 0.25 - 1.5, y + 2.2); C.quadraticCurveTo(x + 0.25, y + 3.2, x + 0.25 + 1.5, y + 2.2); C.closePath(); C.fillStyle = color; C.fill();
  for (let i = 0; i < 3; i++) { C.beginPath(); C.moveTo(x + 0.25 - 1.5 + i, y + 2.2); C.quadraticCurveTo(x + 0.25 - 1 + i, y + 2.9, x + 0.25 - 0.5 + i, y + 2.2); C.fillStyle = 'rgba(255,255,255,.55)'; if (i % 2 === 0) C.fill(); }
}
function drawSandBand(x0, x1, top = 0, color = PAL.sand) {
  C.fillStyle = color; C.fillRect(x0, -9, x1 - x0, 9 + top);
  C.fillStyle = shade(color, -0.07); for (let i = Math.floor(x0); i < x1; i++) { if (hash(i) > 0.55) C.fillRect(i + hash(i + 3), -0.35 - hash(i + 5) * 2.5, 0.08, 0.05); }
  line(x0, top, x1, top, shade(color, 0.12), 0.05, 'butt');
}
/* pads: a red board on the back wall, a pulsing glow on the floor and chevrons over the spot to stand on */
function drawPad(p, t) {
  if (!onScreen(p.x - 2, p.x + 2)) return;
  const x = p.x; rr(x - 1.35, 1.1, 2.7, 2.5, 0.1, '#c92f2f', '#7a1f1f', 0.08); rr(x - 1.2, 1.25, 2.4, 2.2, 0.08, '#e04141');
  rr(x - 1.45, 3.55, 2.9, 0.35, 0.06, '#7a1f1f');
  worldText(p.label, x, 2.75, p.label.length > 5 ? 0.42 : 0.7, '#fff', '900', 'center', true, 2.2);
  worldText(p.count ? `${p.count} IN QUEUE` : (p.mode === 'practice' ? 'FREE PLAY' : 'STAND HERE'), x, 1.7, 0.2, '#fff', '900', 'center', false, 2.2);
  worldTf();
  const k = 0.45 + Math.sin(t * 2.4) * 0.2;
  C.fillStyle = `rgba(255,211,110,${0.25 + k * 0.25})`; C.fillRect(x - PAD_HALF, 0, PAD_HALF * 2, 0.07);
  const gl = C.createLinearGradient(0, 0, 0, 1.2); gl.addColorStop(0, `rgba(255,211,110,${0.22 * k + 0.08})`); gl.addColorStop(1, 'rgba(255,211,110,0)'); C.fillStyle = gl; C.fillRect(x - PAD_HALF, 0, PAD_HALF * 2, 1.2);
  if (!ULTRA) for (let i = 0; i < 3; i++) { const f = (t * 1.5 + i * 0.33) % 1; const a = Math.sin(f * Math.PI) * 0.85; poly([x - 0.25, 1.05 - f * 0.7 + 0.2, x + 0.25, 1.05 - f * 0.7 + 0.2, x, 1.05 - f * 0.7], `rgba(255,211,110,${a})`); }
}
function drawChest(x, y, s, tier, open) {
  const c = CHEST_TIERS[tier] || CHEST_TIERS[1];
  rr(x - 0.5 * s, y, 1.0 * s, 0.5 * s, 0.06 * s, c.body, shade(c.body, -0.35), 0.04 * s);
  for (const bx of [-0.3, 0.3]) rect(x + (bx - 0.06) * s, y, 0.12 * s, 0.5 * s, c.band);
  if (open) {
    const gl = C.createRadialGradient(x, y + 0.5 * s, 0, x, y + 0.6 * s, 0.9 * s); gl.addColorStop(0, alpha(c.glow, 0.9)); gl.addColorStop(1, alpha(c.glow, 0)); C.fillStyle = gl; C.fillRect(x - s, y + 0.3 * s, 2 * s, 1.2 * s);
    C.save(); C.translate(x - 0.5 * s, y + 0.5 * s); C.rotate(1.25); rr(0, 0, 1.02 * s, 0.22 * s, 0.05 * s, c.body, shade(c.body, -0.35), 0.04 * s); C.restore();
  } else { rr(x - 0.52 * s, y + 0.48 * s, 1.04 * s, 0.24 * s, 0.07 * s, shade(c.body, 0.08), shade(c.body, -0.35), 0.04 * s); for (const bx of [-0.3, 0.3]) rect(x + (bx - 0.06) * s, y + 0.48 * s, 0.12 * s, 0.24 * s, c.band); rr(x - 0.08 * s, y + 0.4 * s, 0.16 * s, 0.16 * s, 0.03 * s, c.band); }
}
function drawLobbyWorld(t) {
  const H = LOBBY.house, x0 = viewX0() - 2, x1 = viewX1() + 2;
  drawSkyScreen(false);
  drawHorizonSea(2.4);
  worldTf();
  // ---- sea on the left, under the pier ----
  if (x0 < LOBBY.shore + 2) {
    const g = C.createLinearGradient(0, 0, 0, -5); g.addColorStop(0, PAL.sea); g.addColorStop(1, shade(PAL.sea, -0.3)); C.fillStyle = g; C.fillRect(x0, -6, LOBBY.shore + 1 - x0, 5.75);
    C.beginPath(); C.moveTo(x0, -6); for (let x = Math.floor(x0); x <= LOBBY.shore + 1; x += 0.5) C.lineTo(x, -0.28 + Math.sin(x * 0.9 + t * 1.6) * 0.07); C.lineTo(LOBBY.shore + 1, -6); C.closePath(); C.fillStyle = alpha(PAL.sea, 0.9); C.fill();
    C.beginPath(); for (let x = Math.floor(x0); x <= LOBBY.shore; x += 0.5) C.lineTo(x, -0.26 + Math.sin(x * 0.9 + t * 1.6) * 0.07); C.strokeStyle = 'rgba(255,255,255,.6)'; C.lineWidth = 0.05; C.stroke();
  }
  // ---- sand ----
  drawSandBand(Math.max(x0, LOBBY.shore - 1.5), Math.min(x1, LOBBY.x1 + 2), 0);
  if (onScreen(LOBBY.shore - 3, LOBBY.shore + 3)) { C.beginPath(); C.moveTo(LOBBY.shore - 2, -6); C.lineTo(LOBBY.shore - 1.5, 0); C.lineTo(LOBBY.shore + 1, 0); C.lineTo(LOBBY.shore + 1, -6); C.fillStyle = PAL.sand; C.fill(); const f = Math.sin(t * 0.8) * 0.4; line(LOBBY.shore - 2.2 + f, -0.24, LOBBY.shore - 0.9 + f, -0.24, 'rgba(255,255,255,.7)', 0.08); }
  // ---- pier + hut ----
  if (x0 < LOBBY.shore + 1) {
    const py = LOBBY.pierY;
    for (let x = -120; x < LOBBY.shore; x += 3) if (onScreen(x - 1, x + 1)) rect(x - 0.12, -6, 0.24, 6 + py, '#7b5838');
    rect(Math.max(x0, -121), py - 0.25, Math.min(x1, LOBBY.shore) - Math.max(x0, -121), 0.25, '#b98555');
    for (let x = Math.ceil(Math.max(x0, -121)); x < Math.min(x1, LOBBY.shore); x++) line(x, py - 0.25, x, py, '#9c6c42', 0.03);
    for (const [sx, sy] of [[-75.2, 0.18], [-74.6, 0.0]]) rect(sx, 0, 0.6, sy + 0.2, '#a87848');
    for (let x = -104; x < LOBBY.shore; x += 2.5) if (onScreen(x - 1, x + 1)) { rect(x - 0.06, py, 0.12, 1.0, '#8b6340'); }
    if (onScreen(-106, LOBBY.shore)) { C.beginPath(); for (let x = -104; x < LOBBY.shore - 1; x += 2.5) { C.moveTo(x, py + 0.95); C.quadraticCurveTo(x + 1.25, py + 0.75, x + 2.5, py + 0.95); } C.strokeStyle = '#d8c39a'; C.lineWidth = 0.05; C.stroke(); }
    if (onScreen(-122, -104)) {
      const hx0 = LOBBY.hut.x0, hx1 = LOBBY.hut.x1;
      rect(hx0, py, hx1 - hx0, 4.2, '#c89a64');                                                      // back wall planks
      for (let x = hx0; x < hx1; x += 0.6) line(x, py, x, py + 4.2, 'rgba(90,60,30,.25)', 0.03);
      rr(-117.5, py + 1.6, 3.4, 1.6, 0.1, '#8fd3ee', '#7b5838', 0.12);                              // window onto the sea
      line(-115.8, py + 1.6, -115.8, py + 3.2, '#7b5838', 0.08);
      rr(-118.2, py, 3.0, 1.05, 0.06, '#8b5a33', '#6b4426', 0.05); rect(-118.4, py + 1.05, 3.4, 0.14, '#6b4426'); for (let i = 0; i < 3; i++) circle(-117.5 + i * 0.9, py + 1.35, 0.14, ['#ff8ab5', '#ffd23f', '#35a7ff'][i]);   // counter with a few emote tokens
      worldText('LIL WOMAN DEALS', -113.2, py + 3.7, 0.34, '#ffd6ea', '900', 'center', true);
      poly([hx0 - 0.8, py + 4.2, hx1 + 0.8, py + 4.2, (hx0 + hx1) / 2, py + 6.6], '#d9b36a', '#b8913e', 0.08);   // thatch roof
      for (let i = 0; i < 8; i++) line(hx0 - 0.4 + i * 2.2, py + 4.25, (hx0 + hx1) / 2, py + 6.4, 'rgba(150,110,40,.35)', 0.04);
      rect(hx1 - 0.3, py + 2.7, 0.3, 1.5, '#9c6c42');                                               // doorway header
      rect(hx0 - 0.3, py, 0.3, 4.2, '#9c6c42');
    }
  }
  // ---- beach props + the practice court ----
  if (x0 < H.x0 + 2) {
    drawPalm(-72.5, 0, 6.2, t, 0.18); drawPalm(-30, 0, 5.4, t, -0.12); drawPalm(-24, 0, 6.6, t, 0.1);
    drawUmbrella(-66.5, 0, '#e5484d'); drawUmbrella(-34.5, 0, '#3b8ff0');
    if (onScreen(-71, -68)) { rr(-71.5, 0, 2.2, 0.06, 0.02, '#ff8ab5'); rr(-68.2, 0, 0.5, 1.8, 0.25, '#3fc1c9', '#2a8f96', 0.04); }   // towel + surfboard
    if (onScreen(-45, -41)) { poly([-44.2, 0, -41.8, 0, -42.3, 0.6, -43.7, 0.6], '#e3c98a'); rect(-43.5, 0.6, 0.9, 0.45, '#e3c98a'); rect(-43.1, 1.05, 0.2, 0.25, '#e3c98a'); poly([-42.95, 1.3, -42.95, 1.62, -42.6, 1.5], '#e5484d'); }   // sandcastle
    const hl = COURT_L / 2, nx = LOBBY.beachNet;
    if (onScreen(nx - hl - 1, nx + hl + 1)) { line(nx - hl, 0.02, nx + hl, 0.02, '#3b8ff0', 0.06, 'butt'); for (const e of [-hl, hl]) rect(nx + e - 0.06, -0.05, 0.12, 0.15, '#3b8ff0'); }
  }
  // ---- the house ----
  if (onScreen(H.x0 - 1, H.x1 + 1)) drawHouse(t);
  // ---- NPCs stand in front of their booths ----
}
function drawHouse(t) {
  const H = LOBBY.house, st = H.stairs; const night = isNight;
  // outer shell: roof, walls
  poly([H.x0 - 1.4, H.roof + 0.1, H.x1 + 1.4, H.roof + 0.1, H.x1 + 0.6, H.roof + 1.6, H.x0 - 0.6, H.roof + 1.6], '#63bfc0', '#4a9ea0', 0.1);
  rect(H.x0 - 1.4, H.roof, H.x1 - H.x0 + 2.8, 0.35, '#f4efe4');
  // ground floor back wall + wainscot
  rect(H.x0, 0, H.x1 - H.x0, F2 - 0.3, '#f6ecd8'); rect(H.x0, 0, H.x1 - H.x0, 1.0, '#e8d6b4'); line(H.x0, 1.0, H.x1, 1.0, '#cdb58c', 0.06);
  // upstairs back wall
  rect(H.x0, F2, H.x1 - H.x0, H.roof - F2, '#efe3cc'); rect(H.x0, F2, st.x0 - H.x0, 0.8, '#e2cfab');
  // windows (the sea outside, lit up at night)
  const win = (x, y, w, h) => { if (!onScreen(x, x + w)) return; rr(x, y, w, h, 0.08, night ? '#ffd98a' : '#a9dcf3', '#c9a67a', 0.12); if (!night) { C.fillStyle = alpha(PAL.sea, 0.8); C.fillRect(x + 0.06, y + 0.06, w - 0.12, h * 0.35); } line(x + w / 2, y, x + w / 2, y + h, '#c9a67a', 0.06); };
  for (const x of [-17, -12]) win(x, 2.2, 2.2, 1.8);
  for (const x of [-18, -9, 10, 16]) win(x, F2 + 2.2, 2.4, 2.0);
  // floors
  const wood = '#d6b07d';
  rect(H.x0, -0.35, H.x1 - H.x0, 0.35, wood); for (let x = H.x0; x < H.x1; x += 1.6) line(x, -0.35, x, 0, 'rgba(120,80,40,.2)', 0.03);
  rect(H.x0, F2 - 0.3, st.x0 - H.x0, 0.3, wood); line(H.x0, F2, st.x0, F2, '#b88d58', 0.05);
  // stairs (background: you step onto them with Up)
  const steps = 14; for (let i = 0; i < steps; i++) { const xA = st.x1 - (i + 1) * (st.x1 - st.x0) / steps, xB = st.x1 - i * (st.x1 - st.x0) / steps; const y = stairsY(xB); rect(xA, 0, xB - xA, y + (F2 / steps), i % 2 ? '#c89f6c' : '#cfa874'); line(xA, y + F2 / steps, xB, y + F2 / steps, '#a57c4c', 0.05); }
  line(st.x0, F2 + 1.0, st.x1, 1.0, '#9c6c42', 0.07); for (let i = 0; i <= 5; i++) { const x = st.x0 + i * (st.x1 - st.x0) / 5; line(x, stairsY(x), x, stairsY(x) + 1.0, '#9c6c42', 0.05); }
  line(st.x0, F2, st.x0, F2 + 1.05, '#9c6c42', 0.06); line(st.x0 - 3, F2 + 1.05, st.x0, F2 + 1.05, '#9c6c42', 0.06);   // upstairs railing at the stairwell edge
  // ground floor props
  if (onScreen(-20, -8)) {
    rr(-19.4, 0, 1.4, 0.06, 0.02, '#e5484d');                                                                   // welcome mat
    rr(-17.6, 0, 4.4, 0.55, 0.15, '#4d7fc4', '#34598e', 0.05); rr(-17.8, 0.4, 4.8, 0.45, 0.18, '#5b8fd6', '#34598e', 0.05); rr(-17.9, 0.4, 0.5, 1.0, 0.18, '#5b8fd6', '#34598e', 0.05); rr(-13.4, 0.4, 0.5, 1.0, 0.18, '#5b8fd6', '#34598e', 0.05);   // couch
    rr(-19.6, 0, 0.8, 0.8, 0.12, '#c9764f'); for (let i = 0; i < 5; i++) ellipse(-19.2 + (i - 2) * 0.18, 1.2 + (i % 2) * 0.25, 0.14, 0.5, (i - 2) * 0.4, i % 2 ? '#4fb35f' : '#3f9a52');   // plant
    line(-11.5, 0, -11.5, 2.4, '#555', 0.05); poly([-12.1, 2.3, -10.9, 2.3, -11.2, 2.9, -11.8, 2.9], night ? '#ffe7a8' : '#f4e3c3');   // lamp
    rr(-17, 2.5, 3, 1.7, 0.08, '#223', '#111', 0.06); worldText('VBJ TV', -15.5, 3.35, 0.3, '#7fd3ff', '900');  // tv
  }
  // Lil Man Dealer's booth
  if (onScreen(-1, 6)) {
    rr(-0.6, 3.8, 5.6, 0.8, 0.1, '#23232b', '#111', 0.06); worldText('LIL MAN DEALS', 2.2, 4.2, 0.36, '#ffd23f', '900', 'center', true, 5.2); worldTf();
    rr(-0.4, 1.6, 5.2, 1.9, 0.1, 'rgba(0,0,0,.08)'); for (let i = 0; i < 4; i++) { const bx = 0.4 + i * 1.3; line(bx - 0.4, 2.4, bx + 0.4, 2.4, '#8b6340', 0.06); drawBallSkin(bx, 2.72, ['default', 'beach', 'basketball', 'gold'][i], 0, t, 0.26); }
    rr(3.4, 0, 1.6, 1.1, 0.08, '#2c2c34', '#15151a', 0.05); rect(3.3, 1.1, 1.8, 0.12, '#15151a');   // counter
  }
  for (const id in PADS) drawPad(PADS[id], t);
  worldTf();
  if (onScreen(34, 37)) { rr(34.6, 0, 0.9, 0.9, 0.12, '#c9764f'); for (let i = 0; i < 5; i++) ellipse(35.05 + (i - 2) * 0.2, 1.3 + (i % 2) * 0.3, 0.16, 0.55, (i - 2) * 0.4, i % 2 ? '#4fb35f' : '#3f9a52'); }
  // upstairs props
  if (onScreen(-20, 24)) {
    if (onScreen(-20, -13)) { for (let i = 0; i < 2; i++) { const ax = -18.6 + i * 1.9; rr(ax, F2, 1.5, 2.3, 0.1, i ? '#6a3fc4' : '#e5484d', '#222', 0.06); rr(ax + 0.2, F2 + 1.2, 1.1, 0.8, 0.06, night ? '#9ff' : '#1f2b4a'); circle(ax + 0.45, F2 + 0.9, 0.08, '#ffd23f'); circle(ax + 0.95, F2 + 0.9, 0.08, '#3ecf5a'); } worldText('ARCADE', -16.8, F2 + 2.75, 0.3, '#ffd23f', '900', 'center', true); worldTf(); }
    if (onScreen(-13, -6)) { rr(-12.4, F2, 4.6, 2.6, 0.08, '#9c6c42', '#6b4426', 0.06); for (let r = 0; r < 2; r++) line(-12.3, F2 + 0.9 + r * 0.9, -7.9, F2 + 0.9 + r * 0.9, '#6b4426', 0.06); for (let i = 0; i < 4; i++) { const tx = -11.6 + i * 1.1; poly([tx - 0.2, F2 + 1.0, tx + 0.2, F2 + 1.0, tx + 0.12, F2 + 1.2, tx + 0.18, F2 + 1.55, tx - 0.18, F2 + 1.55, tx - 0.12, F2 + 1.2], '#f5c542'); } worldText('TROPHIES', -10.1, F2 + 2.35, 0.24, '#fff3c4'); worldTf(); }
    if (onScreen(0, 10)) { rr(0.4, F2 + 3.4, 8.4, 0.9, 0.1, '#7a1218', '#4a0a0e', 0.06); worldText('BIG MAN DEALS', 4.6, F2 + 3.85, 0.42, '#ffd23f', '900', 'center', true, 8); worldTf(); rr(6.2, F2, 2.2, 1.2, 0.08, '#b3242a', '#7a1218', 0.05); rect(6.1, F2 + 1.2, 2.4, 0.14, '#7a1218'); for (let i = 0; i < 4; i++) drawChest(0.9 + i * 1.3, F2 + 1.55, 0.95, i + 1, false); line(0.3, F2 + 1.52, 5.9, F2 + 1.52, '#6b4426', 0.08); }
    if (onScreen(12, 24)) { for (let i = 0; i < 3; i++) ellipse(13 + i * 1.6, F2 + 0.45, 0.7, 0.48, 0, ['#ff8a1f', '#3b8ff0', '#3ecf5a'][i]); rr(19, F2, 2.6, 3.2, 0.08, '#9c6c42', '#6b4426', 0.06); for (let r = 0; r < 3; r++) { line(19.1, F2 + 1 + r, 21.5, F2 + 1 + r, '#6b4426', 0.06); for (let b = 0; b < 6; b++) rect(19.25 + b * 0.36, F2 + 0.05 + r, 0.24, 0.8, ['#e5484d', '#3b8ff0', '#f5c542', '#3ecf5a', '#b06bff', '#ff8a1f'][(b + r) % 6]); } }
  }
  // walls at the two ends (left one has the door)
  rect(H.x0 - 0.6, H.door, 0.6, H.roof - H.door, '#f4efe4'); rect(H.x1, -0.35, 0.6, H.roof + 0.35, '#f4efe4');
  if (night) { C.save(); C.globalCompositeOperation = 'lighter'; for (const [lx, ly] of [[-6, F2 - 0.4], [8, F2 - 0.4], [16, F2 - 0.4], [-4, H.roof - 0.4], [10, H.roof - 0.4]]) { if (!onScreen(lx - 4, lx + 4)) continue; const g = C.createRadialGradient(lx, ly, 0, lx, ly - 1.5, 4.5); g.addColorStop(0, 'rgba(255,220,150,.28)'); g.addColorStop(1, 'rgba(255,220,150,0)'); C.fillStyle = g; C.fillRect(lx - 5, ly - 5, 10, 5.2); } C.restore(); }
}
/* drawn after the players: door jambs, the pier's front posts */
function drawLobbyFront(t) {
  const H = LOBBY.house;
  if (onScreen(H.x0 - 1, H.x0 + 1)) { rect(H.x0 - 0.6, 0, 0.18, H.door, '#e4dccb'); rect(H.x0 - 0.18, 0, 0.18, H.door, '#e4dccb'); rect(H.x0 - 0.6, H.door - 0.2, 0.6, 0.2, '#d6ccb6'); }
  if (onScreen(LOBBY.hut.x1 - 1, LOBBY.hut.x1 + 1)) rect(LOBBY.hut.x1 - 0.3, LOBBY.pierY, 0.3, 2.7, '#9c6c42');
  if (viewX0() < LOBBY.shore) for (let x = -119; x < LOBBY.shore; x += 6) if (onScreen(x - 1, x + 1)) { rect(x - 0.15, -6, 0.3, 6 + LOBBY.pierY - 0.2, '#6b4a2e'); }
}

/* =====================================================================
   MATCH MAPS
   ===================================================================== */
function drawBeachCourt(t, cd) {
  drawSkyScreen(false); drawHorizonSea(2.6); worldTf();
  drawSandBand(viewX0() - 1, viewX1() + 1, 0);
  const hw = cd.half;
  drawPalm(-hw - 7, 0, 6.4, t, 0.14); drawPalm(hw + 6.5, 0, 5.8, t, -0.12); drawPalm(-hw - 11, 0, 5.2, t, -0.1); drawPalm(hw + 11, 0, 6.8, t, 0.1);
  drawUmbrella(-hw - 4, 0, '#e5484d'); drawUmbrella(hw + 3.5, 0, '#3ecf5a');
  for (let i = 0; i < 6; i++) { const sx = (i < 3 ? -1 : 1) * (hw + 2 + (i % 3) * 1.6); drawSpectator(sx, 0, i, t, sx < 0 ? 1 : -1); }
  line(-hw, 0.02, hw, 0.02, '#3b8ff0', 0.07, 'butt'); for (const e of [-hw, hw]) rect(e - 0.07, -0.06, 0.14, 0.16, '#3b8ff0');
}
function drawSpectator(x, y, i, t, f) {
  if (!onScreen(x - 1, x + 1)) return;
  const cols = ['#e5484d', '#3b8ff0', '#f5c542', '#3ecf5a', '#b06bff', '#ff8a1f'];
  const hop = (S.match && S.match.state === 'point') ? Math.max(0, Math.sin(t * 9 + i)) * 0.25 : Math.max(0, Math.sin(t * 2 + i * 1.7)) * 0.03;
  rr(x - 0.28, y + hop, 0.56, 0.95, 0.24, cols[i % 6]); circle(x, y + hop + 1.2, 0.26, ['#f3d1b0', '#d9a878', '#8a5a3a'][i % 3]); circle(x + f * 0.1, y + hop + 1.23, 0.035, '#27314d');
}
function drawGym(t, cd) {
  worldTf(); const x0 = viewX0() - 1, x1 = viewX1() + 1; const W = cd.wall;
  const g = C.createLinearGradient(0, 0, 0, 14); g.addColorStop(0, '#e9e4da'); g.addColorStop(1, '#cfd7e2'); C.fillStyle = g; C.fillRect(x0, 0, x1 - x0, 16);
  rect(x0, 10.7, x1 - x0, 6, '#9aa4b3'); for (let x = Math.floor(x0 / 4) * 4; x < x1; x += 4) { rect(x, 10.7, 0.25, 6, '#7f8898'); if (!ULTRA) { const on = isNight ? 1 : 0.55; rr(x + 1.2, 10.45, 1.6, 0.25, 0.08, `rgba(255,250,225,${on})`); } }
  // bleachers + crowd on the back wall
  for (let r = 0; r < 4; r++) rect(-W + 0.6, 2.6 + r * 1.1, 2 * W - 1.2, 0.35, '#8b95a6');
  for (let i = 0; i < 64; i++) { const r = i % 4, k = Math.floor(i / 4); const sx = -W + 1.4 + k * ((2 * W - 2.8) / 16) + (r % 2) * 0.5; if (!onScreen(sx - 1, sx + 1)) continue; const cheer = S.match && S.match.state === 'point' ? Math.max(0, Math.sin(t * 10 + i)) * 0.18 : Math.max(0, Math.sin(t * 1.5 + i * 2.1)) * 0.03; const cy = 2.95 + r * 1.1 + cheer; const col = ['#e5484d', '#3b8ff0', '#f5c542', '#3ecf5a', '#b06bff', '#ff8a1f', '#ffffff', '#2a2a33'][i % 8]; rr(sx - 0.24, cy, 0.48, 0.55, 0.2, col); circle(sx, cy + 0.72, 0.21, ['#f3d1b0', '#d9a878', '#8a5a3a'][i % 3]); }
  // banners + scoreboard
  for (const [bx, col, txt] of [[-W + 3, '#1d1e25', 'BLACK'], [W - 3, '#f5f5f5', 'WHITE']]) { rr(bx - 1.3, 7.6, 2.6, 2.4, 0.08, col, '#8d97a6', 0.06); worldText(txt, bx, 8.8, 0.42, col === '#f5f5f5' ? '#111' : '#d9b44a', '900', 'center', true, 2.4); worldTf(); }
  rr(-3.2, 7.4, 6.4, 2.7, 0.14, '#15161c', '#3a3d4a', 0.1);
  const M = S.match; if (M) { worldText(String(M.score.A || 0), -1.7, 9.0, 1.05, '#ffffff'); worldText(String(M.score.B || 0), 1.7, 9.0, 1.05, '#ffffff'); worldText('-', 0, 9.0, 0.8, '#ffffff'); worldText(TEAM_NAME.A, -1.7, 7.9, 0.26, '#aaa'); worldText(TEAM_NAME.B, 1.7, 7.9, 0.26, '#aaa'); worldTf(); }
  // floor
  rect(x0, -9, x1 - x0, 9, '#d9a86a'); for (let x = Math.floor(x0); x < x1; x += 1.2) line(x, -9, x, 0, 'rgba(120,70,20,.15)', 0.03);
  rect(-cd.half, -0.12, cd.half * 2, 0.12, '#e8864a'); rect(-cd.half - 1.5, -0.12, 1.5, 0.12, '#3b7bd0'); rect(cd.half, -0.12, 1.5, 0.12, '#3b7bd0');
  for (const e of [-cd.half, cd.half, -3.4, 3.4]) rect(e - 0.05, -0.12, 0.1, 0.14, '#ffffff');
  // side walls (padded)
  for (const s of [-1, 1]) { rect(s < 0 ? x0 : W, 0, s < 0 ? -W - x0 : x1 - W, 11, '#c3ccd8'); rr(s * W - (s < 0 ? 0.5 : 0), 0, 0.5, 2.2, 0.08, '#2f5fd0'); }
}

/* =====================================================================
   EFFECTS: particles, hit flashes, lightning, landing marks and the score effects
   ===================================================================== */
let GFX = 'high';
const FX_LIST = [];                                  // timed effects: { type, t, dur, update(dt) -> alive, draw() }
const PARTS = [];                                    // particles
const maxParts = () => GFX === 'low' ? 260 : 900;
function addPart(p) { if (ULTRA) return; if (PARTS.length >= maxParts()) PARTS.shift(); p.max = p.life; PARTS.push(p); }
const TIMESTOP_R = 3.4, TIMESTOP_SLOW = 0.12;        // clock radius; balls and players inside move at 12% speed
function updateFx(dt) {
  for (let i = FX_LIST.length - 1; i >= 0; i--) { const f = FX_LIST[i]; f.t += dt; if (f.update) f.update(dt); if (f.t >= f.dur) FX_LIST.splice(i, 1); }
  for (let i = PARTS.length - 1; i >= 0; i--) {
    const p = PARTS[i]; p.life -= dt; if (p.life <= 0) { PARTS.splice(i, 1); continue; }
    const dr = Math.exp(-(p.drag || 0) * dt); p.vx *= dr; p.vy *= dr; p.vy -= (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.kind === 'conf') { p.rot += p.vr * dt; p.x += Math.sin(p.life * 7 + p.seed) * dt * 0.6; }
    if (p.floor !== undefined && p.y < p.floor) { p.y = p.floor; p.vy *= -0.3; p.vx *= 0.6; }
  }
}
function drawParts() {
  for (const p of PARTS) {
    const k = p.life / p.max, a = p.fade === false ? 1 : Math.min(1, k * 1.6);
    if (p.kind === 'dust') { C.globalAlpha = a * 0.55; circle(p.x, p.y, p.size * (1.6 - k * 0.6), p.col); }
    else if (p.kind === 'spark') { C.globalAlpha = a; const l = 0.06 + Math.hypot(p.vx, p.vy) * 0.025; const n = Math.hypot(p.vx, p.vy) || 1; line(p.x, p.y, p.x - p.vx / n * l, p.y - p.vy / n * l, p.col, p.size); }
    else if (p.kind === 'conf') { C.globalAlpha = a; C.save(); C.translate(p.x, p.y); C.rotate(p.rot); C.fillStyle = p.col; C.fillRect(-p.size, -p.size * 0.45 * Math.abs(Math.cos(p.rot * 2)), p.size * 2, p.size * 0.9 * Math.abs(Math.cos(p.rot * 2)) + 0.01); C.restore(); }
    else if (p.kind === 'heart') { C.globalAlpha = a; heartPath(p.x, p.y, p.size); C.fillStyle = p.col; C.fill(); }
    else if (p.kind === 'smoke') { C.globalAlpha = a * 0.35; circle(p.x, p.y, p.size * (2 - k), p.col); }
    else if (p.kind === 'star') { C.globalAlpha = a; star(p.x, p.y, p.size, p.col); }
    else { C.globalAlpha = a; circle(p.x, p.y, p.size, p.col); }
  }
  C.globalAlpha = 1;
}
function heartPath(x, y, s) { C.beginPath(); C.moveTo(x, y - s * 0.9); C.bezierCurveTo(x - s * 1.3, y - s * 0.1, x - s * 0.9, y + s * 0.95, x, y + s * 0.4); C.bezierCurveTo(x + s * 0.9, y + s * 0.95, x + s * 1.3, y - s * 0.1, x, y - s * 0.9); C.closePath(); }
function star(x, y, s, col) { C.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? s * 0.35 : s; C.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } C.closePath(); C.fillStyle = col; C.fill(); }
function drawFx(layer = 'mid') { for (const f of FX_LIST) if ((f.layer || 'mid') === layer && f.draw) { C.save(); f.draw(); C.restore(); } }
/* small stuff */
function puff(x, y, n, spread, up, col) { for (let i = 0; i < n; i++) addPart({ kind: 'dust', x: x + (Math.random() - 0.5) * 0.4, y: y + 0.05, vx: (Math.random() - 0.5) * spread * 2, vy: Math.random() * up, g: 1.5, drag: 3, life: 0.45 + Math.random() * 0.25, size: 0.08 + Math.random() * 0.08, col }); }
function jumpFx(x, y, col) { puff(x, y, 7, 1.3, 0.9, col); }
function landFx(x, y, col) { puff(x, y, 9, 1.8, 0.6, col); }
function sparkle(x, y, n, col, spread = 1.4, up = 0.6, dur = 0.35, size = 0.035, dx = 0, dy = 0) {
  for (let i = 0; i < n; i++) { const a = Math.random() * TAU, sp = spread * (2 + Math.random() * 4); addPart({ kind: 'spark', x, y, vx: Math.cos(a) * sp + dx * 5, vy: Math.sin(a) * sp + up * 3 + dy * 5, g: 6, drag: 2, life: dur * (0.6 + Math.random() * 0.6), size, col }); }
}
function ringFx(x, y, col, r0, r1, dur, w = 0.06) { if (ULTRA) return; FX_LIST.push({ t: 0, dur, draw() { const k = this.t / this.dur; circle(x, y, r0 + (r1 - r0) * k, null, alpha(col, 1 - k), w * (1 - k * 0.5)); } }); }
function actionFx(kind, x, y, f) {                  // a quick visual swoosh at the hands for each touch
  if (ULTRA) return;
  if (kind === 'set') ringFx(x + f * 0.25, y + 2.05, '#ffffff', 0.12, 0.55, 0.3, 0.05);
  else if (kind === 'bump') FX_LIST.push({ t: 0, dur: 0.25, draw() { const k = this.t / this.dur; C.beginPath(); C.arc(x + f * 0.3, y + 0.7, 0.55 + k * 0.3, f > 0 ? -0.6 : Math.PI - 0.9, f > 0 ? 0.9 : Math.PI + 0.6); C.strokeStyle = alpha('#ffffff', 0.8 * (1 - k)); C.lineWidth = 0.07; C.stroke(); } });
  else if (kind === 'block') FX_LIST.push({ t: 0, dur: 0.3, draw() { const k = this.t / this.dur; for (let i = -2; i <= 2; i++) { const a = Math.PI / 2 + i * 0.3; line(x + Math.cos(a) * (0.35 + k * 0.4), y + 2.3 + Math.sin(a) * (0.35 + k * 0.4), x + Math.cos(a) * (0.6 + k * 0.6), y + 2.3 + Math.sin(a) * (0.6 + k * 0.6), alpha('#ffffff', 1 - k), 0.05); } } });
  else if (kind === 'spike') FX_LIST.push({ t: 0, dur: 0.22, draw() { const k = this.t / this.dur; C.beginPath(); C.arc(x - f * 0.05, y + 1.9, 0.8, f > 0 ? 0.2 : Math.PI - 1.5, f > 0 ? 1.5 : Math.PI - 0.2); C.strokeStyle = alpha('#fff6c0', 0.9 * (1 - k)); C.lineWidth = 0.1 * (1 - k) + 0.02; C.stroke(); } });
}
function lightningFx(x, y, dx, dy, bolt = '#bfe6ff', glow = '#9fd4ff', n = 6) {
  if (ULTRA) return;
  const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
  const make = () => { const bolts = []; for (let i = 0; i < n; i++) { const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 2.4, L = 0.6 + Math.random() * 1.1; const pts = [x, y]; let px = x, py = y; for (let s = 1; s <= 5; s++) { px = x + Math.cos(a) * L * s / 5 + (Math.random() - 0.5) * 0.25; py = y + Math.sin(a) * L * s / 5 + (Math.random() - 0.5) * 0.25; pts.push(px, py); } bolts.push(pts); } return bolts; };
  let bolts = make(), re = 0;
  FX_LIST.push({ t: 0, dur: 0.3, update(dt) { re += dt; if (re > 0.06) { re = 0; bolts = make(); } }, draw() {
    const k = 1 - this.t / this.dur; C.globalCompositeOperation = 'lighter';
    circle(x, y, 0.5 * k + 0.1, alpha(glow, 0.35 * k));
    for (const p of bolts) { C.beginPath(); C.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) C.lineTo(p[i], p[i + 1]); C.strokeStyle = alpha(glow, 0.5 * k); C.lineWidth = 0.1; C.lineJoin = 'round'; C.stroke(); C.strokeStyle = alpha(bolt, k); C.lineWidth = 0.035; C.stroke(); }
  } });
  sparkle(x, y, 8, bolt, 1.2, 0.3, 0.3, 0.03, dx, dy);
}
const MARKS = [];
function landingMark(x, y, inCourt) { if (ULTRA) return; MARKS.push({ x, y, t: 0, col: inCourt ? '#3ecf7a' : '#ff4d5e' }); if (MARKS.length > 8) MARKS.shift(); }
function drawMarks(dt) { for (let i = MARKS.length - 1; i >= 0; i--) { const m = MARKS[i]; m.t += dt; if (m.t > 1.6) { MARKS.splice(i, 1); continue; } const a = 1 - m.t / 1.6; ellipse(m.x, m.y + 0.02, 0.38 + m.t * 0.12, 0.08, 0, alpha(m.col, 0.45 * a), alpha(m.col, a), 0.035); } }
/* impact frames: a hard black-and-white frame, then a white flash (only for players near the effect) */
let impactTimer = 0, skyFlash = 0;
function impactFrame(x, y, frames = 1, nearX = null) {
  if (ULTRA) return; if (nearX !== null && Math.abs(nearX - x) > 24) return;
  clearTimeout(impactTimer); canvas.classList.add('impact');
  const fl = $('#impactFlash'); fl.style.transition = 'none'; fl.style.opacity = '0';
  impactTimer = setTimeout(() => { canvas.classList.remove('impact'); fl.style.transition = 'none'; fl.style.opacity = nearX !== null && Math.abs(nearX - x) < 6 ? '1' : '0.7'; requestAnimationFrame(() => { fl.style.transition = 'opacity .22s ease-out'; fl.style.opacity = '0'; }); }, 40 * frames);
}

/* ---- score effects: play where a ball you hit lands in, across the net ---- */
function playScoreFx(id, x, y0, model = 'boy', nearX = null) {
  if (ULTRA) return;
  if (id !== 'hammock') impactFrame(x, y0, id === 'blackhole' || id === 'smite' ? 2 : 1, nearX);
  if (id === 'confetti') fxConfetti(x, y0);
  else if (id === 'heart') fxHeart(x, y0);
  else if (id === 'smite') fxSmite(x, y0);
  else if (id === 'timestop') fxTimeStop(x, y0);
  else if (id === 'hammock') fxHammock(x, y0, model);
  else if (id === 'blackhole') fxBlackHole(x, y0);
}
function fxConfetti(x, y0) {
  const cols = ['#ff4d5e', '#ffd23f', '#35a7ff', '#3ecf7a', '#b06bff', '#ff8a1f', '#ffffff'];
  for (let i = 0; i < 150; i++) { const a = Math.PI / 2 + (Math.random() - 0.5) * 1.9, sp = 5 + Math.random() * 8; addPart({ kind: 'conf', x: x + (Math.random() - 0.5) * 0.6, y: y0 + 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 7, drag: 1.6, life: 2.2 + Math.random() * 1.2, size: 0.07 + Math.random() * 0.05, col: cols[i % cols.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, seed: Math.random() * 9, floor: y0 + 0.02 }); }
  ringFx(x, y0 + 0.5, '#ffffff', 0.2, 2.2, 0.45, 0.08); ringFx(x, y0 + 0.5, '#ffd23f', 0.1, 1.5, 0.35, 0.06);
}
function fxHeart(x, y0) {
  for (let i = 0; i < 60; i++) { const a = Math.random() * TAU, sp = 2.5 + Math.random() * 4; addPart({ kind: i % 4 ? 'spark' : 'heart', x, y: y0 + 0.4, vx: Math.cos(a) * sp, vy: 3.5 + Math.random() * 4.5, g: 7, drag: 0.6, life: 1.4 + Math.random() * 0.8, size: i % 4 ? 0.04 : 0.1, col: ['#ffd6ec', '#ff7ac8', '#ff2d9a'][i % 3] }); }
  FX_LIST.push({ t: 0, dur: 2.4, draw() {
    const k = this.t / this.dur, fade = 1 - Math.max(0, k - 0.65) / 0.35, hy = y0 + 0.9 + this.t * 1.3, s = 0.55 * (1.3 + Math.sin(this.t * 12) * 0.14);
    C.globalCompositeOperation = 'lighter'; circle(x, hy, 1.1, alpha('#ff4fa0', 0.18 * fade)); C.globalCompositeOperation = 'source-over';
    C.globalAlpha = fade; heartPath(x, hy, s); C.fillStyle = '#ff3d8a'; C.fill(); C.lineWidth = 0.05; C.strokeStyle = '#ffffff'; C.stroke(); heartPath(x - s * 0.3, hy + s * 0.25, s * 0.22); C.fillStyle = 'rgba(255,255,255,.55)'; C.fill();
    for (let i = 0; i < 10; i++) { const a = this.t * 2.2 + i / 10 * TAU; const r = 1.1 + (i % 3) * 0.25; const mx = x + Math.cos(a) * r, my = y0 + 0.4 + this.t * (1.1 + (i % 4) * 0.2) + Math.sin(a) * 0.3; heartPath(mx, my, 0.14 + 0.04 * Math.sin(a)); C.fillStyle = '#ff5aa8'; C.fill(); }
    C.globalAlpha = 1; ellipse(x, y0 + 0.03, 0.4 + this.t * 5, 0.12 + this.t * 0.6, 0, null, alpha('#ff8ad0', Math.max(0, 0.9 - this.t * 1.2)), 0.07);
  } });
}
function jagged(x0, y0, x1, y1, n, j) { const pts = [x0, y0]; for (let i = 1; i < n; i++) { const f = i / n; pts.push(x0 + (x1 - x0) * f + (Math.random() - 0.5) * j, y0 + (y1 - y0) * f + (Math.random() - 0.5) * j * 0.2); } pts.push(x1, y1); return pts; }
function fxSmite(x, y0) {
  const bolts = [jagged(x + 3, y0 + 30, x, y0, 14, 1.6), jagged(x - 2, y0 + 30, x, y0, 14, 2.4), jagged(x + 1, y0 + 30, x, y0, 12, 1.0)];
  const forks = bolts.map(b => { const i = 4 + Math.floor(Math.random() * 5); return jagged(b[i * 2], b[i * 2 + 1], b[i * 2] + (Math.random() - 0.5) * 7, b[i * 2 + 1] - 4 - Math.random() * 4, 6, 1.2); });
  const cracks = []; for (let i = 0; i < 8; i++) { const d = (i % 2 ? 1 : -1) * (0.6 + Math.random() * 3.2); cracks.push(jagged(x, y0 - 0.02, x + d, y0 - 0.1 - Math.random() * 0.8, 4, 0.3)); }
  skyFlash = 1;
  for (let i = 0; i < 30; i++) addPart({ kind: 'spark', x, y: y0 + 0.2, vx: (Math.random() - 0.5) * 16, vy: 3 + Math.random() * 9, g: 14, drag: 0.8, life: 0.6 + Math.random() * 0.6, size: 0.04, col: i % 2 ? '#ffffff' : '#bcd4ff', floor: y0 });
  let smokeAcc = 0;
  FX_LIST.push({ t: 0, dur: 3.6, update(dt) { if (this.t > 0.25 && this.t < 2.6) { smokeAcc += dt; while (smokeAcc > 0.05) { smokeAcc -= 0.05; addPart({ kind: 'smoke', x: x + (Math.random() - 0.5) * 1.4, y: y0 + 0.2, vx: (Math.random() - 0.5) * 0.4 + WIND.x * 0.1, vy: 0.8 + Math.random() * 0.8, g: 0, drag: 0.3, life: 1.8, size: 0.35 + Math.random() * 0.3, col: '#4a4a52' }); } } }, draw() {
    const t = this.t; const on = (t < 0.07) || (t > 0.11 && t < 0.15) || (t > 0.22 && t < 0.27);
    const sc = Math.max(0, 1 - t / 3.4); ellipse(x, y0 + 0.02, 2.6, 0.22, 0, `rgba(20,16,12,${0.55 * sc})`);
    for (const c of cracks) { C.beginPath(); C.moveTo(c[0], c[1]); for (let i = 2; i < c.length; i += 2) C.lineTo(c[i], c[i + 1]); const heat = Math.max(0, 1 - t / 1.4); C.strokeStyle = t < 0.3 ? '#ffffff' : `rgba(255,${120 + heat * 100},40,${heat})`; C.lineWidth = 0.06; C.stroke(); }
    if (on) { C.globalCompositeOperation = 'lighter'; for (const b of bolts.concat(forks)) { C.beginPath(); C.moveTo(b[0], b[1]); for (let i = 2; i < b.length; i += 2) C.lineTo(b[i], b[i + 1]); C.strokeStyle = 'rgba(150,170,255,.55)'; C.lineWidth = 0.45; C.lineJoin = 'round'; C.stroke(); C.strokeStyle = '#ffffff'; C.lineWidth = 0.12; C.stroke(); } }
    const fl = Math.max(0, 1 - t / 0.35); if (fl > 0) { C.globalCompositeOperation = 'lighter'; circle(x, y0 + 0.5, 0.5 + t * 7, `rgba(210,225,255,${fl * 0.7})`); }
  } });
}
function fxTimeStop(x, y0) {
  const shards = []; for (let i = 0; i < 26; i++) shards.push({ a: Math.random() * TAU, r: 0.3 + Math.random() * 2.8, h: Math.random() * 4, v: 0.4 + Math.random() * 0.8 });
  FX_LIST.push({ type: 'timestop', x, y: y0, r: TIMESTOP_R, t: 0, dur: 6, update() { const grow = Math.min(1, this.t / 0.35); this.r = TIMESTOP_R * (0.6 + 0.4 * grow); }, draw() {
    const t = this.t, grow = Math.min(1, t / 0.35), fade = 1 - Math.max(0, t / this.dur - 0.8) / 0.2, pulse = 0.85 + 0.15 * Math.sin(t * 6); const R = this.r, cy = y0 + R * 0.95;
    C.globalAlpha = fade * grow;
    const g = C.createRadialGradient(x, cy, 0, x, cy, R); g.addColorStop(0, 'rgba(120,190,255,.28)'); g.addColorStop(1, 'rgba(60,140,255,.12)'); circle(x, cy, R, g, `rgba(170,215,255,${0.9 * pulse})`, 0.12);
    circle(x, cy, R * 0.9, null, 'rgba(210,235,255,.6)', 0.04);
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; line(x + Math.cos(a) * R * 0.78, cy + Math.sin(a) * R * 0.78, x + Math.cos(a) * R * (i % 3 ? 0.86 : 0.9), cy + Math.sin(a) * R * (i % 3 ? 0.86 : 0.9), '#e8f4ff', i % 3 ? 0.05 : 0.1); }
    const mA = Math.PI / 2 + t * 5.5, hA = Math.PI / 2 + t * 5.5 / 12 + 1.2;                // the hands race round backwards
    line(x, cy, x + Math.cos(mA) * R * 0.72, cy + Math.sin(mA) * R * 0.72, '#ffffff', 0.09); line(x, cy, x + Math.cos(hA) * R * 0.45, cy + Math.sin(hA) * R * 0.45, '#ffffff', 0.14); circle(x, cy, 0.14, '#ffffff');
    C.globalCompositeOperation = 'lighter'; for (const s of shards) { const hy = (s.h + t * s.v) % 4; const sx = x + Math.cos(s.a) * s.r * 0.6; line(sx, y0 + hy, sx, y0 + hy + 0.2, 'rgba(160,210,255,.8)', 0.04); }
    C.globalAlpha = 1;
  } });
}
function fxHammock(x, y0, model) {
  const rig = new Rig2D('white', model); rig.setPose('lie'); rig.grounded = false; rig.pitch = rig.pitchTarget = -1.42; rig.snap();
  FX_LIST.push({ t: 0, dur: 5, layer: 'back', update(dt) { rig.update(dt, T); }, draw() {
    const t = this.t, grow = Math.min(1, t / 0.4), fade = 1 - Math.max(0, t / this.dur - 0.85) / 0.15; C.globalAlpha = fade;
    C.save(); C.translate(x, y0); C.scale(1, grow); drawPalm(-2.4, 0, 3.6, T, -0.05); drawPalm(2.4, 0, 3.4, T, 0.05); C.restore();
    if (grow < 1) { C.globalAlpha = 1; return; }
    const sw = Math.sin(t * 2.2) * 0.15;
    C.beginPath(); C.moveTo(x - 2.2, y0 + 2.2); C.quadraticCurveTo(x + sw, y0 + 0.4, x + 2.2, y0 + 2.2); C.quadraticCurveTo(x + sw, y0 + 0.75, x - 2.2, y0 + 2.2); C.fillStyle = '#ff8a5a'; C.fill();
    for (let i = 0; i < 4; i++) { C.beginPath(); C.moveTo(x - 2.2, y0 + 2.2); C.quadraticCurveTo(x + sw, y0 + 0.45 + i * 0.08, x + 2.2, y0 + 2.2); C.strokeStyle = i % 2 ? '#ffffff' : '#3b8ff0'; C.lineWidth = 0.05; C.stroke(); }
    rig.draw(x - 0.9 + sw, y0 + 1.25, 1); C.globalAlpha = 1;
  } });
}
function fxBlackHole(x, y0) {
  const cy = y0 + 1.7; const motes = []; for (let i = 0; i < 60; i++) motes.push({ a: Math.random() * TAU, r: 1.5 + Math.random() * 5, s: 0.6 + Math.random() * 1.2 });
  FX_LIST.push({ type: 'blackhole', x, y: cy, pull: 6.9, core: 0.9, t: 0, dur: 5.5, update(dt) { for (const m of motes) { m.a += dt * m.s * 2.5 / Math.max(0.5, m.r); m.r -= dt * m.s * 1.1; if (m.r < 0.9) { m.r = 4 + Math.random() * 3; m.a = Math.random() * TAU; } } }, draw() {
    const t = this.t, grow = Math.min(1, t / 0.45), end = t > this.dur - 0.4 ? Math.max(0, (this.dur - t) / 0.4) : 1, s = grow * end; if (s <= 0) return;
    const R = 1.05 * s;
    C.globalCompositeOperation = 'lighter';
    const halo = C.createRadialGradient(x, cy, R * 0.8, x, cy, R * 4.2); halo.addColorStop(0, 'rgba(190,110,255,.55)'); halo.addColorStop(0.4, 'rgba(120,60,220,.2)'); halo.addColorStop(1, 'rgba(60,20,140,0)'); circle(x, cy, R * 4.2, halo);
    for (const sgn of [1, -1]) { C.beginPath(); C.moveTo(x - R * 0.35, cy); C.lineTo(x - R * 0.9, cy + sgn * R * 6.5); C.lineTo(x + R * 0.9, cy + sgn * R * 6.5); C.lineTo(x + R * 0.35, cy); C.closePath(); const jg = C.createLinearGradient(x, cy, x, cy + sgn * R * 6.5); jg.addColorStop(0, 'rgba(210,168,255,.55)'); jg.addColorStop(1, 'rgba(210,168,255,0)'); C.fillStyle = jg; C.fill(); }
    const disc = (back) => { C.save(); C.translate(x, cy); C.rotate(0.22); C.beginPath(); C.ellipse(0, 0, R * 3.4, R * 0.75, 0, back ? Math.PI : 0, back ? TAU : Math.PI); C.ellipse(0, 0, R * 1.3, R * 0.3, 0, back ? TAU : Math.PI, back ? Math.PI : 0, true); C.closePath(); const dg = C.createLinearGradient(-R * 3.4, 0, R * 3.4, 0); dg.addColorStop(0, 'rgba(120,40,200,.7)'); dg.addColorStop(0.35, 'rgba(255,150,240,.95)'); dg.addColorStop(0.5, 'rgba(255,240,255,1)'); dg.addColorStop(0.65, 'rgba(255,150,240,.95)'); dg.addColorStop(1, 'rgba(120,40,200,.7)'); C.fillStyle = dg; C.fill(); C.restore(); };
    disc(true);
    C.globalCompositeOperation = 'source-over'; circle(x, cy, R, '#000000');
    C.globalCompositeOperation = 'lighter'; circle(x, cy, R * 1.12, null, `rgba(255,200,255,${0.8 + 0.2 * Math.sin(t * 9)})`, 0.08 * s);
    disc(false);
    for (const m of motes) { const mx = x + Math.cos(m.a) * m.r * s, my = cy + Math.sin(m.a) * m.r * 0.35 * s; circle(mx, my, 0.05, 'rgba(230,200,255,.8)'); }
    C.globalCompositeOperation = 'source-over';
  } });
}

/* =====================================================================
   ICONS (drawn once at boot into little images for the cards, the shop and the inventory)
   ===================================================================== */
const ICONS = {};
function iconCanvas(size, worldH, cx, cy, fn) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size; const g = cv.getContext('2d');
  const prev = C; C = g; const s = size / worldH; g.setTransform(s, 0, 0, -s, size / 2 - cx * s, size / 2 + cy * s);
  try { fn(); } catch (e) { console.warn('icon', e); } finally { C = prev; }
  return cv;
}
const iconURL = (size, worldH, cx, cy, fn) => iconCanvas(size, worldH, cx, cy, fn).toDataURL();
function poseIcon(pose, extra) {
  const rig = new Rig2D('white', 'boy'); rig.setPose(pose); rig.grounded = !['block', 'spikeHit', 'air', 'jumpUp'].includes(pose); if (pose === 'dive') rig.pitch = rig.pitchTarget = 1.15; rig.snap();
  return iconURL(128, 2.6, 0.1, 1.15, () => { rig.draw(0, 0, 1); if (extra) extra(rig); });
}
function drawModelPortrait(model, variant = 'white', emote = null) {
  const rig = new Rig2D(variant, model); if (emote) { rig.emote = emote; rig.emoteT = 0.35; } rig.snap(); if (emote === 'worm') { rig.pitch = 1.25; rig.skeleton(); }
  return rig;
}
function renderIcons() {
  for (const p of ['bump', 'set', 'block', 'dive', 'dash', 'toss']) ICONS[p] = poseIcon(p, p === 'toss' ? r => { const h = r.handPos('L'); drawBallSkin(h.x, h.y + 0.5, 'default', 0.3, 0, 0.26); } : p === 'set' ? r => drawBallSkin(0.35, 2.35, 'default', 0.3, 0, 0.24) : null);
  ICONS.spikeHit = poseIcon('spikeHit', () => { drawBallSkin(0.75, 2.0, 'default', 0.3, 0, 0.24); line(0.35, 2.3, 0.62, 2.1, '#ffd23f', 0.05); });
  ICONS.ball = iconURL(128, 1.2, 0, 0, () => drawBallSkin(0, 0, 'default', 0.4, 0, 0.42));
  for (const id in SKINS) ICONS['skin_' + id] = iconURL(128, 1.3, 0, 0, () => drawBallSkin(0, 0, id, 0.35, 0.3, 0.42));
  for (const id in MODELS) { const rig = drawModelPortrait(id); ICONS['model_' + id] = iconURL(128, 2.25, 0.05, 1.08, () => rig.draw(0, 0, 1)); }
  for (const id in EMOTES) { const rig = drawModelPortrait('boy', 'white', id); ICONS['emote_' + id] = iconURL(128, 2.4, 0.05, 1.0, () => rig.draw(0, 0, 1)); }
  ICONS.fx_none = iconURL(128, 2, 0, 0, () => { circle(0, 0, 0.6, null, '#9aa0a6', 0.12); line(-0.42, -0.42, 0.42, 0.42, '#9aa0a6', 0.12); });
  ICONS.fx_confetti = iconURL(128, 2, 0, 0, () => { const cols = ['#ff4d5e', '#ffd23f', '#35a7ff', '#3ecf7a', '#b06bff', '#ff8a1f']; for (let i = 0; i < 26; i++) { const a = hash(i) * TAU, r = 0.2 + hash(i + 50) * 0.7; C.save(); C.translate(Math.cos(a) * r, Math.sin(a) * r); C.rotate(hash(i + 9) * 6); rect(-0.08, -0.035, 0.16, 0.07, cols[i % 6]); C.restore(); } });
  ICONS.fx_heart = iconURL(128, 2, 0, 0, () => { heartPath(0, 0.05, 0.62); C.fillStyle = '#ff3d8a'; C.fill(); C.strokeStyle = '#fff'; C.lineWidth = 0.06; C.stroke(); });
  ICONS.fx_smite = iconURL(128, 2, 0, 0, () => { poly([0.15, 0.9, -0.35, 0.05, 0.02, 0.05, -0.2, -0.9, 0.4, 0.15, 0.04, 0.15], '#ffe45a', '#fff', 0.05); });
  ICONS.fx_timestop = iconURL(128, 2, 0, 0, () => { circle(0, 0, 0.75, 'rgba(90,160,255,.45)', '#bfe0ff', 0.1); for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; line(Math.cos(a) * 0.58, Math.sin(a) * 0.58, Math.cos(a) * 0.68, Math.sin(a) * 0.68, '#fff', 0.05); } line(0, 0, 0, 0.5, '#fff', 0.07); line(0, 0, -0.32, 0.1, '#fff', 0.1); });
  ICONS.fx_hammock = iconURL(128, 2.4, 0, 0.1, () => { C.save(); C.translate(0, -0.9); C.scale(0.4, 0.4); drawPalm(-2.4, 0, 3.6, 0, -0.05); drawPalm(2.4, 0, 3.4, 0, 0.05); C.restore(); C.beginPath(); C.moveTo(-0.95, 0.0); C.quadraticCurveTo(0, -0.7, 0.95, 0.0); C.strokeStyle = '#ff8a5a'; C.lineWidth = 0.14; C.stroke(); });
  ICONS.fx_blackhole = iconURL(128, 2.2, 0, 0, () => { circle(0, 0, 0.9, 'rgba(150,80,255,.35)'); ellipse(0, 0, 0.95, 0.22, 0.22, '#ff9af0'); circle(0, 0, 0.36, '#000', '#ffc8ff', 0.05); });
  for (const t of [1, 2, 3, 4]) { ICONS['box_' + t] = iconURL(128, 1.5, 0, 0.35, () => drawChest(0, 0, 1.15, t, false)); ICONS['boxopen_' + t] = iconURL(128, 1.5, 0, 0.35, () => drawChest(0, 0, 1.15, t, true)); }
}
/* the little portraits in the menu: your character, and the dealer of the shop tab you are on */
function drawPortraitTo(cv, variant, model) {
  if (!cv) return; const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
  const rig = new Rig2D(variant, model); rig.snap();
  const prev = C; C = g; const s = cv.width / 1.25; g.setTransform(s, 0, 0, -s, cv.width / 2 - 0.08 * s, cv.height / 2 + 1.55 * s);
  try { rig.draw(0, 0, 1); } finally { C = prev; }
}
function drawAvatar() { drawPortraitTo($('#mAvatar'), 'white', me.model || 'boy'); }
