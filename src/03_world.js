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
   2D RIG: one athlete, drawn in a clean anime sports style - slim proportions, short-sleeved jersey,
   shorts, knee pads, white socks and court shoes, spiky hair.
   Joint angles are side-view degrees: 0 = limb hanging straight down, positive = swung toward the way the
   character faces. Arms hang from the torso and legs from the pelvis, so leaning the body forward swings
   the limbs back with it. The near arm (R) is the hitting arm.
   ===================================================================== */
const PS = 1.5;                                    // player scale: the athletes are 1.5x the old size (hitboxes included)
const RIG = { hipY: 0.95, torso: 0.56, upArm: 0.31, foreArm: 0.29, thigh: 0.47, shin: 0.47, headR: 0.14 };
const JOINTS = ['spine', 'neck', 'shL', 'elL', 'shR', 'elR', 'hipL', 'knL', 'hipR', 'knR'];
const P2 = (spine, neck, shL, elL, shR, elR, hipL, knL, hipR, knR) => ({ spine, neck, shL, elL, shR, elR, hipL, knL, hipR, knR });
const POSES = {
  idle:        P2(0, 0, 4, 10, -2, 12, 0, 0, 0, 0),
  ready:       P2(38, -32, 70, 44, 64, 50, 56, -80, 42, -64),       // receiving stance: low, weight forward, hands out in front
  jumpUp:      P2(-6, -12, 150, 40, 150, 40, 10, -4, 10, -4),
  air:         P2(-12, -6, 120, 22, 168, 72, -34, -98, -34, -98),
  airDown:     P2(6, 4, 22, 28, 28, 28, -12, -32, -12, -32),
  land:        P2(18, -10, 50, 30, 50, 30, 38, -70, 38, -70),
  bump:        P2(32, -26, 74, 0, 72, 0, 66, -96, 58, -88),          // platform: deep squat, both arms locked out forward and down
  set:         P2(-4, -22, 150, 52, 150, 52, 10, -16, 8, -14),        // hands up above the forehead, elbows out
  block:       P2(-3, -8, 178, 4, 178, 4, 6, -12, 6, -12),
  spikeCharge: P2(-18, -14, 146, 12, 178, 55, -42, -104, -42, -104),
  spikeHit:    P2(26, 12, 40, 34, 80, 16, 46, -22, 46, -22),
  tip:         P2(-3, -12, 65, 25, 160, 12, 18, -36, 18, -36),
  dive:        P2(0, -46, 166, 0, 162, 0, 12, -24, 4, -30),           // body flat, arms reaching out ahead, legs trailing
  diveB:       P2(-10, -20, 100, 10, 100, 10, 35, -55, 35, -55),
  hold:        P2(0, 0, 75, 12, 0, 8, 0, 0, 0, 0),
  sit:         P2(-6, 4, 28, 58, 28, 58, 76, -76, 76, -76),
  lie:         P2(0, 6, 150, 20, 150, 20, 4, -10, 4, -10),
  toss:        P2(-4, -16, 160, 0, 15, 6, 0, 0, 0, 0),
};
const POSE_SNAP = { jumpUp: 22, land: 20, spikeCharge: 26, spikeHit: 32, bump: 20 };
const JERSEY2 = { black: { shirt: '#26272e', trim: '#e9e9ee', shorts: '#1d1e24', num: '#ffffff' }, white: { shirt: '#e3e5ea', trim: '#2b2d35', shorts: '#cfd2d9', num: '#2b2d35' } };
const HAIRS = [['#f1d27a', '#2a5fe0'], ['#e8843a', '#b85a1c'], ['#3a2a22', '#241812'], ['#dfe3ea', '#9aa3b2'], ['#1c1c24', '#35354a'], ['#c9924a', '#8a5a2a'], ['#f1d27a', '#d9a93a']];
function lookFor(variant, model, hairIdx = 0) {
  const j = JERSEY2[variant] || JERSEY2.white; const h = HAIRS[hairIdx % HAIRS.length];
  return { skin: '#f1c9a5', hair: h[0], hairTip: h[1], shirt: j.shirt, trim: j.trim, shorts: j.shorts, num: j.num, pad: '#303138', sock: '#f7f7f7', shoe: '#f4f4f4', shoeStripe: variant === 'black' ? '#e5484d' : '#3a6fd8', eye: '#1c1f30', size: [PS, PS] };
}
function spring1(o, k, tg, w, dt) { const e = Math.exp(-w * dt); const x = o.c[k] - tg; const tmp = (o.v[k] + w * x) * dt; o.c[k] = tg + (x + tmp) * e; o.v[k] = (o.v[k] - w * tmp) * e; }
const INK = '#221f29';
class Rig2D {
  constructor(variant = 'white', model = 'boy', hairIdx = 0) {
    this.variant = variant; this.model = model; this.look = lookFor(variant, model, hairIdx);
    this.c = {}; this.v = {}; this.tg = {}; for (const k of JOINTS) { this.c[k] = 0; this.v[k] = 0; this.tg[k] = 0; }
    this.anim = 'idle'; this.animUntil = 0; this.base = 'idle'; this.moveSpeed = 0; this.runPhase = Math.random() * 6; this.runBlend = 0; this.ready = false;
    this.squash = 0; this.squashV = 0; this.pitch = 0; this.pitchTarget = 0; this.bob = 0; this.emote = null; this.emoteT = 0;
    this.x = 0; this.y = 0; this.f = 1; this.grounded = true; this.drop = 0; this.seed = Math.random() * 100; this.blinkAt = 2 + Math.random() * 3;
    this.sk = null; this.setPose('idle'); this.snap();
  }
  setPose(name, until = 0) { this.anim = POSES[name] ? name : 'idle'; this.animUntil = until; }
  impact(v) { this.squashV += v * 9; }
  snap() { this.computeTargets(0, 0); for (const k of JOINTS) { this.c[k] = this.tg[k]; this.v[k] = 0; } this.skeleton(); }
  place(x, y, f, grounded) { this.x = x; this.y = y; if (f) this.f = f; this.grounded = grounded; }
  computeTargets(dt, t) {
    const idleLike = this.anim === 'idle';
    const p = (idleLike && this.ready && this.grounded ? POSES.ready : POSES[this.anim]) || POSES.idle; const tg = this.tg;
    for (const k of JOINTS) tg[k] = p[k] * D;
    const run = idleLike && this.moveSpeed > 0.4 && !this.emote && this.grounded;
    this.runBlend += ((run ? 1 : 0) - this.runBlend) * smoothT(10, dt || 1);
    if (run) this.runPhase += dt * (5 + this.moveSpeed * 1.35);
    const rb = this.runBlend, ph = this.runPhase;
    if (rb > 0.01) {                                                   // the run cycle blends over whatever stance is underneath
      const s = Math.sin(ph), s2 = Math.sin(ph + Math.PI); const ease = (a, b) => a + (b - a) * rb;
      tg.hipL = ease(tg.hipL, (s * 44 + 8) * D); tg.hipR = ease(tg.hipR, (s2 * 44 + 8) * D);
      tg.knL = ease(tg.knL, (-Math.max(0, Math.cos(ph)) * 84 - 12) * D); tg.knR = ease(tg.knR, (-Math.max(0, Math.cos(ph + Math.PI)) * 84 - 12) * D);
      tg.shL = ease(tg.shL, (s2 * 40 + 10) * D); tg.shR = ease(tg.shR, (s * 40 + 10) * D); tg.elL = ease(tg.elL, 80 * D); tg.elR = ease(tg.elR, 80 * D); tg.spine = ease(tg.spine, 14 * D); tg.neck = ease(tg.neck, -8 * D);
    }
    this.bob = rb * Math.abs(Math.sin(ph)) * 0.06;
    if (idleLike && rb < 0.5 && !this.emote) { const b = Math.sin(t * 2.2 + this.seed); tg.spine += b * 1.5 * D; tg.shL += b * 3 * D; tg.shR -= b * 3 * D; }
    if (this.emote) {
      const e = this.emoteT;
      for (const k of JOINTS) tg[k] = POSES.idle[k] * D;
      if (this.emote === 'wave') { tg.shR = 165 * D; tg.elR = (20 + Math.sin(e * 10) * 30) * D; tg.neck = -8 * D; }
      else if (this.emote === 'clap') { const o = 0.5 + 0.5 * Math.sin(e * 9); tg.shL = 75 * D; tg.shR = 75 * D; tg.elL = (40 + o * 55) * D; tg.elR = (40 + o * 55) * D; tg.neck = 4 * D; }
      else if (this.emote === 'worm') { const w = Math.sin(e * 6), w2 = Math.sin(e * 6 - 1.2); tg.shL = (200 + w * 40) * D; tg.shR = (200 - w * 40) * D; tg.elL = tg.elR = (15 + Math.abs(w) * 35) * D; tg.spine = w * 30 * D; tg.hipL = tg.hipR = (w2 * 30) * D; tg.knL = tg.knR = (-20 - Math.abs(w2) * 50) * D; }
    }
  }
  update(dt, t) {
    if (this.animUntil && t > this.animUntil) { this.anim = this.base; this.animUntil = 0; }
    if (this.emote) this.emoteT += dt;
    this.computeTargets(dt, t);
    const w = POSE_SNAP[this.anim] || 17;
    for (const k of JOINTS) spring1(this, k, this.tg[k], w, dt);
    this.squashV += (-this.squash * 230 - this.squashV * 15) * dt; this.squash = clamp(this.squash + this.squashV * dt, -0.3, 0.3);
    let pt = this.pitchTarget; if (this.emote === 'worm') pt = 1.3 + Math.sin(this.emoteT * 6 + 0.6) * 0.15;
    this.pitch += (pt - this.pitch) * smoothT(12, dt);
    this.blinkAt -= dt; if (this.blinkAt < -0.12) this.blinkAt = 2 + Math.random() * 4;
    this.skeleton();
  }
  skeleton() {
    const c = this.c, P = this.pitch; const sin = Math.sin, cos = Math.cos;
    const hy = RIG.hipY + this.bob - (1 - cos(P)) * 0.62 - (this.emote === 'worm' ? 0.1 : 0);
    const H = [0, hy];
    const s = c.spine + P;                                                         // torso lean (forward positive), body pitch included
    const S = [H[0] + sin(s) * RIG.torso, H[1] + cos(s) * RIG.torso];
    const hd = s + c.neck; const N = [S[0] + sin(s) * 0.07, S[1] + cos(s) * 0.07]; const Cc = [N[0] + sin(hd) * (RIG.headR + 0.02), N[1] + cos(hd) * (RIG.headR + 0.02)];
    const sh = [S[0] - sin(s) * 0.03, S[1] - cos(s) * 0.03];
    const arm = (a0, e0) => { const a = a0 - s, e = a + e0; const E = [sh[0] + sin(a) * RIG.upArm, sh[1] - cos(a) * RIG.upArm]; const W = [E[0] + sin(e) * RIG.foreArm, E[1] - cos(e) * RIG.foreArm]; return { E, W, a, e }; };
    const leg = (h0, k0) => { const a = h0 - P, k = a + k0; const K = [H[0] + sin(a) * RIG.thigh, H[1] - cos(a) * RIG.thigh]; const F = [K[0] + sin(k) * RIG.shin, K[1] - cos(k) * RIG.shin]; return { K, F, a, k }; };
    const aL = arm(c.shL, c.elL), aR = arm(c.shR, c.elR), lL = leg(c.hipL, c.knL), lR = leg(c.hipR, c.knR);
    let drop = 0; if (this.grounded) drop = -(Math.min(lL.F[1], lR.F[1]) - 0.045);  // feet on the floor whatever the knees do
    this.sk = { H, S, N, C: Cc, sh, s, hd, aL, aR, lL, lR }; this.drop = this.grounded ? drop : 0;
  }
  scaleXY() { const q = this.squash, sz = this.look.size; return [sz[0] * (1 - q * 0.5), sz[1] * (1 + q)]; }
  handPos(side = 'L') { const sk = this.sk; if (!sk) return { x: this.x, y: this.y + 1 }; const W = (side === 'L' ? sk.aL : sk.aR).W; const [sx, sy] = this.scaleXY(); return { x: this.x + this.f * W[0] * sx, y: this.y + (W[1] + this.drop) * sy }; }
  headTop() { const sk = this.sk; const [, sy] = this.scaleXY(); return this.y + ((sk ? sk.C[1] : 1.75) + RIG.headR + 0.12 + this.drop) * sy; }
  draw(x = this.x, y = this.y, f = this.f, opts = {}) {
    const sk = this.sk; if (!sk) return; const L = this.look; const [sx, sy] = this.scaleXY();
    C.save(); C.translate(x, y + this.drop * sy); C.scale(f * sx, sy);
    if (opts.alpha !== undefined) C.globalAlpha = opts.alpha;
    C.lineCap = 'butt'; C.lineJoin = 'miter'; C.miterLimit = 3;
    this.limbArm(sk.aL, L, true); this.limbLeg(sk.lL, L, true);
    this.torso(L);
    this.limbLeg(sk.lR, L, false);
    this.head(L);
    this.limbArm(sk.aR, L, false);
    C.restore();
  }
  bone(A, B, w, col, t0 = 0, t1 = 1) {             // a limb segment (or part of one) with a thin ink outline, square-ended
    const ax = A[0] + (B[0] - A[0]) * t0, ay = A[1] + (B[1] - A[1]) * t0, bx = A[0] + (B[0] - A[0]) * t1, by = A[1] + (B[1] - A[1]) * t1;
    C.beginPath(); C.moveTo(ax, ay); C.lineTo(bx, by); C.strokeStyle = INK; C.lineWidth = w + 0.03; C.stroke();
    C.beginPath(); C.moveTo(ax, ay); C.lineTo(bx, by); C.strokeStyle = col; C.lineWidth = w; C.stroke();
  }
  chain(P0, P1, P2, w, col) {                      // two segments as one polyline: a sharp elbow / knee instead of a round cap
    for (const [lw, c] of [[w + 0.03, INK], [w, col]]) { C.beginPath(); C.moveTo(P0[0], P0[1]); C.lineTo(P1[0], P1[1]); C.lineTo(P2[0], P2[1]); C.strokeStyle = c; C.lineWidth = lw; C.stroke(); }
  }
  limbArm(A, L, isFar) {
    const k = isFar ? far2 : same; const sh = this.sk.sh;
    const dx = A.W[0] - A.E[0], dy = A.W[1] - A.E[1], dl = Math.hypot(dx, dy) || 1; const Hd = [A.W[0] + dx / dl * 0.08, A.W[1] + dy / dl * 0.08];
    this.chain(sh, A.E, A.W, 0.078, k(L.skin));
    this.bone(A.W, Hd, 0.07, k(L.skin), -0.1, 1);                                              // hand: a short blunt block
    this.bone(sh, A.E, 0.118, k(L.shirt), 0, 0.5);                                             // short sleeve
  }
  limbLeg(G, L, isFar) {
    const k = isFar ? far2 : same; const H = this.sk.H;
    this.chain(H, G.K, G.F, 0.105, k(L.skin));
    this.bone(H, G.K, 0.158, k(L.shorts), 0, 0.46);                                            // shorts leg
    this.bone(G.K, G.F, 0.112, k(L.sock), 0.58, 0.97);                                         // sock
    this.bone(G.K, G.F, 0.14, k(L.pad), -0.06, 0.2);                                           // knee pad
    const fx = Math.cos(G.k), fy = Math.sin(G.k);
    C.save(); C.translate(G.F[0] + fx * 0.075, G.F[1] + fy * 0.075 - 0.02); C.rotate(G.k);
    poly([-0.12, -0.05, 0.13, -0.05, 0.15, -0.01, 0.1, 0.045, -0.12, 0.045], k(L.shoe), INK, 0.018);
    line(-0.12, -0.04, 0.14, -0.04, k('#3a3b44'), 0.022, 'butt'); line(-0.05, 0.005, 0.05, 0.005, k(L.shoeStripe), 0.024, 'butt');
    C.restore();
  }
  torso(L) {
    const sk = this.sk; C.save(); C.translate(sk.H[0], sk.H[1]); C.rotate(-sk.s);
    const T = RIG.torso;
    poly([-0.15, -0.05, 0.14, -0.05, 0.16, 0.11, -0.16, 0.11], L.shorts, INK, 0.02);                            // waistband / shorts
    poly([-0.155, 0.04, 0.15, 0.04, 0.17, T * 0.62, 0.13, T - 0.02, 0.05, T + 0.03, -0.1, T + 0.02, -0.17, T - 0.06, -0.165, T * 0.5], L.shirt, INK, 0.022);   // jersey
    line(-0.03, 0.08, -0.05, T - 0.04, L.trim, 0.025, 'butt');                                                   // side seam stripe
    C.save(); C.translate(0.05, T * 0.48); C.scale(0.01, -0.01); C.font = '900 20px Montserrat, Arial'; C.textAlign = 'center'; C.textBaseline = 'middle'; C.fillStyle = L.num; C.fillText('1', 0, 0); C.restore();
    line(0.02, T + 0.02, 0.12, T - 0.01, L.trim, 0.025);                                                        // collar
    C.restore();
  }
  head(L) {
    const sk = this.sk; C.save();
    this.bone(sk.S, sk.N, 0.075, L.skin);                                                                        // neck
    C.translate(sk.C[0], sk.C[1]); C.rotate(-sk.hd);
    // hair behind the head
    poly([-0.02, 0.1, -0.15, 0.1, -0.2, 0.04, -0.16, 0.0, -0.19, -0.07, -0.13, -0.05, -0.12, -0.13, -0.05, -0.08], L.hair, INK, 0.018);
    poly([-0.19, -0.07, -0.13, -0.05, -0.12, -0.13], L.hairTip);
    // face in profile: an angular head, a sharp jaw, and just the eye - no expression
    poly([-0.12, 0.08, -0.13, -0.06, -0.06, -0.13, 0.05, -0.155, 0.1, -0.11, 0.115, -0.05, 0.145, -0.01, 0.12, 0.02, 0.125, 0.12, 0.02, 0.155, -0.08, 0.14], L.skin, INK, 0.02);
    if (this.blinkAt < 0) line(0.05, 0.025, 0.1, 0.022, L.eye, 0.016, 'butt');
    else { poly([0.052, 0.045, 0.1, 0.05, 0.098, -0.002, 0.058, 0.004], L.eye); rect(0.08, 0.028, 0.011, 0.012, '#ffffff'); }
    // spiky fringe and crown
    poly([-0.14, 0.02, -0.15, 0.12, -0.21, 0.13, -0.12, 0.17, -0.14, 0.24, -0.05, 0.19, -0.02, 0.26, 0.04, 0.18, 0.11, 0.21, 0.1, 0.14, 0.17, 0.11, 0.1, 0.09, 0.13, 0.03, 0.06, 0.07, 0.02, 0.03, -0.02, 0.08, -0.07, 0.03], L.hair, INK, 0.018);
    poly([-0.21, 0.13, -0.12, 0.17, -0.15, 0.12], L.hairTip); poly([-0.14, 0.24, -0.05, 0.19, -0.09, 0.18], L.hairTip);
    C.restore();
  }
}
const same = c => c, far2 = c => shade(c, -0.18);

/* =====================================================================
   COURTS, BALL, COSMETICS DATA
   ===================================================================== */
const NET_H = 5.2, NET_MESH = 2.7, COURT_L = 30, INDOOR_SCALE = 1.1;   // a tall net over a long court
const COURTS_BY_MAP = {
  indoor: { l: COURT_L * INDOOR_SCALE, half: COURT_L * INDOOR_SCALE / 2, wall: COURT_L * INDOOR_SCALE / 2 + 13, ceil: 18, walls: true },   // wall = how far you can chase before a ball is out
  beach:  { l: COURT_L, half: COURT_L / 2, wall: COURT_L / 2 + 13, ceil: 80, walls: false },
};
const courtDims = () => COURTS_BY_MAP[(S.match && S.match.map) || 'indoor'];
const TEAM_NAME = { A: 'BLACK', B: 'WHITE' };
const BALL_R = 0.42, BALL_G = 12.5;
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
const MODELS = { boy: { name: 'Original', price: 0, rarity: 'common' } };   // one character now: the original athlete
const EMOTES = { wave: { name: 'Wave', price: 500, rarity: 'common' }, clap: { name: 'Clap', price: 500, rarity: 'common' }, worm: { name: 'Worm', price: 7500, rarity: 'epic' } };
const RARITY_ORDER = { common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4 };
const FXS = { none: { name: 'None', price: 0, rarity: 'common' }, confetti: { name: 'Confetti', price: 3000, rarity: 'rare' }, heart: { name: 'Heart', price: 5000, rarity: 'rare' }, smite: { name: 'Smite', price: 10000, rarity: 'legendary' }, timestop: { name: 'Time Stop', price: 12500, rarity: 'legendary' }, hammock: { name: 'Hammock', price: 10000, rarity: 'epic' }, blackhole: { name: 'Black Hole', price: 20000, rarity: 'mythic' } };
const CHEST_TIERS = { 5: { body: '#2a1f4a', band: '#b25cff', glow: '#e6c8ff' }, 1: { body: '#8b5a2b', band: '#cd7f32', glow: '#ffd9a0' }, 2: { body: '#55636f', band: '#d0d6dd', glow: '#d8f0ff' }, 3: { body: '#7a4a10', band: '#f5c542', glow: '#fff0a0' }, 4: { body: '#7a1218', band: '#ff4a55', glow: '#ffb0b8' } };
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
  constructor(x, style) { this.x = x; this.style = style; this.n = 22; this.u = new Float32Array(this.n); this.v = new Float32Array(this.n); this.shake = 0; }
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
    for (let i = 0; i < this.n; i++) { const y = this.yOf(i); if (y < py || y > py + h) continue; const edge = px - this.x + side * -0.22 * PS; if (side < 0 && edge > this.u[i]) this.u[i] += (edge - this.u[i]) * 0.3; if (side > 0 && edge < this.u[i]) this.u[i] += (edge - this.u[i]) * 0.3; }
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
    if (!beach) rr(x - 0.18, 0, 0.36, NET_H - NET_MESH - 0.05, 0.04, '#2f5fd0', '#1f3f90', 0.03);        // post padding
    else circle(x, top + 0.2, 0.08, '#e9d2a8');
    for (let i = 0; i < 16; i++) rect(x - 0.03, top + i * 0.1, 0.06, 0.1, i % 2 ? '#ffffff' : '#e5484d');
    // the mesh: a strip whose rows follow the displaced points
    const W = 0.32; const px = i => x + this.u[i];
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
function drawChest(x, y, s, tier, open) {
  const c = CHEST_TIERS[tier] || CHEST_TIERS[1];
  rr(x - 0.5 * s, y, 1.0 * s, 0.5 * s, 0.06 * s, c.body, shade(c.body, -0.35), 0.04 * s);
  for (const bx of [-0.3, 0.3]) rect(x + (bx - 0.06) * s, y, 0.12 * s, 0.5 * s, c.band);
  if (open) {
    const gl = C.createRadialGradient(x, y + 0.5 * s, 0, x, y + 0.6 * s, 0.9 * s); gl.addColorStop(0, alpha(c.glow, 0.9)); gl.addColorStop(1, alpha(c.glow, 0)); C.fillStyle = gl; C.fillRect(x - s, y + 0.3 * s, 2 * s, 1.2 * s);
    C.save(); C.translate(x - 0.5 * s, y + 0.5 * s); C.rotate(1.25); rr(0, 0, 1.02 * s, 0.22 * s, 0.05 * s, c.body, shade(c.body, -0.35), 0.04 * s); C.restore();
  } else { rr(x - 0.52 * s, y + 0.48 * s, 1.04 * s, 0.24 * s, 0.07 * s, shade(c.body, 0.08), shade(c.body, -0.35), 0.04 * s); for (const bx of [-0.3, 0.3]) rect(x + (bx - 0.06) * s, y + 0.48 * s, 0.12 * s, 0.24 * s, c.band); rr(x - 0.08 * s, y + 0.4 * s, 0.16 * s, 0.16 * s, 0.03 * s, c.band); }
}
/* =====================================================================
   MATCH MAPS
   ===================================================================== */
/* main menu: the court behind the menu, your athlete big on the right, juggling a ball */
const SHOW = { rig: null, ball: { y: 3.3, vy: 0 }, next: 0 };
function drawMenuScene(t, dt) {
  if (!SHOW.rig || SHOW.rig.model !== (me.model || 'boy')) { SHOW.rig = new Rig2D('black', me.model || 'boy'); SHOW.rig.ready = false; SHOW.rig.snap(); }
  const r = SHOW.rig, b = SHOW.ball;
  CAM.s = VH / 6.4; CAM.x = -VW * 0.28 / CAM.s; CAM.y = 2.35;
  if (VW < 900) CAM.x = 0;
  b.vy -= 9 * dt; b.y += b.vy * dt;
  if (b.y < 3.1 && b.vy < 0) { b.y = 3.1; b.vy = 9; r.setPose('set', t + 0.35); ringFx(0.35, 3.15, '#ffffff', 0.15, 0.9, 0.35, 0.04); }
  r.place(0, 0, -1, true); r.update(dt, t);
  drawSkyScreen(false); drawHorizonSea(2.6); worldTf(); drawSandBand(viewX0() - 1, viewX1() + 1, 0);
  drawPalm(-5.5, 0, 5.2, t, 0.15); drawPalm(4.8, 0, 6, t, -0.12); drawUmbrella(-3.2, 0, '#e5484d');
  ellipse(0, 0.02, 0.9, 0.14, 0, 'rgba(0,0,0,.18)');
  r.draw(); drawBallSkin(-0.4, b.y + 0.2, me.skin || 'default', t * 2, t, BALL_R);
}
function drawBeachCourt(t, cd) {
  drawSkyScreen(false); drawHorizonSea(2.6); worldTf();
  drawSandBand(viewX0() - 1, viewX1() + 1, 0);
  const hw = cd.half;
  drawPalm(-hw - 7, 0, 6.4, t, 0.14); drawPalm(hw + 6.5, 0, 5.8, t, -0.12); drawPalm(-hw - 11, 0, 5.2, t, -0.1); drawPalm(hw + 11, 0, 6.8, t, 0.1);
  drawUmbrella(-hw - 4, 0, '#e5484d'); drawUmbrella(hw + 3.5, 0, '#3ecf5a');
  for (let i = 0; i < 6; i++) { const sx = (i < 3 ? -1 : 1) * (hw + 2 + (i % 3) * 1.6); drawSpectator(sx, 0, i, t, sx < 0 ? 1 : -1); }
  courtLines(cd, '#2f6fd8', null, null);
}
function drawSpectator(x, y, i, t, f) {
  if (!onScreen(x - 1, x + 1)) return;
  const cols = ['#e5484d', '#3b8ff0', '#f5c542', '#3ecf5a', '#b06bff', '#ff8a1f'];
  const hop = (S.match && S.match.state === 'point') ? Math.max(0, Math.sin(t * 9 + i)) * 0.25 : Math.max(0, Math.sin(t * 2 + i * 1.7)) * 0.03;
  rr(x - 0.28, y + hop, 0.56, 0.95, 0.24, cols[i % 6]); circle(x, y + hop + 1.2, 0.26, ['#f3d1b0', '#d9a878', '#8a5a3a'][i % 3]); circle(x + f * 0.1, y + hop + 1.23, 0.035, '#27314d');
}
function courtLines(cd, col, floorCol, outCol) {       // the court painted on the floor: bold boundary blocks you can read at a glance
  const h = cd.half;
  if (floorCol) { rect(-h, -0.3, h * 2, 0.3, floorCol); rect(-h - 3, -0.3, 3, 0.3, outCol); rect(h, -0.3, 3, 0.3, outCol); }
  rect(-h - 0.12, -0.34, h * 2 + 0.24, 0.1, col);                       // the side line running the length of the court
  for (const e of [-h, h]) { rect(e - 0.14, -0.9, 0.28, 0.95, col); rect(e - 0.14, -0.02, 0.28, 0.07, col); }   // end lines
  rect(-0.1, -0.9, 0.2, 0.95, col);                                        // centre line under the net
  if (cd.walls) for (const a of [-cd.half * 0.3, cd.half * 0.3]) { rect(a - 0.08, -0.7, 0.16, 0.75, alpha(col, 0.8)); }   // attack lines
}
function drawGym(t, cd) {                           // a clean gym: pale walls, a high window band, light panels, a sprung wood floor
  worldTf(); const x0 = viewX0() - 1, x1 = viewX1() + 1; const W = cd.wall, top = cd.ceil;
  const g = C.createLinearGradient(0, 0, 0, top); g.addColorStop(0, '#dfe4ea'); g.addColorStop(1, '#f1f3f6'); C.fillStyle = g; C.fillRect(x0, 0, x1 - x0, top + 8);
  rect(x0, 0, x1 - x0, 2.4, '#cfd6df'); rect(x0, 2.4, x1 - x0, 0.14, '#2f5fd0');                                   // wainscot + a blue stripe
  const win = isNight ? '#27335e' : '#bfe3f7';
  for (let x = Math.floor(x0 / 5) * 5; x < x1; x += 5) { rect(x + 0.6, top - 5.2, 3.8, 2.6, win); rect(x + 2.45, top - 5.2, 0.1, 2.6, '#c4ccd6'); }   // high windows
  rect(x0, top, x1 - x0, 10, '#b8c1cd'); for (let x = Math.floor(x0 / 4) * 4; x < x1; x += 4) { rect(x, top, 0.2, 10, '#a6b0bd'); if (!ULTRA) rect(x + 1.1, top - 0.3, 1.8, 0.3, isNight ? '#fffbe6' : '#f4f1e2'); }
  rect(x0, -9, x1 - x0, 9, '#d8a86c'); for (let x = Math.floor(x0); x < x1; x += 1.2) line(x, -9, x, 0, 'rgba(120,70,20,.13)', 0.03);
  courtLines(cd, '#ffffff', '#e8864a', '#3b7bd0');
  for (const s of [-1, 1]) { const E = W + 14; rect(s < 0 ? x0 : E, 0, s < 0 ? -E - x0 : x1 - E, top, '#c9d1dc'); rect(s * E - (s < 0 ? 0.5 : 0), 0, 0.5, 2.4, '#2f5fd0'); }
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
const PURPLE = [178, 92, 255];
const ringCol = (purple, a) => purple ? `rgba(${PURPLE[0]},${PURPLE[1]},${PURPLE[2]},${a})` : `rgba(255,255,255,${a})`;
function jumpFx(x, y, col, purple = false) {          // take-off: dust plus a bright ring rolling out along the floor (purple at Jump 100)
  puff(x, y, 7, 1.3, 0.9, col); if (ULTRA) return;
  FX_LIST.push({ t: 0, dur: 0.42, draw() { const k = this.t / this.dur, e = 1 - (1 - k) * (1 - k); ellipse(x, y + 0.03, 0.35 + e * 2.6, 0.09 + e * 0.5, 0, null, ringCol(purple, (1 - k) * 0.95), 0.11 * (1 - k) + 0.03); ellipse(x, y + 0.03, 0.2 + e * 1.6, 0.06 + e * 0.3, 0, null, ringCol(purple, (1 - k) * 0.55), 0.06); } });
}
function spikeRing(x, y, vx, vy, purple = false) {    // spike contact: a shock ring round the ball and a flat ring across its path (purple at Spike 100)
  if (ULTRA) return; const a = Math.atan2(vy, vx); const rc = k => ringCol(purple, k);
  FX_LIST.push({ t: 0, dur: 0.38, draw() {
    const k = this.t / this.dur, e = 1 - (1 - k) * (1 - k);
    C.globalCompositeOperation = 'lighter'; circle(x, y, 0.45 + e * 0.6, rc(0.5 * (1 - k))); C.globalCompositeOperation = 'source-over';
    circle(x, y, 0.4 + e * 3.2, null, rc(1 - k), 0.15 * (1 - k) + 0.03);
    ellipse(x, y, 0.25 + e * 0.7, 0.45 + e * 2.5, a, null, rc(0.9 * (1 - k)), 0.1 * (1 - k) + 0.02);
    for (let i = 0; i < 8; i++) { const b = i / 8 * TAU; const r0 = 0.6 + e * 2, r1 = r0 + 0.7 * (1 - k); line(x + Math.cos(b) * r0, y + Math.sin(b) * r0, x + Math.cos(b) * r1, y + Math.sin(b) * r1, rc(1 - k), 0.06); }
  } });
}
function landFx(x, y, col) { puff(x, y, 9, 1.8, 0.6, col); }
function sparkle(x, y, n, col, spread = 1.4, up = 0.6, dur = 0.35, size = 0.035, dx = 0, dy = 0) {
  for (let i = 0; i < n; i++) { const a = Math.random() * TAU, sp = spread * (2 + Math.random() * 4); addPart({ kind: 'spark', x, y, vx: Math.cos(a) * sp + dx * 5, vy: Math.sin(a) * sp + up * 3 + dy * 5, g: 6, drag: 2, life: dur * (0.6 + Math.random() * 0.6), size, col }); }
}
function ringFx(x, y, col, r0, r1, dur, w = 0.06) { if (ULTRA) return; FX_LIST.push({ t: 0, dur, draw() { const k = this.t / this.dur; circle(x, y, r0 + (r1 - r0) * k, null, alpha(col, 1 - k), w * (1 - k * 0.5)); } }); }
function actionFx(kind, x, y, f, purple = false) {   // a quick visual swoosh at the hands for each touch (purple at the stat's milestone)
  if (ULTRA) return; y = y + 0; const S2 = PS;
  if (kind === 'set') ringFx(x + f * 0.25 * S2, y + 2.05 * S2, purple ? '#b25cff' : '#ffffff', 0.15, 0.8, 0.3, 0.06);
  else if (kind === 'bump') FX_LIST.push({ t: 0, dur: 0.25, draw() { const k = this.t / this.dur; C.beginPath(); C.arc(x + f * 0.3 * S2, y + 0.7 * S2, 0.8 + k * 0.4, f > 0 ? -0.6 : Math.PI - 0.9, f > 0 ? 0.9 : Math.PI + 0.6); C.strokeStyle = purple ? `rgba(178,92,255,${0.8 * (1 - k)})` : alpha('#ffffff', 0.8 * (1 - k)); C.lineWidth = 0.09; C.stroke(); } });
  else if (kind === 'block') FX_LIST.push({ t: 0, dur: 0.3, draw() { const k = this.t / this.dur; for (let i = -2; i <= 2; i++) { const a = Math.PI / 2 + i * 0.3; line(x + Math.cos(a) * (0.5 + k * 0.6), y + 2.3 * S2 + Math.sin(a) * (0.5 + k * 0.6), x + Math.cos(a) * (0.9 + k * 0.9), y + 2.3 * S2 + Math.sin(a) * (0.9 + k * 0.9), purple ? `rgba(178,92,255,${1 - k})` : alpha('#ffffff', 1 - k), 0.07); } } });
  else if (kind === 'spike') FX_LIST.push({ t: 0, dur: 0.22, draw() { const k = this.t / this.dur; C.beginPath(); C.arc(x - f * 0.05, y + 1.9 * S2, 1.2, f > 0 ? 0.2 : Math.PI - 1.5, f > 0 ? 1.5 : Math.PI - 0.2); C.strokeStyle = alpha('#fff6c0', 0.9 * (1 - k)); C.lineWidth = 0.1 * (1 - k) + 0.02; C.stroke(); } });
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
  const rig = new Rig2D('white', 'boy'); rig.setPose(pose); rig.grounded = !['block', 'spikeHit', 'air', 'jumpUp'].includes(pose); if (pose === 'dive') rig.pitch = rig.pitchTarget = 1.25; rig.snap();
  return iconURL(128, 2.6 * PS, 0.1 * PS, 1.15 * PS, () => { rig.draw(0, 0, 1); if (extra) extra(rig); });
}
function drawModelPortrait(model, variant = 'white', emote = null) {
  const rig = new Rig2D(variant, model); if (emote) { rig.emote = emote; rig.emoteT = 0.35; } rig.snap(); if (emote === 'worm') { rig.pitch = 1.25; rig.skeleton(); }
  return rig;
}
function renderIcons() {
  for (const p of ['bump', 'set', 'block', 'dive', 'toss']) ICONS[p] = poseIcon(p, p === 'toss' ? r => { const h = r.handPos('L'); drawBallSkin(h.x, h.y + 0.6, 'default', 0.3, 0, 0.36); } : p === 'set' ? r => drawBallSkin(0.5, 3.5, 'default', 0.3, 0, 0.36) : null);
  ICONS.spikeHit = poseIcon('spikeHit', () => { drawBallSkin(1.1, 3.0, 'default', 0.3, 0, 0.36); });
  ICONS.ball = iconURL(128, 1.2, 0, 0, () => drawBallSkin(0, 0, 'default', 0.4, 0, 0.42));
  for (const id in SKINS) ICONS['skin_' + id] = iconURL(128, 1.3, 0, 0, () => drawBallSkin(0, 0, id, 0.35, 0.3, 0.42));
  for (const id in MODELS) { const rig = drawModelPortrait(id); ICONS['model_' + id] = iconURL(128, 2.25 * PS, 0.05 * PS, 1.08 * PS, () => rig.draw(0, 0, 1)); }
  for (const id in EMOTES) { const rig = drawModelPortrait('boy', 'white', id); ICONS['emote_' + id] = iconURL(128, 2.4 * PS, 0.05 * PS, 1.0 * PS, () => rig.draw(0, 0, 1)); }
  ICONS.fx_none = iconURL(128, 2, 0, 0, () => { circle(0, 0, 0.6, null, '#9aa0a6', 0.12); line(-0.42, -0.42, 0.42, 0.42, '#9aa0a6', 0.12); });
  ICONS.fx_confetti = iconURL(128, 2, 0, 0, () => { const cols = ['#ff4d5e', '#ffd23f', '#35a7ff', '#3ecf7a', '#b06bff', '#ff8a1f']; for (let i = 0; i < 26; i++) { const a = hash(i) * TAU, r = 0.2 + hash(i + 50) * 0.7; C.save(); C.translate(Math.cos(a) * r, Math.sin(a) * r); C.rotate(hash(i + 9) * 6); rect(-0.08, -0.035, 0.16, 0.07, cols[i % 6]); C.restore(); } });
  ICONS.fx_heart = iconURL(128, 2, 0, 0, () => { heartPath(0, 0.05, 0.62); C.fillStyle = '#ff3d8a'; C.fill(); C.strokeStyle = '#fff'; C.lineWidth = 0.06; C.stroke(); });
  ICONS.fx_smite = iconURL(128, 2, 0, 0, () => { poly([0.15, 0.9, -0.35, 0.05, 0.02, 0.05, -0.2, -0.9, 0.4, 0.15, 0.04, 0.15], '#ffe45a', '#fff', 0.05); });
  ICONS.fx_timestop = iconURL(128, 2, 0, 0, () => { circle(0, 0, 0.75, 'rgba(90,160,255,.45)', '#bfe0ff', 0.1); for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; line(Math.cos(a) * 0.58, Math.sin(a) * 0.58, Math.cos(a) * 0.68, Math.sin(a) * 0.68, '#fff', 0.05); } line(0, 0, 0, 0.5, '#fff', 0.07); line(0, 0, -0.32, 0.1, '#fff', 0.1); });
  ICONS.fx_hammock = iconURL(128, 2.4, 0, 0.1, () => { C.save(); C.translate(0, -0.9); C.scale(0.4, 0.4); drawPalm(-2.4, 0, 3.6, 0, -0.05); drawPalm(2.4, 0, 3.4, 0, 0.05); C.restore(); C.beginPath(); C.moveTo(-0.95, 0.0); C.quadraticCurveTo(0, -0.7, 0.95, 0.0); C.strokeStyle = '#ff8a5a'; C.lineWidth = 0.14; C.stroke(); });
  ICONS.fx_blackhole = iconURL(128, 2.2, 0, 0, () => { circle(0, 0, 0.9, 'rgba(150,80,255,.35)'); ellipse(0, 0, 0.95, 0.22, 0.22, '#ff9af0'); circle(0, 0, 0.36, '#000', '#ffc8ff', 0.05); });
  ICONS.bt_box = iconURL(128, 1.5, 0, 0.35, () => drawChest(0, 0, 1.15, 5, false)); ICONS.bt_boxopen = iconURL(128, 1.5, 0, 0.35, () => drawChest(0, 0, 1.15, 5, true));
  for (const t of [1, 2, 3, 4]) { ICONS['box_' + t] = iconURL(128, 1.5, 0, 0.35, () => drawChest(0, 0, 1.15, t, false)); ICONS['boxopen_' + t] = iconURL(128, 1.5, 0, 0.35, () => drawChest(0, 0, 1.15, t, true)); }
}
/* the little portraits in the menu: your character, and the dealer of the shop tab you are on */
function drawPortraitTo(cv, variant, model) {
  if (!cv) return; const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
  const rig = new Rig2D(variant, model); rig.snap();
  const prev = C; C = g; const s = cv.width / (0.75 * PS); g.setTransform(s, 0, 0, -s, cv.width / 2 - 0.02 * PS * s, cv.height / 2 + 1.66 * PS * s);
  try { rig.draw(0, 0, 1); } finally { C = prev; }
}
function drawAvatar() { drawPortraitTo($('#mAvatar'), 'white', me.model || 'boy'); }
