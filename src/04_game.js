/* =====================================================================
   GAMEPLAY: input, player, balls, networking, menu, match, bots, loop
   ===================================================================== */
const G = 20;                                      // player gravity (the athletes are 1.5x bigger and jump over a net twice as high)
const MOVE_SPEED = 6.5, GROUND_CD = 0.7, DIVE_CD = 0.3;
const JUMP_H50 = 4.4;                              // jump height at Jump 50, in metres
const REACH_G = 1.9 * PS, REACH_A = 1.8 * PS;
const BODY_H = 1.9 * PS, HALF_W = 0.28 * PS, NET_GAP = 0.45 * PS;
const TEAM_VARIANT = { A: 'black', B: 'white', L: 'white' };
const SET_TOP = () => NET_H * 2.5;                 // no set climbs higher than 2.5 nets

/* =====================================================================
   STATS + BREAKTHROUGHS
   Six stats. You buy up to 50 points in each ($100 a point); breakthroughs (up to 3 equipped) add on top.
   50 is how the game plays today (35 for Speed). Reaching 100 in a stat unlocks its purple effect for good.
   ===================================================================== */
const STAT_KEYS = ['spike', 'speed', 'dive', 'set', 'block', 'jump'];
const STAT_INFO = {
  spike: ['Spike', 'Harder spikes, hit from higher. 50 = the spike as it is now.', 'a purple spike ring'],
  speed: ['Speed', 'Run faster. 35 = today\'s speed.', 'purple footsteps'],
  dive: ['Dive', 'Dive further. 50 = today\'s dive, 100 crosses the whole court.', 'a purple dive trail'],
  set: ['Set', 'Passing power and control: sets and bumps can go higher and faster (no limit at 100), land closer to the cursor and cost your team less stamina.', 'a purple trail on your sets and bumps'],
  block: ['Block', 'Floatier one-touch blocks and faster kill blocks. 50 = today\'s block.', 'purple block flashes'],
  jump: ['Jump', 'Jump higher. 50 = today\'s jump, 100 = twice as high.', 'a purple jump ring'],
};
const PU = { spike: 1, speed: 2, dive: 4, set: 8, block: 16, jump: 32 };
const STAT_BUY_MAX = 50, STAT_COST = 100, BOT_LVL = 40;
const BT_RARITY = ['D', 'C', 'B', 'A', 'S', 'X'], BT_ODDS = [0.30, 0.25, 0.20, 0.15, 0.05, 0.05], BT_COST = 500;
const BT_COLOR = { D: '#9aa0a6', C: '#3ecf7a', B: '#35a7ff', A: '#b06bff', S: '#ffd23f', X: '#ff4d5e' };
const BT_RANGE = { D: [5, 7], C: [8, 10], B: [20, 24], A: [25, 30], S: [50, 50] };
const BT_ABILITIES = { supercharge: { name: 'Super Charge Spike', desc: 'Keep holding past a full bar: it climbs to 150%, and the spike hits with up to 1.5x true power.' } };
function btEquipped() { const lo = me.btLoad || {}, own = me.bts || {}; const out = []; for (let i = 0; i < 3; i++) { const k = lo[i]; if (k && own[k]) out.push(own[k]); } return out; }
const statBase = k => clamp(Math.floor(+((me.stats || {})[k]) || 0), 0, STAT_BUY_MAX);
const statBonus = k => btEquipped().reduce((a, b) => a + (b.stat === k ? (b.v || 0) : 0), 0);
const stat = k => statBase(k) + statBonus(k);
const hasAbility = id => btEquipped().some(b => b.r === 'X' && b.ab === id);
function purpleMask() { let m = 0; for (const k of STAT_KEYS) if (stat(k) >= 100) m |= PU[k]; return m; }
const myPurple = k => (purpleMask() & PU[k]) !== 0;
/* the curves */
const jumpMult = L => L <= 50 ? 0.8 + 0.2 * L / 50 : 1 + (L - 50) / 50;             // jump height: 0.8x at 0, today at 50, 2x at 100
const jumpV = L => Math.sqrt(2 * G * JUMP_H50 * jumpMult(L));
const spikeMult = L => L <= 50 ? 0.82 + 0.18 * L / 50 : 1 + 0.4 * (L - 50) / 50;     // spike speed
const spikeReach = L => clamp(L - 50, -50, 100) / 50 * 0.3 * PS;                     // where you meet the ball, up or down
const speedMult = L => 0.8 + L / 175;                                                // 35 = today's run
const diveDist = L => L <= 50 ? 7.5 * (0.7 + 0.3 * L / 50) : 7.5 + (22 - 7.5) * Math.min(1, (L - 50) / 50);
function passCost(v, L) { const f = clamp((v - 8) / 18, 0, 1); const easy = 0.10 * Math.max(0, 1 - L / 50); const hard = Math.max(0.05, 0.60 - 0.35 * Math.min(L, 100) / 100); return lerp(easy, hard, f); }   // 10% (slow ball) to 60% (hard spike), less the better you pass
function scatterFor(st, L) { const base = st >= 0.75 ? 0 : st >= 0.25 ? 1.2 : 3.6; return base * Math.max(0.08, 1 - 0.92 * Math.min(L, 100) / 100); }   // tired passes drift off target
const randn = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.75;

/* ---------------- Team stamina (shared by everyone on a side, shown for both teams) ---------------- */
const inRealMatch = () => !!(S.match && !S.match.practice);
function teamStamina(team) { const M = S.match; if (!M || M.practice) return 1; const st = M.stamina || {}; return st[team] === undefined ? 1 : st[team]; }
function spendStamina(team, amt) {
  const M = S.match; if (!M || M.practice || !(amt > 0)) return teamStamina(team);
  M.stamina = Object.assign({ A: 1, B: 1 }, M.stamina); const nv = Math.max(0, M.stamina[team] - amt); M.stamina[team] = nv;
  const r = mref('stamina/' + team); if (r) r.transaction(c => Math.max(0, (c === null || c === undefined ? 1 : c) - amt));
  return nv;
}
const staminaSpeed = st => st <= 0.001 ? 0.7 : st < 0.25 ? 0.85 : st < 0.75 ? 1 : 1.05;

/* ---------------- Player ---------------- */
const P = {
  x: -4, y: 0, vx: 0, vy: 0, f: 1, onGround: true,
  airUsed: false, cd: 0, moveDir: 1, moving: false, charging: false, chargeStart: 0, charge: 0,
  holding: false, serveMode: false, serveAim: null, act: null, dive: null, emote: null, blockUntil: 0, blockHit: false, blockLean: 0, team: 'A', rig: null, jumpF: 1
};
let T = 0;
const faceNet = () => S.match && !S.match.practice;
const teamSide = team => team === 'A' ? -1 : 1;                          // which side of the net a team plays on (x < 0 = A)
const netFrom = x => x < 0 ? 1 : -1;                                     // the direction of the net from a point

/* ---------------- Balls ---------------- */
const balls = new Map();
let B = null;
function makeBall(id, sceneName, skin = 'default') {
  const b = { id, scene: sceneName, active: false, held: null, frozen: false, x: 0, y: 0, vx: 0, vy: 0, g: 1, seq: 0, t: 0, hitter: null, hitType: null, prevHitter: null, prevType: null, touches: 0, sideTeam: 'A', rot: 0, spin: 0, landed: false, serve: false, tossedBy: null, skin, fx: 'none', hitterX: null, hm: 'boy', ds: false, pf: null, acc: 0, visX: 0, visY: 0, netSide: 0, pu: 0 };
  balls.set(id, b); return b;
}
function removeBall(id) { const b = balls.get(id); if (!b) return; balls.delete(id); if (B === b) B = null; }
function acrossNet(ax, bx) { for (const n of netsFor()) if ((ax - n.x) * (bx - n.x) < 0) return true; return false; }
function blockReach() {                          // the block hitbox: a column from your feet to the top of your hands, leaning with you
  const hx = P.x + P.f * (0.3 + P.blockLean * 0.9) * PS, top = P.y + 2.25 * PS + 0.35 * PS, hw = 0.7 * PS; let best = null, bd = 1e9;
  for (const b of balls.values()) {
    if (b.scene !== S.scene || !b.active || b.held || b.frozen || b.hitter === SID) continue;
    if (b.y < P.y - BALL_R || b.y > top + BALL_R) continue;
    const t = clamp((b.y - P.y) / Math.max(0.1, top - P.y), 0, 1); const cx = P.x + (hx - P.x) * t;   // the column tilts from the feet to the hands
    const d = Math.abs(b.x - cx); if (d > hw + BALL_R || d >= bd) continue; bd = d; best = b;
  }
  if (best) B = best; return !!best;
}
function ballReach(cx, cy, r, vScale = 1, allowAcross = false) {
  let best = null, bd = r;
  for (const b of balls.values()) {
    if (b.scene !== S.scene || !b.active || b.held || b.frozen) continue;
    if (S.match && !S.match.practice && b.hitter === SID && b.hitType !== 'block' && b.hitType !== 'toss') continue;   // one touch each (a block does not count as your touch)
    if (b.serve && b.tossedBy && b.tossedBy !== SID) continue;
    if (b.nt && b.nt === P.team && S.match && !S.match.practice) continue;
    if (S.match && b.hitter && b.hitter !== SID && T - (b.hitAtT || -9) < 1 / 6 && teamOf(b.hitter) === P.team) continue;   // a teammate just played it: no instant double-touch by accident              // your team's serve: hands off until it is over the net
    const d = Math.hypot(b.x - cx, (b.y - cy) / vScale); if (d > bd) continue;
    if (!allowAcross && acrossNet(P.x, b.x)) continue;
    bd = d; best = b;
  }
  if (best) B = best; return !!best;
}

/* ---------------- Input ---------------- */
const keys = new Set();
const MOUSE = { x: innerWidth * 0.6, y: innerHeight * 0.3 };       // the cursor: sets and bumps go to it, you face it, blocks lean toward it
const worldMouse = () => ({ x: (MOUSE.x - VW / 2 - shakeX) / CAM.s + CAM.x, y: (VH / 2 + shakeY - MOUSE.y) / CAM.s + CAM.y });
const isTyping = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement || {}).tagName);
const inMatch = () => S.scene === 'match' && !!S.match;
document.addEventListener('mousemove', e => { MOUSE.x = e.clientX; MOUSE.y = e.clientY; });
document.addEventListener('keydown', e => {
  if (rebinding) { e.preventDefault(); setBind(e.code); return; }
  if (isTyping()) return;
  if (e.code === 'Escape') { if (wheelOpen) return; if (!$('#openFx').classList.contains('hidden') || !$('#confirmBox').classList.contains('hidden')) closePanels(); else if (inMatch() && menuOpen()) closeMenu(); return; }
  if (e.code === KEYS.menu) { e.preventDefault(); if (!inMatch() || !$('#openFx').classList.contains('hidden')) return; menuOpen() ? closeMenu() : openMenu(); return; }
  if (e.code === KEYS.chat) { e.preventDefault(); $('#chatInput').focus(); return; }
  if (BOUND.has(e.code) || e.code === 'Tab' || e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  if (e.repeat || !inMatch() || uiOpen()) return;
  if (!keys.has(e.code)) { keys.add(e.code); onPress(e.code); }
});
document.addEventListener('keyup', e => { keys.delete(e.code); onRelease(e.code); });
addEventListener('blur', () => { keys.clear(); });
document.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  const code = 'Mouse' + e.button; MOUSE.x = e.clientX; MOUSE.y = e.clientY;
  if (rebinding) { setBind(code); return; }
  if (uiOpen() || !inMatch()) return;
  canvas.focus();
  if (!keys.has(code)) { keys.add(code); onPress(code); }
});
document.addEventListener('mouseup', e => { const code = 'Mouse' + e.button; if (keys.has(code)) { keys.delete(code); onRelease(code); } });
document.addEventListener('mousedown', e => { if (rebinding && e.target !== canvas && !e.target.classList.contains('key')) { setBind('Mouse' + e.button); e.preventDefault(); } });
function inputAxes() { return { ix: clamp((keys.has(KEYS.moveR) ? 1 : 0) - (keys.has(KEYS.moveL) ? 1 : 0) + TOUCH.x, -1, 1) }; }

/* ---------------- Actions ---------------- */
function onPress(code) {
  if (code === KEYS.emote) { toggleWheel(); return; }
  if (P.emote) stopEmote();
  if (code === KEYS.jump) tryJump();
  if (code === KEYS.serve) trySpawnBall(true);
  else if (code === KEYS.spawnBall) trySpawnBall(false);
  if (P.holding) { if (code === KEYS.toss) doToss(); return; }
  if (P.dive) return;
  if (P.onGround) {
    if (P.cd > 0 || T < (P.landLock || 0)) return;
    if (code === KEYS.bump) doBump();
    else if (code === KEYS.groundSet) doGroundSet();
    else if (code === KEYS.dive) doDive();
  } else {
    if (P.airUsed) return;
    if (code === KEYS.block) doBlock();
    else if (code === KEYS.jumpSet) doJumpSet();
    else if (code === KEYS.spike) startSpike();
  }
}
function onRelease(code) { if (P.charging && code === KEYS.spike) releaseSpike(); }
function tryJump() {
  if (!P.onGround || P.dive || T < (P.landLock || 0)) return;
  P.vy = jumpV(stat('jump')); P.onGround = false; P.airUsed = false;
  jumpFx(P.x, P.y, groundDustColor(), myPurple('jump'));
  P.jumpF = P.f; P.rig.base = P.holding ? 'hold' : 'air';
  P.rig.impact(0.16); camKick(0.04, 1.6);
  P.rig.setPose(P.holding ? 'hold' : 'jumpUp', P.holding ? 0 : T + 0.18);
}
const chestX = () => P.x + P.f * 0.35 * PS, chestY = () => P.y + 1.07 * PS;
const highX = () => P.x + P.f * 0.3 * PS, highY = () => P.y + 1.92 * PS;
function launchTo(fx, fy, tx, ty, apexY, g = BALL_G) {          // velocity that carries a ball from (fx, fy) to (tx, ty) over an apex
  const apex = Math.max(apexY, fy + 0.4, ty + 0.4);
  const vy = Math.sqrt(2 * g * (apex - fy)); const tUp = vy / g; const tDown = Math.sqrt(2 * Math.max(0.01, apex - ty) / g);
  return { x: (tx - fx) / (tUp + tDown), y: vy };
}
const netDir = () => faceNet() ? (P.team === 'A' ? 1 : -1) : P.f;
const ceilY = () => S.match ? courtDims().ceil : 40;

const ACT_WINDOW = 0.3;
const BUMP_G = 0.75;                                // bumps float
/* a pass (bump, dig or first-touch set) costs the team stamina, by how hard the ball was coming; returns the stamina left */
function payForPass(b, kind, team = P.team, L = stat('set')) {
  const v = Math.hypot(b.vx, b.vy); const first = b.sideTeam !== team || b.touches === 0 || b.hitType === 'toss';
  let cost = 0;
  if (kind === 'bump' || kind === 'dive') cost = passCost(v, L);
  else if (kind === 'set' && first) cost = Math.min(1, passCost(v, L) * 2.2 + 0.08);   // receiving with your hands is much harder on the legs
  return cost > 0 ? spendStamina(team, cost) : teamStamina(team);
}
function receiveBreak(team = P.team) {           // 0% stamina: the pass breaks and the ball flies back the way it was going
  const b = B; if (!inRealMatch() || teamStamina(team) > 0.001) return false;
  const first = b.sideTeam !== team || b.touches === 0; if (!first) return false;
  const sp = Math.hypot(b.vx, b.vy); const away = -netFrom(b.x); const k = 0.22 + Math.random() * 0.13; const pitch = (30 + Math.random() * 25) * D;
  hitBall('bump', away * Math.cos(pitch) * sp * k, Math.sin(pitch) * sp * k + 3, 1); b.brk = true; showBallMsg('RECEIVE BREAK', b); camKick(0.05, 5);
  return true;
}
function doBump() { P.rig.setPose('bump', T + 0.5); P.cd = GROUND_CD; P.act = { type: 'bump', until: T + ACT_WINDOW }; setTimeout(() => actionFx('bump', P.x, P.y, P.f, myPurple('set')), 60); tryAct(); }
function doGroundSet() { P.rig.setPose('set', T + 0.45); P.cd = GROUND_CD; P.act = { type: 'set', until: T + ACT_WINDOW }; setTimeout(() => actionFx('set', P.x, P.y, P.f, myPurple('set')), 80); tryAct(); }
function doJumpSet() { P.airUsed = true; P.airActed = true; P.rig.base = 'airDown'; P.rig.setPose('set', T + 0.45); P.act = { type: 'jset', until: T + ACT_WINDOW }; setTimeout(() => actionFx('set', P.x, P.y, P.f, myPurple('set')), 80); tryAct(); }
function tryAct() {
  const a = P.act; if (!a) return;
  if (T > a.until) { P.act = null; return; }
  if (a.type === 'bump') {
    if (!ballReach(chestX(), chestY(), REACH_G, 0.55)) return; P.act = null;
    if (receiveBreak()) return; const st = payForPass(B, 'bump'); bumpToCursor(st);
  } else if (a.type === 'set') {
    if (!ballReach(chestX(), chestY() + 0.55 * PS, REACH_G, 0.5)) return; P.act = null; if (receiveBreak()) return; setToCursor(payForPass(B, 'set'));
  } else if (a.type === 'spike' || a.type === 'tip') {
    if (P.onGround) { P.act = null; return; }
    if (a.type === 'spike' ? doSpike(a.c) : doTip()) P.act = null;
  } else if (a.type === 'jset') {
    if (P.onGround) { P.act = null; return; }
    if (!ballReach(highX(), highY(), REACH_A, 0.5)) return; P.act = null; if (receiveBreak()) return; setToCursor(payForPass(B, 'set'));
  }
}
/* Bumps go to the cursor too: up over it, then down to around it. Fresh legs = right on it, tired = off target. */
/* How high and how fast a pass may go, from the Set stat. 25 plays like the old fixed limits; the limits open
   up toward 100, where there are none (as high as the gym allows, as fast as you point). */
const passOpen = L => L >= 100 ? 1 : clamp((L - 25) / 75, 0, 1) ** 1.5;
const setTopFor = L => L >= 100 ? 1e9 : L <= 25 ? NET_H * lerp(2.0, 2.5, L / 25) : NET_H * (2.5 + 4.5 * passOpen(L));
const setSpeedFor = L => L >= 100 ? 1e9 : L <= 25 ? lerp(9, 12, L / 25) : 12 + 28 * passOpen(L);
const bumpTopFor = L => L >= 100 ? 1e9 : L <= 25 ? NET_H * lerp(1.8, 2.2, L / 25) : NET_H * (2.2 + 4.5 * passOpen(L));
const bumpSpeedFor = L => L >= 100 ? 1e9 : L <= 25 ? lerp(7.5, 10, L / 25) : 10 + 28 * passOpen(L);
function bumpToCursor(st) {
  const m = worldMouse(); const sc = scatterFor(st, stat('set'));
  const tx = m.x + randn() * sc, ty = Math.max(0.8, m.y + randn() * sc * 0.3);
  const L = stat('set'); const apex = Math.min(ceilY() - 0.8, bumpTopFor(L), Math.max(ty, B.y) + 2.8 * PS);
  const v = launchTo(B.x, B.y, tx, Math.min(ty, apex - 0.4), apex, BALL_G * BUMP_G); const vmax = bumpSpeedFor(L);
  hitBall('bump', clamp(v.x, -vmax, vmax), v.y, BUMP_G);                  // past its limit a weak passer's bump just falls short
}
/* Sets go to the cursor: the ball peaks where you point (never above 2.5 nets, never toward the net).
   Point level with yourself for a quicker, flatter set; point high for a slow, floaty one. */
function setAim(bx, by, mx, my, g0 = 1, L = stat('set')) {
  const top = Math.min(setTopFor(L), ceilY() - 0.6);
  const dx = mx - bx;
  const apex = clamp(my, by + 1.6, top);
  const ang = Math.atan2(Math.max(0, my - by), Math.abs(dx) + 0.01) / (Math.PI / 2);
  const g = g0 * lerp(1.1, 0.72, clamp(ang, 0, 1));
  const gg = BALL_G * g; const vy = Math.sqrt(2 * gg * (apex - by)); const tUp = vy / gg;
  const vmax = setSpeedFor(L); let vx = clamp(dx / tUp, -vmax, vmax);          // sideways: faster the better you set
  const nd = netFrom(bx); if (vx * nd > 0) {                                 // toward the net: fine, but it has to come down on your side
    const tAll = tUp + Math.sqrt(2 * Math.max(0.1, apex - BALL_R) / gg); const room = Math.max(0, Math.abs(bx) - 0.9);
    vx = nd * Math.min(Math.abs(vx), room / tAll);
  }
  return { vx, vy, g };
}
function setToCursor(st) {
  const m = worldMouse(); const sc = scatterFor(st, stat('set'));
  const v = setAim(B.x, B.y, m.x + randn() * sc, m.y + randn() * sc * 0.4); hitBall('set', v.vx, v.vy, v.g);
}
function doBlock() { P.airUsed = true; P.airActed = true; P.rig.base = 'block'; P.rig.setPose('block'); P.blockUntil = T + 10; P.blockHit = false; setTimeout(() => actionFx('block', P.x, P.y, P.f, myPurple('block')), 90); }
function blockSolve(b, px, nd, tz, L = 50) {       // lean in (tz >= 0) = kill block, lean back = soft one-touch to our side; the Block stat makes kills faster and one-touches floatier
  const s = Math.hypot(b.vx, b.vy); const kill = 0.8 + 0.4 * Math.min(L, 150) / 100, soft = 0.7 + 0.6 * Math.min(L, 150) / 100;
  if (tz >= 0) {
    if (s >= 12) { const sp = Math.max(9, s * 0.5 * kill), ang = (38 + 22 * tz) * D; return { vx: nd * Math.cos(ang) * sp, vy: -Math.sin(ang) * sp, g: 0.35 }; }
    const v = launchTo(b.x, b.y, px + nd * 5.5, 0, b.y + 3.6); return { vx: v.x, vy: v.y, g: 1 };
  }
  const f = clamp((s - 6) / 22, 0, 1) * -tz; const gs = 1.3 - 0.6 * Math.min(L, 150) / 100;
  const v = launchTo(b.x, b.y, px - nd * (1.5 + 6.5 * f), 0, b.y + lerp(3.6, 1.1, f) * soft * PS, BALL_G * gs); return { vx: v.x, vy: v.y, g: gs };
}
const BLOCK_LEAN = 0.45;
function updateBlockLean() {
  if (P.onGround || P.rig.base !== 'block') { P.blockLean = 0; return; }
  const m = worldMouse(); const ang = Math.atan2(m.x - P.x, m.y - (P.y + 1.9 * PS)) * P.f;
  P.blockLean = clamp(ang, -BLOCK_LEAN, BLOCK_LEAN); P.rig.pitchTarget = P.blockLean * 0.8;
}
/* Blocks by angle. Where the ball meets the hands, and which way the blocker leans:
   the front of the hands while leaning in = kill block; the very top of the hands = a wipe that flies up and back
   (off a hard spike it sails out - a free point unless someone chases it down); leaning back, or the ball on the
   back of the hands = a one-touch; blocking while turned away from the net = a wipe straight out, no saving it. */
function blockTouch(b, bx, by, f, nd, lean, L) {
  const sp = Math.hypot(b.vx, b.vy);
  if (f !== nd) return { vx: -nd * Math.max(24, sp * 0.8 + 10), vy: 14, g: 0.6, kind: 'WIPE' };
  const hx = bx + f * (0.3 + lean * 0.9) * PS, hy = by + 2.25 * PS;
  const fwd = (b.x - hx) * nd, up = b.y - hy;
  if (up > 0.15 * PS && up > Math.abs(fwd) * 0.6) return { vx: -nd * (sp * 0.25 + 1), vy: sp * 0.08 + 3, g: 1, kind: 'WIPE' };   // a hard spike's wipe lands a little past the back line
  if (fwd >= -0.05 && lean > 0.08) { const r = blockSolve(b, bx, nd, clamp(lean / BLOCK_LEAN, 0.3, 1), L); r.kind = sp >= 12 ? 'KILL BLOCK' : ''; return r; }
  const r = blockSolve(b, bx, nd, -1, L); r.kind = ''; return r;
}
const blockNetDir = () => faceNet() ? (P.team === 'A' ? 1 : -1) : netFrom(P.x);
function blockContact() {
  P.blockHit = true; camKick(-0.03, 2.6);
  const r = blockTouch(B, P.x, P.y, P.f, blockNetDir(), P.blockLean, stat('block'));
  hitBall('block', r.vx, r.vy, r.g); if (r.kind) showBallMsg(r.kind, B);
  if (myPurple('block')) ringFx(B.x, B.y, '#b25cff', 0.3, 2.4, 0.35, 0.12); else ringFx(B.x, B.y, '#ffffff', 0.3, 1.8, 0.3, 0.08);
}
const FULL_T = 0.5625;
function chargeAt(dt) {                           // 0.19 s to half, 0.56 s to full; with Super Charge it keeps climbing to 150%
  if (dt <= 0.1875) return dt / 0.1875 * 0.5;
  if (dt <= FULL_T || !hasAbility('supercharge')) return clamp(0.5 + (dt - 0.1875) / 0.375 * 0.5, 0, 1);
  return Math.min(1.5, 1 + (dt - FULL_T) / 0.5 * 0.5);
}
function startSpike() { P.airUsed = true; P.charging = true; P.chargeStart = T; P.charge = 0; P.rig.setPose('air'); }
function releaseSpike() {
  P.charging = false;
  const c = P.charge;
  if (c <= 0.35) { P.rig.base = 'airDown'; P.rig.setPose('tip', T + 0.4); if (!doTip()) P.act = { type: 'tip', until: T + 0.16 }; }   // a tap up to 35% is a tip
  else { P.rig.setPose('spikeCharge', T + 0.07); P.swingAt = T + 0.07; if (!doSpike(c)) P.act = { type: 'spike', c, until: T + 0.16 }; }
}
/* Where you meet the ball inside its hitbox decides the shot: ball out ahead of your hand (net side) = hit down
   steep (old W), ball back behind your hand = drive it deep (old S). The middle is straight. */
function hitboxTilt(b, handX, fwd) { const d = (b.x - handX) * fwd; return clamp(Math.sign(d) * Math.max(0, Math.abs(d) - 0.38) / 1.6, -1, 1); }
function netAhead(x, fwd) { let best = Infinity; for (const n of netsFor()) { const d = (n.x - x) * fwd; if (d > 0.3) best = Math.min(best, d); } return best; }
function ballisticPitch(s, gg, R, h) { const disc = s * s * s * s - gg * (gg * R * R + 2 * h * s * s); if (disc < 0) return null; return Math.atan((s * s - Math.sqrt(disc)) / (gg * R)); }
const courtL = () => S.match ? courtDims().l : COURT_L;
function spikeGeomAt(x, y, fwd) {
  let toNet = netAhead(x, fwd); if (!isFinite(toNet)) toNet = 7;
  const CL = courtL(); const dMid = clamp(toNet + CL / 4, 3, 24);
  const clearPitch = toNet < 1.2 ? -Math.PI / 2 : Math.min(35 * D, Math.atan2((NET_H + 0.35) - y, toNet));
  const neutralPitch = Math.max(Math.atan2(-y, dMid), clearPitch);
  const far = clamp((toNet - 3) / (8 * CL / COURT_L), 0, 1);
  return { neutralPitch, clearPitch, toNet, far };
}
function spikeSolve(x, y, fwd, tz, c, mult = 1) {  // the spike (shared by players and bots): velocity + gravity at charge c and tilt tz - lob means it would have hit the net (TOO LOW)
  const { neutralPitch, clearPitch, toNet, far } = spikeGeomAt(x, y, fwd);
  const ts = tz < 0 ? tz * 0.8 : tz;                                   // the deep shot is a little softer than the steep one - and nothing keeps it in
  const sp = (13 + 22 * Math.min(1, c)) * (ts > 0 ? lerp(1, 0.75, ts) : 1) * mult;
  let pitch = ts >= 0 ? lerp(neutralPitch, -60 * D, ts) : lerp(neutralPitch, neutralPitch * 0.25, -ts);
  if (ts < 0.35) pitch = Math.max(pitch, clearPitch);
  let g = 0.18;
  if (far > 0) {
    const gFar = lerp(0.18, 2.6, far); const gg = BALL_G * gFar;
    const CL2 = courtL(); const R = ts >= 0 ? lerp(toNet + CL2 / 4, toNet + 1.5, ts) : lerp(toNet + CL2 / 4, toNet + CL2 / 2 + 3, -ts / 0.8 * Math.min(1, c));
    let pf = ballisticPitch(sp, gg, R, -y); if (pf === null) pf = 40 * D;
    for (let i = 0; i < 6; i++) { const t = toNet / (sp * Math.cos(pf)); const yy = y + sp * Math.sin(pf) * t - 0.5 * gg * t * t; if (yy >= NET_H + 0.4) break; pf += 4 * D; }
    pitch = lerp(pitch, pf, Math.min(1, far / 0.3)); g = gFar;
  }
  if (isFinite(toNet) && toNet < 40) {
    const tN = toNet / Math.max(0.5, sp * Math.cos(pitch)); const yN = y + sp * Math.sin(pitch) * tN - 0.5 * BALL_G * g * tN * tN;
    if (yN < NET_H + BALL_R) { const v = launchTo(x, y, x + fwd * (toNet + 4.5), 0, Math.max(y + 4.5, NET_H + 3.5)); return { vx: v.x, vy: v.y, g: 1, lob: true }; }
  }
  return { vx: fwd * Math.cos(pitch) * sp, vy: Math.sin(pitch) * sp, g, lob: false };
}
function serveSolve(bx, by, fwd, c, tz, mult) {  // a jump serve: your spike power, full gravity; the toss position picks short / long like a spike
  const ss = (13 + 22 * Math.min(1, c)) * mult; const cc = Math.min(1, c);
  let gs = lerp(1, 2.0, cc), pitch = lerp(20, 5, cc) * D;
  const toNet = netAhead(bx, fwd); const CL = courtL(); const aimed = isFinite(toNet) && toNet < 40;
  let R = aimed ? lerp(toNet + CL / 4 + 1, toNet + CL / 2 - 1.2, cc) : 14 + 10 * cc;
  if (aimed) R = tz >= 0 ? lerp(R, toNet + 3, tz * 0.55) : R + -tz * 0.8 * 4.5;
  for (let k = 0; k < 12; k++) {
    const gg = BALL_G * gs; const p0 = ballisticPitch(ss, gg, R, -by); if (p0 === null) break; pitch = p0;
    if (aimed) for (let i = 0; i < 8; i++) { const t = toNet / (ss * Math.cos(pitch)); const y = by + ss * Math.sin(pitch) * t - 0.5 * gg * t * t; if (y >= NET_H + 0.4) break; pitch += 3 * D; }
    const vy = ss * Math.sin(pitch), tf = (vy + Math.sqrt(vy * vy + 2 * gg * by)) / gg;
    if (!aimed || ss * Math.cos(pitch) * tf <= R + 0.6) break; gs += 0.15;
  }
  return { vx: fwd * Math.cos(pitch) * ss, vy: Math.sin(pitch) * ss, g: gs };
}
function doSpike(c) {
  const L = stat('spike');
  if (!ballReach(highX(), highY() + spikeReach(L), REACH_A, 0.6)) return false;          // spike hitbox: 60% as tall
  camKick(0.05 + Math.min(c, 1.5) * 0.06, 2.6 + Math.min(c, 1.5) * 4.5);
  const fwd = P.f; P.jumpF = fwd; const tz = hitboxTilt(B, highX(), fwd);
  const mult = spikeMult(L) * (c > 1 ? c : 1);                             // Super Charge: past 100% the charge is a true power multiplier
  if (B.serve) { const v = serveSolve(B.x, B.y, fwd, c, tz, mult); hitBall('spike', v.vx, v.vy, v.g, c); B.nt = P.team; writeBall(B); return true; }
  const r = spikeSolve(B.x, B.y, fwd, tz, c, mult);
  hitBall('spike', r.vx, r.vy, r.g, c); if (r.lob) showBallMsg('TOO LOW', B); return true;
}
function doTip() {
  if (!ballReach(highX(), highY() + spikeReach(stat('spike')), REACH_A, 0.6)) return false;
  if (B.serve) return doSpike(0.3);
  const fwd = P.f, tz = hitboxTilt(B, highX(), fwd);
  let sp = 7, pitch = 32 * D;
  if (tz > 0) { sp = lerp(7, 5.0, tz); pitch = lerp(32, 62, tz) * D; } else if (tz < 0) { sp = lerp(7, 8.6, -tz); pitch = lerp(32, 24, -tz) * D; }
  hitBall('tip', fwd * Math.cos(pitch) * sp, Math.sin(pitch) * sp, 1); return true;
}
function doDive() {
  const dir = P.moving ? P.moveDir : P.f;
  P.dive = { t0: T, dur: 0.55, dir, hit: false, v0: diveDist(stat('dive')) / 0.385 };
  const fwd = dir === P.f; P.rig.setPose(fwd ? 'dive' : 'diveB'); P.rig.pitchTarget = fwd ? 1.3 : -0.95; P.diveAnim = P.rig.pitchTarget;
}
function diveContact() {                          // a dig off the floor pops high and floats down
  P.dive.hit = true; if (receiveBreak()) return; const g = 0.7; payForPass(B, 'dive');
  const v = launchTo(B.x, B.y, P.x + P.f * 2.5, 0, Math.min(ceilY() - 0.9, Math.max(11, B.y + 6)), BALL_G * g); hitBall('dive', v.x, v.y, g);
}
function canSpawnHere() { return !!(S.match && S.match.practice); }
function trySpawnBall(serveMode, force = false) {
  if ((!force && !canSpawnHere()) || P.holding) return;
  const b = balls.get('match'); if (!b) return;
  B = b; b.skin = me.skin || 'default';
  b.active = true; b.frozen = false; b.vx = b.vy = 0; b.hitter = null; b.hitType = null; b.prevHitter = null; b.touches = 0; b.sideTeam = P.team; b.serve = false; b.tossedBy = null; b.landed = false; b.seq++; b.t = snow(); b.pf = null; b.netSide = 0;
  P.holding = true; P.serveMode = !!serveMode || !!(S.match && !S.match.practice); P.serveAim = null; b.held = SID; P.rig.base = 'hold'; P.rig.setPose('hold');
  const h = P.rig.handPos('L'); b.x = h.x; b.y = h.y + BALL_R * 0.6;
  writeBall(b);
}
function doToss() {
  const b = B; if (!b) { P.holding = false; return; }
  if (P.serveMode && P.serveAim === null) { P.serveAim = 0; return; }
  P.holding = false; P.rig.setPose('toss', T + 0.45); P.rig.base = P.onGround ? 'idle' : 'air';
  b.held = null; const h = P.rig.handPos('L'); b.x = h.x; b.y = h.y + BALL_R * 0.6; b.tossedBy = SID;
  if (P.serveMode) {                                                    // the aim is relative to the way you face
    const a = P.serveAim || 0; const m = Math.min(1, Math.abs(a));
    const reach = jumpV(stat('jump')) ** 2 / (2 * G) + 1.92 * PS + spikeReach(stat('spike')) + 0.9;   // the toss peaks a little over your highest reach
    b.serve = true; hitBall('toss', m > 0.01 ? P.f * Math.sign(a) * (0.35 + 1.2 * m) : 0, Math.sqrt(2 * BALL_G * 0.7 * Math.max(1, reach - b.y)), 0.7);
  } else { b.serve = false; hitBall('toss', P.f * 0.4, Math.sqrt(2 * BALL_G * Math.max(0.5, P.y + 1.7 * PS + 5 - b.y)), 1); }
  P.serveMode = false; P.serveAim = null;
  const M = S.match; if (M && !M.practice && M.state === 'serve') mwrite('state', 'rally');
}
function computePath(b) {                          // replay the ball's own physics on a copy, so the dotted line is the exact flight
  const c = { id: 'ghost', x: b.x, y: b.y, vx: b.vx, vy: b.vy, g: b.g, netSide: 0, pf: null }; const pts = [[c.x, c.y]]; const h = BALL_STEP; const cd = courtDims();
  for (let i = 0; i < 1200; i++) { const px = c.x, py = c.y; c.vy -= BALL_G * c.g * h; const dr = 1 - 0.015 * h; c.vx *= dr; c.vy *= dr; c.x += c.vx * h; c.y += c.vy * h; ballNets(c, px, py, h); if (c.y > cd.ceil - BALL_R) { c.y = cd.ceil - BALL_R; c.vy *= -0.5; } if (i % 3 === 2) pts.push([c.x, c.y]); if (c.y < BALL_R || Math.abs(c.x) > cd.wall + 2) { pts.push([c.x, Math.max(BALL_R, c.y)]); break; } }
  return pts;
}
function hitBall(type, vx, vy, g, charge = 0) {
  const b = B; if (!b) return;
  b.vx = vx; b.vy = vy; b.g = g; b.seq++; b.t = snow(); b.held = null; b.active = true; b.frozen = false; b.pf = null; b.acc = 0; b.netSide = 0;
  b.nt = null; b.brk = false; b.prevHitter = b.hitter; b.prevType = b.hitType; b.hitter = SID; b.hitType = type; b.fx = me.fx || 'none'; b.hm = me.model || 'boy'; b.hitterX = P.x; b.hitAtT = T; b.pu = purpleMask();
  if (type === 'toss' || type === 'block') { b.touches = 0; b.sideTeam = P.team; }
  else { if (b.sideTeam !== P.team) { b.sideTeam = P.team; b.touches = 1; } else b.touches++; }
  if (type !== 'toss') { b.serve = false; P.serving = false; }
  b.spin = (Math.random() - 0.5) * 8 - vx * 1.5; b.landed = false; b.ds = false;
  if (type === 'spike') { spikeRing(b.x, b.y, vx, vy, (b.pu & PU.spike) !== 0); sparkle(b.x, b.y, 14, '#ffffff', 1.3, 0.2, 0.3, 0.035, vx / 30, vy / 30); }
  b.path = type === 'set' ? computePath(b) : null; b.pathI = 0;
  writeBall(b); hostCheckHit();
}

/* ---------------- Player update ---------------- */
function updatePlayer(dt) {
  const ui = !$('#openFx').classList.contains('hidden');
  const { ix } = ui || isTyping() ? { ix: 0 } : inputAxes();
  if (P.cd > 0) P.cd -= dt;
  const steering = !!(P.holding && P.serveAim !== null);
  tryAct(); updateBlockLean();
  if (P.swingAt && T >= P.swingAt) { P.swingAt = 0; if (!P.onGround) { P.rig.base = 'airDown'; P.rig.setPose('spikeHit', T + 0.4); actionFx('spike', P.x, P.y, P.f); } }
  if (!P.dive && !steering && !(P.rig.base === 'block' && !P.onGround)) P.f = worldMouse().x >= P.x ? 1 : -1;   // you face the cursor (a block keeps the way you went up facing)
  if (P.dive) {
    const e = (T - P.dive.t0) / P.dive.dur;
    if (e >= 1) { P.dive = null; P.cd = DIVE_CD; P.rig.pitchTarget = 0; P.diveAnim = 0; P.rig.setPose('idle'); P.rig.base = 'idle'; }
    else { P.vx = P.dive.dir * P.dive.v0 * (1 - e * 0.6); if (myPurple('dive') && Math.random() < 0.8) addPart({ kind: 'dot', x: P.x, y: P.y + 0.5 * PS, vx: -P.vx * 0.05, vy: 0.3, g: 0, drag: 3, life: 0.45, size: 0.16, col: Math.random() < 0.5 ? '#b25cff' : '#d9a8ff' }); }
  } else if (P.onGround) {
    if (P.emote && ix) stopEmote();
    const mv = steering || P.emote ? 0 : ix;
    if (mv) { P.vx = mv * MOVE_SPEED * speedMult(stat('speed')) * (inRealMatch() ? staminaSpeed(teamStamina(P.team)) : 1); P.moveDir = Math.sign(mv); P.moving = true; }
    else { P.vx = 0; P.moving = false; }
  } else if (ix && !steering) {                                             // in the air you can still steer, a little slower than you run
    const air = ix * MOVE_SPEED * speedMult(stat('speed')) * 0.8; P.vx += (air - P.vx) * smoothT(7, dt);
  }
  if (steering) { const want = clamp(ix * P.f, -1, 1); P.serveAim += (want - P.serveAim) * smoothT(8, dt); }
  for (const f of FX_LIST) {
    if (f.type !== 'blackhole' || f.t > f.dur * 0.8) continue;
    const dx = f.x - P.x, dist = Math.abs(dx); if (dist > f.pull || dist < f.core) continue;
    P.x += Math.sign(dx) * 4.8 * dt;
  }
  if (P.onGround && P.moving && !P.dive) { P.stepAcc = (P.stepAcc || 0) + dt; if (P.stepAcc > 0.16) { P.stepAcc = 0; const pu = myPurple('speed'); puff(P.x - P.moveDir * 0.3, P.y, pu ? 4 : 2, 0.6, 0.6, pu ? '#b25cff' : groundDustColor()); } }
  const sdt = dt * timeStopFactor(P.x, P.y);
  P.vy -= G * sdt;
  const prevX = P.x; P.x += P.vx * sdt; P.y += P.vy * sdt;
  let landed = false; if (P.y <= 0 && P.vy <= 0) { P.y = 0; if (!P.onGround) landed = true; }
  const cd = courtDims(); P.x = clamp(P.x, -cd.wall + 1, cd.wall - 1);
  if (!S.match.practice) { P.x = P.team === 'A' ? Math.min(P.x, -NET_GAP) : Math.max(P.x, NET_GAP); if (P.serving && P.onGround) { const back = cd.half + 0.35; P.x = P.team === 'A' ? Math.min(P.x, -back) : Math.max(P.x, back); } }
  for (const n of netsFor()) {
    const dp = prevX - n.x, dc = P.x - n.x;
    if ((Math.sign(dp) !== Math.sign(dc) && dp !== 0) || Math.abs(dc) < NET_GAP) P.x = n.x + (Math.sign(dp) || Math.sign(dc) || -1) * NET_GAP;
    if (Math.abs(P.x - n.x) < NET_GAP + 0.3) n.touchBody(P.x, P.y, BODY_H, Math.sign(P.x - n.x) < 0 ? -1 : 1);
  }
  if (landed) {
    const impV = P.vy; P.vy = 0;
    const hard = clamp(-impV / 14, 0, 1);
    P.rig.impact(-0.09 - hard * 0.15); camKick(-0.03 - hard * 0.06, 1.2 + hard * 2);
    P.onGround = true; P.airUsed = false; P.blockUntil = 0; P.blockLean = 0; P.rig.pitchTarget = P.dive ? P.rig.pitchTarget : 0;
    if (P.airActed) { P.landLock = T + 0.5; P.airActed = false; }
    P.charging = false; P.swingAt = 0;
    P.rig.base = P.holding ? 'hold' : 'idle'; P.rig.setPose(P.holding ? 'hold' : 'land', P.holding ? 0 : T + 0.16);
    if (P.act && P.act.type !== 'bump' && P.act.type !== 'set') P.act = null;
    landFx(P.x, P.y, groundDustColor());
  }
  if (P.emote && T - P.emote.t0 > 6) stopEmote();
  P.rig.moveSpeed = P.onGround && !P.dive ? Math.abs(P.vx) : 0; P.rig.ready = true;
  P.rig.place(P.x, P.y, P.f, P.onGround && !P.dive);
  if (P.charging) P.charge = chargeAt(T - P.chargeStart);
}
function groundDustColor() { return S.match && S.match.map === 'beach' ? '#f0dfae' : '#d9c7a8'; }

/* ---------------- Ball physics ---------------- */
const netsFor = () => S.scene === 'match' && MATCH_NET ? [MATCH_NET] : [];
function inAnyCourt(x) { return !!S.match && Math.abs(x) <= courtDims().half + BALL_R; }
/* The ball against a net - deterministic, so every client computes the same bounce from the same hit:
   the TAPE is a stiff round cord; the MESH below it is soft and swallows the ball's pace; below the mesh
   the post is solid to the floor (a ball never passes under a net). */
function ballNets(b, px, py, h) {
  for (const n of netsFor()) {
    const dx = b.x - n.x, dxp = px - n.x;
    const tdy = b.y - NET_H, td = Math.hypot(dx, tdy), rr = BALL_R + 0.05;
    if (td < rr && td > 1e-6) {
      const nx = dx / td, ny = tdy / td; b.x = n.x + nx * rr; b.y = NET_H + ny * rr;
      const vn = b.vx * nx + b.vy * ny; if (vn < 0) { b.vx -= 1.35 * vn * nx; b.vy -= 1.35 * vn * ny; b.vx *= 0.82; b.vy *= 0.85; }
      b.g = 1; b.pf = null; b.tapeT = T; continue;
    }
    if (b.y < NET_H && b.y > NET_H - NET_MESH) {
      if (!b.netSide && Math.abs(dx) < BALL_R) b.netSide = Math.sign(dxp) || (b.vx > 0 ? -1 : 1);
      const side = b.netSide;
      if (side) {
        const depth = BALL_R - side * dx;
        if (depth > 0) {
          b.g = 1; b.pf = null;
          b.vx += (side * depth * 1500 - 38 * b.vx) * h; b.vy *= Math.exp(-5 * h);
          if (b.vx * side > 0) b.vx *= Math.exp(-14 * h);
          if (depth > 1.1) { b.x = n.x + side * (BALL_R - 1.1); if (b.vx * side < 0) b.vx = 0; }
        } else b.netSide = 0;
      }
    } else if (b.netSide && b.y >= NET_H) b.netSide = 0;
    if (b.y < NET_H - NET_MESH + BALL_R * 0.2 && Math.abs(dx) < BALL_R + 0.12) {
      const s = Math.sign(dxp) || (b.vx > 0 ? -1 : 1); b.x = n.x + s * (BALL_R + 0.12); if (b.vx * s < 0) b.vx = -b.vx * 0.4; b.g = 1;
    }
    if (b.id === 'match' && S.match && !S.match.practice && Math.sign(dx) !== Math.sign(dxp) && dxp !== 0 && b.y > NET_H - BALL_R) { b.nt = null; const st = b.x < 0 ? 'A' : 'B'; if (st !== b.sideTeam) { b.sideTeam = st; b.touches = 0; } }
  }
}
function timeStopFactor(x, y = 0) { if (y >= 6) return 1; for (const f of FX_LIST) if (f.type === 'timestop' && Math.abs(x - f.x) < f.r) return TIMESTOP_SLOW; return 1; }
const BALL_STEP = 1 / 120;
function stepBall(b, dt) { b.acc = (b.acc || 0) + dt * timeStopFactor(b.x, b.y); let n = 0; while (b.acc >= BALL_STEP && n < 200) { simBall(b, BALL_STEP); b.acc -= BALL_STEP; n++; } }
function ballFloor(b) { return 0; }
function simBall(b, h) {
  const M = S.match; const px = b.x, py = b.y;
  b.vy -= BALL_G * b.g * h; const dr = 1 - 0.015 * h; b.vx *= dr; b.vy *= dr;
  b.x += b.vx * h; b.y += b.vy * h;
  ballNets(b, px, py, h);
  const cd = courtDims();
  if (Math.abs(b.x) > cd.wall && b.id === 'match' && M && !M.practice && M.state === 'rally' && isHost()) hostBallOut();   // gone past where anyone can chase it
  if (b.y > cd.ceil - BALL_R) { b.y = cd.ceil - BALL_R; b.vy *= -0.5; if (b.id === 'match' && M && !M.practice && M.state === 'rally' && isHost()) hostBallOut(); }
  if (Math.abs(b.x) > cd.wall + 30) { b.vx = 0; b.vy = 0; b.y = BALL_R; b.frozen = true; }                // far away and forgotten
  if (b.y < BALL_R) {
    b.y = BALL_R; b.serve = false;
    if (!b.landed) {
      b.landed = true; const inC = inAnyCourt(b.x); landingMark(b.x, 0, inC);
      if (inC && b.fx && b.fx !== 'none' && b.hitter && b.hitterX !== null && b.hitType !== 'toss' && acrossNet(b.hitterX, b.x)) playScoreFx(b.fx, b.x, 0, b.hm || 'boy', P.x);
      if (Math.abs(b.vy) > 4) puff(b.x, 0, 5, 1.2, 0.8, groundDustColor());
    }
    if (M && !M.practice && M.state === 'rally' && isHost()) hostBallLanded();
    if (Math.abs(b.vy) < 1.2) { b.vy = 0; b.vx *= 0.97; } else b.vy *= -0.55;
    b.vx *= 0.85; b.spin = -b.vx / BALL_R * 0.9; b.g = 1; b.pf = null;
  }
  b.rot += b.spin * h;
}
function updateBalls(dt) {
  for (const b of balls.values()) {
    if (b.scene !== S.scene || !b.active) continue;
    if (b.held) {
      const holder = b.held === SID ? P.rig : (remotes.get(b.held) || {}).rig;
      if (holder) { const h = holder.handPos('L'); b.x = h.x; b.y = h.y + BALL_R * 0.6; }
    } else if (!b.frozen) stepBall(b, dt);
    const k = Math.exp(-dt * 14); b.visX *= k; b.visY *= k;             // a network correction is eased out visually instead of popping
    for (const n of netsFor()) if (Math.abs(b.x - n.x) < 1.5) n.touchBall(b.x, b.y, b.vx, BALL_R, b.netSide);
    if (b.tapeT === T) for (const n of netsFor()) if (Math.abs(b.x - n.x) < 1) n.kick(3);
    if (!ULTRA && (b.pu & PU.set) && (b.hitType === 'set' || b.hitType === 'bump') && T - (b.hitAtT || 0) < 1.2 && !b.landed) addPart({ kind: 'dot', x: b.x, y: b.y, vx: 0, vy: 0, g: 0, drag: 0, life: 0.5, size: BALL_R * 0.7, col: Math.random() < 0.5 ? '#b25cff' : '#e0b8ff' });   // Set 100: a purple trail
    if (b.skin === 'fire' && !ULTRA && Math.hypot(b.vx, b.vy) > 3 && Math.random() < 0.6) addPart({ kind: 'dot', x: b.x, y: b.y, vx: -b.vx * 0.1, vy: 0.6, g: -1, drag: 2, life: 0.35, size: 0.1, col: Math.random() < 0.5 ? '#ffb02a' : '#ff5a1f' });
  }
  if (T < P.blockUntil && !P.onGround && blockReach() && B.hitter !== SID && B.vx * blockNetDir() < 0 && Math.abs(B.x) < NET_GAP + 3.2) blockContact();   // blocks reach over the net and lean with you
  if (P.dive && !P.dive.hit && ballReach(P.x + P.dive.dir * 1.0 * PS, P.y + 0.6 * PS, 1.8 * PS)) diveContact();
}
/* ---- "TOO LOW" popup at the ball ---- */
let ballMsg = null;
function showBallMsg(text, b) { ballMsg = { text, b, x: b.x, y: b.y, until: performance.now() + 1500 }; }

/* ---------------- Ball sync ---------------- */
function ballRecord(b) { return { active: b.active, held: b.held || null, frozen: b.frozen, x: b.x, y: b.y, vx: b.vx, vy: b.vy, g: b.g, seq: b.seq, t: b.t, hitter: b.hitter || null, hitType: b.hitType || null, prevHitter: b.prevHitter || null, prevType: b.prevType || null, touches: b.touches, sideTeam: b.sideTeam, serve: !!b.serve, tossedBy: b.tossedBy || null, skin: b.skin || 'default', fx: b.fx || 'none', hm: b.hm || 'boy', hitterX: b.hitterX === null ? null : b.hitterX, ds: !!b.ds, pf: b.pf || null, pu: b.pu || 0, nt: b.nt || null, d2: 1, by: SID }; }
function writeBall(b) {
  if (!b || !S.online) return;
  if (b.id === 'match') { const r = mref('ball'); if (r) r.set(ballRecord(b)); }
}
function receiveBall(b, v) {
  if (!b || !v || v.by === SID || !v.d2) return;
  if (v.seq < b.seq) return;
  b.seq = v.seq; b.active = !!v.active; b.held = v.held || null; b.frozen = !!v.frozen; b.g = v.g || 1; b.t = v.t || snow();
  b.hitter = v.hitter || null; b.hitType = v.hitType || null; b.prevHitter = v.prevHitter || null; b.prevType = v.prevType || null; b.touches = v.touches || 0; b.sideTeam = v.sideTeam || 'A';
  b.serve = !!v.serve; b.tossedBy = v.tossedBy || null; b.landed = false; b.netSide = 0;
  b.skin = v.skin || 'default'; b.fx = v.fx || 'none'; b.hm = v.hm || 'boy'; b.hitterX = v.hitterX === undefined ? null : v.hitterX; b.pf = v.pf || null; b.pu = v.pu || 0; b.nt = v.nt || null; b.hitAtT = T;
  if (P.holding && B === b && b.held !== SID) { P.holding = false; P.serveMode = false; P.serveAim = null; P.rig.base = P.onGround ? 'idle' : 'air'; P.rig.setPose(P.rig.base); }
  const newHit = v.hitType === 'spike' && v.seq !== b.lastSparkSeq; b.lastSparkSeq = v.seq;
  if (b.active && !b.held) {
    const bx = b.x + b.visX, by = b.y + b.visY; const wasShown = b.scene === S.scene;
    b.x = v.x; b.y = v.y; b.vx = v.vx; b.vy = v.vy; b.acc = 0;
    if (newHit) { spikeRing(b.x, b.y, b.vx, b.vy, (b.pu & PU.spike) !== 0); sparkle(b.x, b.y, 14, '#ffffff', 1.3, 0.2, 0.3, 0.035, b.vx / 30, b.vy / 30); }
    const dt = clamp((snow() - b.t) / 1000, 0, 0.6);
    if (!b.frozen && dt > 0) { let left = dt; while (left > 1e-6) { const hh = Math.min(BALL_STEP, left); simBall(b, hh); left -= hh; } }   // catch up with the same fixed-step physics everyone runs
    if (wasShown && !newHit) { const ox = bx - b.x, oy = by - b.y; if (Math.hypot(ox, oy) < 1.5) { b.visX = ox; b.visY = oy; } else { b.visX = b.visY = 0; } } else { b.visX = b.visY = 0; }
    b.spin = (Math.random() - 0.5) * 8 - b.vx * 1.5;
    b.path = v.hitType === 'set' ? computePath(b) : null; b.pathI = 0;
  } else b.path = null;
  if (b.id === 'match') hostCheckHit();
}
/* ---------------- Remote players ---------------- */
const remotes = new Map();
function remoteUpsert(sid, d) {
  if (sid === SID || !d || !d.d2) return;
  let r = remotes.get(sid);
  const variant = TEAM_VARIANT[d.team] || 'white'; const model = 'boy';
  if (r && (r.rig.variant !== variant || r.rig.model !== model)) { remoteRemove(sid); r = null; }
  if (!r) {
    const rig = new Rig2D(variant, model); rig.place(d.x || 0, d.y || 0, d.f || 1, true);
    r = { rig, name: d.name || '', buf: [], data: d, speed: 0, stamp: null, gap: 0.09, jit: 0.02, delay: INTERP_DELAY, lastArrive: 0, px: null, py: 0, x: d.x || 0, y: d.y || 0, pvx: 0 };
    remotes.set(sid, r);
  }
  // de-jitter: packets go onto a steady timeline at the sender's average rate, not their arrival time
  const since = T - r.lastArrive;
  if (r.stamp === null || since > 0.8) { r.stamp = T; r.gap = 0.09; }
  else {
    if (since < 1.0) r.jit = lerp(r.jit, Math.min(0.2, Math.abs(since - r.gap)), 0.1);
    if (since < r.gap * 2.2) r.gap = lerp(r.gap, clamp(since, 0.03, 0.4), 0.07);
    const step = since > r.gap * 2.2 ? since : r.gap;
    r.stamp = clamp(r.stamp + step + (T - r.stamp - step) * 0.05, T - 0.45, T + 0.12);
  }
  r.lastArrive = T;
  r.buf.push({ t: r.stamp, x: d.x || 0, y: d.y || 0 }); if (r.buf.length > 12) r.buf.shift();
  r.data = d; r.name = d.name || '';
  if (r.rig.anim !== d.anim) { r.rig.setPose(d.anim || 'idle'); if (d.anim === 'bump' || d.anim === 'set' || d.anim === 'block' || d.anim === 'spikeHit') setTimeout(() => actionFx(d.anim === 'spikeHit' ? 'spike' : d.anim, r.x, r.y, r.rig.f, ((d.pu || 0) & (d.anim === 'block' ? PU.block : PU.set)) !== 0), 60); }
  const em = d.em || null; if (em !== r.rig.emote) { r.rig.emote = em; r.rig.emoteT = 0; }
  r.rig.pitchTarget = d.pt || 0;
}
function remoteRemove(sid) { remotes.delete(sid); }
function remotesClear() { remotes.clear(); }
const INTERP_DELAY = 0.18;
function hermite(a, b, o, n, s, h, key) {
  const va = (b[key] - o[key]) / Math.max(0.001, b.t - o.t), vb = (n[key] - a[key]) / Math.max(0.001, n.t - a.t);
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * a[key] + (s3 - 2 * s2 + s) * h * va + (-2 * s3 + 3 * s2) * b[key] + (s3 - s2) * h * vb;
}
function updateRemotes(dt) {
  for (const [sid, r] of remotes) {
    if (r.bot) continue;
    const buf = r.buf; if (!buf.length) continue;
    const want = clamp(r.gap * 1.5 + r.jit * 3 + 0.03, 0.12, 0.35); r.delay += (want - r.delay) * Math.min(1, dt * 0.5);
    const rt = T - r.delay; let tx, ty;
    if (buf.length === 1 || rt <= buf[0].t) { tx = buf[0].x; ty = buf[0].y; }
    else {
      let i = buf.length - 1; while (i > 0 && buf[i - 1].t > rt) i--;
      const a = buf[i - 1], b = buf[i];
      if (rt <= b.t) { const h = Math.max(0.001, b.t - a.t), f = (rt - a.t) / h, o = buf[i - 2] || a, n = buf[i + 1] || b; tx = hermite(a, b, o, n, f, h, 'x'); ty = hermite(a, b, o, n, f, h, 'y'); }
      else { const span = Math.max(0.05, b.t - a.t), ex = clamp(rt - b.t, 0, 0.12); tx = b.x + (b.x - a.x) / span * ex; ty = b.y; }   // coast on the last velocity while a packet is late
    }
    const px = r.x;
    if (r.px === null || Math.hypot(tx - r.x, ty - r.y) > 8) { r.x = tx; r.y = ty; }
    else { const a = 18 + Math.min(42, Math.hypot(tx - r.x, ty - r.y) * 14), e = Math.exp(-a * dt), inv = 1 / a; const ease = (cur, t1, t0) => { const v = clamp((t1 - t0) / Math.max(dt, 1e-4), -25, 25); return t1 - v * inv + (cur - t0 + v * inv) * e; }; r.x = ease(r.x, tx, r.px); r.y = ease(r.y, ty, r.py); }
    r.px = tx; r.py = ty;
    const grounded = !!(r.data && r.data.g);
    const pu = (r.data && r.data.pu) || 0;
    if (!r.wasAir && !grounded) { jumpFx(r.x, r.y, groundDustColor(), (pu & PU.jump) !== 0); r.rig.impact(0.14); }
    if ((pu & PU.dive) && r.rig.anim === 'dive' && Math.random() < 0.8) addPart({ kind: 'dot', x: r.x, y: r.y + 0.5 * PS, vx: 0, vy: 0.3, g: 0, drag: 3, life: 0.45, size: 0.16, col: '#b25cff' });
    if ((pu & PU.speed) && grounded && r.speed > 2 && Math.random() < 0.25) puff(r.x, r.y, 2, 0.6, 0.6, '#b25cff');
    if (r.wasAir && grounded) r.rig.impact(-0.17);
    r.wasAir = !grounded;
    r.speed = lerp(r.speed, Math.abs(r.x - px) / Math.max(dt, 0.001), Math.min(1, dt * 7));
    r.rig.moveSpeed = r.rig.anim === 'idle' ? r.speed : 0;
    r.rig.ready = true; r.rig.place(r.x, r.y, (r.data && r.data.f) || 1, grounded);
    r.rig.update(dt, T);
    for (const n of netsFor()) if (Math.abs(r.x - n.x) < NET_GAP + 0.3) n.touchBody(r.x, r.y, BODY_H, r.x < n.x ? -1 : 1);
  }
}
function myState() {
  return { d2: 1, name: me.name, id: me.id, team: S.scene === 'match' ? P.team : 'L', x: +P.x.toFixed(2), y: +P.y.toFixed(2), f: P.f, g: P.onGround && !P.dive ? 1 : 0, anim: P.rig.anim, em: P.emote ? P.emote.id : '', pt: P.diveAnim || 0, md: me.model || 'boy', pu: purpleMask() };
}

/* ---------------- Touch controls ----------------
   Left of the screen: a joystick that appears under your thumb (run left / right, aim up / down, serve aim - the same
   axes the keyboard drives). Round buttons press the same key codes the keyboard would. Buttons can be dragged
   anywhere in Menu > Settings > Controls > Edit layout; the layout is saved per device. */
const TOUCH = { on: false, x: 0, y: 0, edit: false, joyId: null, joyOrigin: null, pressed: new Map(), layout: null, drag: null };
const TOUCH_DEFAULT = { jump: [30, 110], action: [130, 40], q: [40, 212], e: [140, 150], dive: [230, 60], emote: [320, 26], menu: [320, 100], ball: [400, 26], serve: [470, 26] };   // [right, bottom] in px
function touchWanted() { let pref = 'auto'; try { pref = localStorage.getItem('vg_touch') || 'auto'; } catch (e) { } if (pref === 'on') return true; if (pref === 'off') return false; const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0; return touch && (matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile|CrOS.*Touch/i.test(navigator.userAgent)); }
function applyTouch(on) {
  TOUCH.on = on; $('#touchUi').classList.toggle('hidden', !on); document.body.classList.toggle('touch', on);
  if (!on) { TOUCH.x = TOUCH.y = 0; for (const [el, code] of TOUCH.pressed) { keys.delete(code); onRelease(code); } TOUCH.pressed.clear(); }
  layoutTouch();
}
function layoutTouch() {
  if (!TOUCH.layout) { try { TOUCH.layout = JSON.parse(localStorage.getItem('vg_touch_layout2d') || 'null'); } catch (e) { } if (!TOUCH.layout) TOUCH.layout = Object.assign({}, TOUCH_DEFAULT); }
  $$('#touchUi .tbtn').forEach(b => { const p = TOUCH.layout[b.dataset.act] || TOUCH_DEFAULT[b.dataset.act]; const sz = b.classList.contains('big') ? 84 : 64; b.style.right = clamp(p[0], 0, Math.max(0, innerWidth - sz)) + 'px'; b.style.bottom = clamp(p[1], 0, Math.max(0, innerHeight - sz)) + 'px'; });
}
function touchCode(act) {
  switch (act) {
    case 'jump': return KEYS.jump;
    case 'action': return P.holding ? KEYS.toss : P.onGround ? KEYS.groundSet : KEYS.spike;
    case 'q': return P.onGround ? KEYS.bump : KEYS.block;
    case 'e': return KEYS.jumpSet;
    case 'dive': return KEYS.dive; case 'emote': return KEYS.emote; case 'ball': return KEYS.spawnBall; case 'serve': return KEYS.serve;
  } return null;
}
function updateTouchLabels() {
  if (!TOUCH.on) return;
  const ground = P.onGround, hold = P.holding, spawn = canSpawnHere();
  const set = (act, text, show = true, dim = false) => { const b = $(`#touchUi .tbtn[data-act="${act}"]`); if (!b) return; if (!TOUCH.edit) b.style.display = show ? '' : 'none'; if (b.dataset.txt !== text) { b.dataset.txt = text; b.textContent = text; } b.classList.toggle('dim', dim && !TOUCH.edit); };
  set('action', hold ? 'TOSS' : ground ? 'SET' : 'SPIKE'); set('q', ground ? 'BUMP' : 'BLOCK');
  set('e', 'JUMP SET', true, ground); set('dive', 'DIVE', true, !ground);
  set('ball', 'BALL', spawn); set('serve', 'SERVE', spawn); set('jump', 'JUMP', true, !ground); set('emote', 'EMOTE'); set('menu', 'MENU');
}
(function initTouch() {
  const ui = $('#touchUi'); if (!ui) return;
  const joyZone = $('#joyZone'), joy = $('#joy'), knob = $('#joyKnob'); const R = 46;
  const joyMove = t => { const dx = t.clientX - TOUCH.joyOrigin.x, dy = t.clientY - TOUCH.joyOrigin.y; const d = Math.hypot(dx, dy), k = d > R ? R / d : 1; TOUCH.x = dx * k / R; TOUCH.y = -dy * k / R; if (Math.abs(TOUCH.x) < 0.2) TOUCH.x = 0; knob.style.transform = `translate(${dx * k}px,${dy * k}px)`; };
  joyZone.addEventListener('touchstart', e => { e.preventDefault(); if (TOUCH.joyId !== null || wheelOpen) return; const t = e.changedTouches[0]; TOUCH.joyId = t.identifier; TOUCH.joyOrigin = { x: t.clientX, y: t.clientY }; joy.style.left = t.clientX + 'px'; joy.style.top = t.clientY + 'px'; joy.style.display = 'block'; knob.style.transform = ''; }, { passive: false });
  const joyEnd = e => { for (const t of e.changedTouches) if (t.identifier === TOUCH.joyId) { TOUCH.joyId = null; TOUCH.x = TOUCH.y = 0; joy.style.display = 'none'; } };
  joyZone.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === TOUCH.joyId) joyMove(t); }, { passive: false });
  joyZone.addEventListener('touchend', joyEnd); joyZone.addEventListener('touchcancel', joyEnd);
  for (const b of $$('#touchUi .tbtn')) {
    const press = e => {
      e.preventDefault(); e.stopPropagation();
      if (TOUCH.edit) { const t = e.touches ? e.touches[0] : e; const r = b.getBoundingClientRect(); TOUCH.drag = { b, dx: r.right - t.clientX, dy: r.bottom - t.clientY }; return; }
      if (b.dataset.act === 'menu') { menuOpen() ? closeMenu() : openMenu(); return; }
      if (!$('#openFx').classList.contains('hidden')) return;
      const code = touchCode(b.dataset.act); if (!code) return;
      if (menuOpen() && code !== KEYS.jump) return;
      if (b.dataset.act === 'emote' && e.changedTouches) wheelOpenTouch = e.changedTouches[0].identifier;
      TOUCH.pressed.set(b, code); b.classList.add('on'); if (!keys.has(code)) { keys.add(code); onPress(code); }
    };
    const release = e => { e.preventDefault(); e.stopPropagation(); b.classList.remove('on'); const code = TOUCH.pressed.get(b); if (code === undefined) return; TOUCH.pressed.delete(b); if (keys.has(code)) { keys.delete(code); onRelease(code); } };
    b.addEventListener('touchstart', press, { passive: false }); b.addEventListener('touchend', release); b.addEventListener('touchcancel', release);
    b.addEventListener('mousedown', press); b.addEventListener('mouseup', release); b.addEventListener('mouseleave', e => { if (TOUCH.pressed.has(b)) release(e); });
  }
  const dragMove = e => { const d = TOUCH.drag; if (!d) return; const t = e.touches ? e.touches[0] : e; const right = clamp(innerWidth - t.clientX - d.dx, 0, innerWidth - 64), bottom = clamp(innerHeight - t.clientY - d.dy, 0, innerHeight - 64); d.b.style.right = right + 'px'; d.b.style.bottom = bottom + 'px'; TOUCH.layout[d.b.dataset.act] = [Math.round(right), Math.round(bottom)]; e.preventDefault(); };
  document.addEventListener('touchmove', dragMove, { passive: false }); document.addEventListener('touchend', () => { TOUCH.drag = null; }); document.addEventListener('mousemove', dragMove); document.addEventListener('mouseup', () => { TOUCH.drag = null; });
  $('#touchEditDone').onclick = () => { TOUCH.edit = false; ui.classList.remove('edit'); $('#touchEdit').classList.add('hidden'); try { localStorage.setItem('vg_touch_layout2d', JSON.stringify(TOUCH.layout)); } catch (e) { } toast('Touch layout saved', 'ok'); };
  $('#touchEditReset').onclick = () => { TOUCH.layout = Object.assign({}, TOUCH_DEFAULT); layoutTouch(); };
  $('#touchEditBtn').onclick = () => { closePanels(); if (!TOUCH.on) applyTouch(true); TOUCH.edit = true; ui.classList.add('edit'); $('#touchEdit').classList.remove('hidden'); $$('#touchUi .tbtn').forEach(b => { b.style.display = ''; }); };
  $('#touchSel').onchange = () => { try { localStorage.setItem('vg_touch', $('#touchSel').value); } catch (e) { } applyTouch(touchWanted()); };
  try { $('#touchSel').value = localStorage.getItem('vg_touch') || 'auto'; } catch (e) { }
  const aimTouch = e => { if (!TOUCH.on) return; e.preventDefault(); const t = e.changedTouches[0]; MOUSE.x = t.clientX; MOUSE.y = t.clientY; };   // on a touch screen the last tap on the court is the cursor
  canvas.addEventListener('touchstart', aimTouch, { passive: false }); canvas.addEventListener('touchmove', aimTouch, { passive: false });
  addEventListener('resize', () => { if (TOUCH.on) layoutTouch(); });
})();

/* ---------------- Chat bubbles over heads (drawn on the canvas) ---------------- */
const BUBBLES = new Map();                   // sid -> [{ text, until }]
const BUBBLE_MS = 6000, BUBBLE_MAX = 4;
function addBubble(sid, text) { if (!sid || !text) return; let b = BUBBLES.get(sid); if (!b) { b = []; BUBBLES.set(sid, b); } b.push({ text, until: performance.now() + BUBBLE_MS }); while (b.length > BUBBLE_MAX) b.shift(); }
function sidForName(n) { for (const [sid, r] of remotes) if ((r.data && r.data.name) === n) return sid; return n === me.name ? SID : null; }

/* ---------------- Camera ---------------- */
let camKickK = 0, camShake = 0, camScrollX = 0;
function camKick(zoom, shake) { camKickK = clamp(camKickK + zoom, -0.2, 0.2); camShake = Math.min(0.6, camShake + shake * 0.03); }
function updateCamera(dt) {
  camKickK *= Math.exp(-dt * 7); camShake *= Math.exp(-dt * 9);
  if (S.scene === 'match') {
    const cd = courtDims(); const s = Math.min(VW / (2 * (cd.half + 3.5)), VH / 19) * (1 + camKickK * 0.25);
    CAM.s = s; CAM.y = 0.31 * VH / s;   // the floor band keeps the bottom fifth of the screen, under the action cards
    const hw = VW / 2 / s, pad = Math.min(4, hw * 0.25); let want = 0;
    if (P.x > hw - pad) want = P.x - (hw - pad); else if (P.x < -hw + pad) want = P.x + (hw - pad);   // semi-scrolling: the view only moves once you run off it
    want = clamp(want, -(cd.wall - hw + 2), cd.wall - hw + 2);
    camScrollX += (want - camScrollX) * smoothT(6, dt); CAM.x = camScrollX;
  }
  if (camShake > 0.002) { const st = performance.now() * 0.001; shakeX = Math.sin(st * 47) * camShake * 10; shakeY = Math.sin(st * 61 + 1.7) * camShake * 10; } else { shakeX = shakeY = 0; }
}

/* ---------------- Action cards ---------------- */
const CARD_SETS = {
  ground: [['bump', 'BUMP', 'bump'], ['groundSet', 'SET', 'set'], ['dive', 'DIVE', 'dive']],
  air: [['block', 'BLOCK', 'block'], ['jumpSet', 'JUMP SET', 'set'], ['spike', 'SPIKE', 'spikeHit', true]],
  hold: [['toss', 'TOSS', 'toss']],
};
let cardSig = '', utilSig = '';
function cardHtml(act, label, pose, hold, cd = 0) { return `<div class="card${hold ? ' hold' : ''}"><img src="${ICONS[pose] || ''}" alt=""><div class="key">${keyName(KEYS[act])}</div>${cd > 0 ? `<div class="cdov" style="height:${Math.min(100, cd / 4 * 100).toFixed(0)}%"></div><div class="cdt">${cd.toFixed(1)}</div>` : ''}<div class="lbl">${label}</div></div>`; }
function updateCards() {
  const set = P.holding ? 'hold' : P.onGround ? 'ground' : 'air';
  const hide = menuOpen() || !inMatch();
  const sig = hide + set + '|' + CARD_SETS[set].map(c => KEYS[c[0]]).join(',');
  if (sig !== cardSig) { cardSig = sig; $('#actions').innerHTML = hide ? '' : CARD_SETS[set].map(c => cardHtml(...c)).join(''); }
  updateTouchLabels();
  const show = !hide && S.match && S.match.practice;
  const usig = (show ? 1 : 0) + '|' + KEYS.spawnBall + KEYS.serve;
  if (usig !== utilSig) { utilSig = usig; $('#utilCards').classList.toggle('hidden', !show); $('#utilCards').innerHTML = show ? cardHtml('spawnBall', 'SPAWN BALL', 'ball') + cardHtml('serve', 'SERVE', 'ball') : ''; }
}

/* ---------------- Shop (in the menu) ---------------- */
let shopTab = 'skins';
const SHOP_KINDS = {
  skins:  { items: SKINS, icon: 'skin_', owned: () => me.skins, cur: () => me.skin, def: 'default', ownedKey: 'skins', curKey: 'skin', note: 'Ball skins. Same size, same hitbox - looks only.' },
  fx:     { items: FXS, icon: 'fx_', owned: () => me.fxs, cur: () => me.fx, def: 'none', ownedKey: 'fxs', curKey: 'fx', note: 'Score effects play where a ball you hit lands in, across the net.' },
  emotes: { items: EMOTES, icon: 'emote_', owned: () => me.emotes, cur: () => null, def: null, ownedKey: 'emotes', curKey: null, note: 'Equipped emotes go on your emote wheel (8 slots).', multi: true },
};
$$('#shopTabs button').forEach(b => b.onclick = () => { shopTab = b.dataset.tab; renderShop(); });
function renderShop() {
  if (!SHOP_KINDS[shopTab] && shopTab !== 'bt') shopTab = 'skins';
  $$('#shopTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === shopTab));
  const grid = $('#shopGrid'); grid.innerHTML = '';
  $('#btOdds').classList.toggle('hidden', shopTab !== 'bt');
  if (shopTab === 'bt') { renderBtShop(); return; }
  const K = SHOP_KINDS[shopTab]; $('#shopNote').textContent = K.note + (me.guest ? ' (Log in to buy.)' : '');
  const ownedMap = K.owned() || {}; const cur = K.cur();
  const ids = Object.keys(K.items).sort((a, b) => (RARITY_ORDER[K.items[a].rarity] - RARITY_ORDER[K.items[b].rarity]) || (K.items[a].price - K.items[b].price));
  const onWheel = K.multi ? wheelSlots() : [];
  for (const id of ids) {
    const it = K.items[id]; const free = !it.price; const owned = free || !!ownedMap[id]; const eq = K.multi ? onWheel.includes(id) : cur === id;
    const d = document.createElement('div'); d.className = 'item b-' + it.rarity + (owned ? ' owned' : '') + (eq ? ' equipped' : '');
    d.innerHTML = `<img src="${ICONS[K.icon + id] || ''}" alt=""><div class="nm">${it.name}</div><div class="rar r-${it.rarity}">${it.rarity}</div><div class="pr">${free ? 'FREE' : owned ? 'OWNED' : '$' + it.price.toLocaleString()}</div><button>${eq ? 'EQUIPPED' : owned ? 'EQUIP' : 'BUY'}</button>`;
    d.querySelector('button').onclick = () => owned ? (K.multi ? equipEmote(id) : equipItem(shopTab, eq ? K.def : id)) : buyItem(shopTab, id);
    grid.appendChild(d);
  }
}
async function buyItem(kind, id) {
  if (me.guest) { toast('Log in to buy (Settings > Account)', 'err'); return; }
  const K = SHOP_KINDS[kind]; const price = K.items[id].price;
  const res = await db.ref('profiles/' + me.id).transaction(pr => { if (!pr) return pr; if ((pr.dollars || 0) < price) return; pr.dollars = (pr.dollars || 0) - price; pr[K.ownedKey] = pr[K.ownedKey] || {}; pr[K.ownedKey][id] = true; if (K.curKey) pr[K.curKey] = id; else { pr.wheel = pr.wheel || {}; for (let i = 0; i < 8; i++) if (!pr.wheel[i]) { pr.wheel[i] = id; break; } } return pr; });
  if (!res.committed) { toast(`Not enough dollars ($${price.toLocaleString()} needed)`, 'err'); return; }
  toast('Bought ' + K.items[id].name + '!', 'ok');
}
function equipItem(kind, id) {
  const K = SHOP_KINDS[kind];
  if (me.guest) { if (K.items[id].price > 0) { toast('Log in to buy', 'err'); return; } if (kind === 'skins') me.skin = id; else me.fx = id; onCosmeticsChanged(); return; }
  db.ref('profiles/' + me.id + '/' + K.curKey).set(id);
}
function hasTrait() { return false; }             // (the old trait system is gone - breakthroughs replaced it)

/* ---------------- Breakthroughs: one box, opened the moment you buy it ---------------- */
function btLabel(bt) { if (!bt) return ''; if (bt.r === 'X') return (BT_ABILITIES[bt.ab] || {}).name || 'Ability'; return `+${bt.v} ${STAT_INFO[bt.stat][0]}`; }
function btDesc(bt) { if (bt.r === 'X') return (BT_ABILITIES[bt.ab] || {}).desc || ''; return `Adds ${bt.v} to your ${STAT_INFO[bt.stat][0]} stat while equipped.`; }
function btCardHtml(bt, cls = '', extra = '') { return `<div class="btcard ${cls}" style="--rc:${BT_COLOR[bt.r]}"><div class="bl">${bt.r}</div><div class="bn">${esc(btLabel(bt))}</div><div class="bd">${esc(btDesc(bt))}</div>${extra}</div>`; }
function rollBreakthrough() {
  let r = Math.random(), i = 0; for (; i < BT_ODDS.length - 1; i++) { if (r < BT_ODDS[i]) break; r -= BT_ODDS[i]; }
  const rar = BT_RARITY[i];
  if (rar === 'X') return { r: 'X', ab: 'supercharge', t: Date.now() };
  const [lo, hi] = BT_RANGE[rar]; return { r: rar, stat: STAT_KEYS[Math.floor(Math.random() * STAT_KEYS.length)], v: lo + Math.floor(Math.random() * (hi - lo + 1)), t: Date.now() };
}
function renderBtShop() {
  $('#shopNote').textContent = 'Breakthroughs add to your stats - equip up to 3 in Inventory. X breakthroughs are abilities (one at a time).' + (me.guest ? ' (Log in to open.)' : '');
  const d = document.createElement('div'); d.className = 'item b-legendary'; d.style.gridColumn = 'span 2';
  d.innerHTML = `<img src="${ICONS.bt_box || ''}" alt=""><div class="nm">Breakthrough Box</div><div class="rar r-legendary">D - C - B - A - S - X</div><div class="pr">$${BT_COST} each</div><div class="row" style="gap:6px"><button data-n="1">OPEN 1</button><button data-n="5">OPEN 5 ($${(BT_COST * 5).toLocaleString()})</button><button data-n="10">OPEN 10 ($${(BT_COST * 10).toLocaleString()})</button></div>`;
  d.querySelectorAll('button').forEach(b => b.onclick = () => buyBreakthrough(+b.dataset.n)); $('#shopGrid').appendChild(d);
  $('#btOdds').innerHTML = BT_RARITY.map((r, i) => `<div class="odd" style="--rc:${BT_COLOR[r]}"><b>${r}</b><span>${Math.round(BT_ODDS[i] * 100)}%</span><small>${r === 'X' ? 'ability' : r === 'S' ? '+50' : `+${BT_RANGE[r][0]} to +${BT_RANGE[r][1]}`}</small></div>`).join('');
}
let opening = false;
async function buyBreakthrough(n = 1) {
  if (me.guest) { toast('Log in to open breakthroughs (Settings > Account)', 'err'); return; }
  if (opening) return; opening = true;
  const rolls = []; for (let i = 0; i < n; i++) rolls.push(rollBreakthrough()); const price = BT_COST * n;
  const res = await db.ref('profiles/' + me.id).transaction(pr => { if (!pr) return pr; if ((pr.dollars || 0) < price) return; pr.dollars = (pr.dollars || 0) - price; pr.bts = pr.bts || {}; rolls.forEach((bt, i) => { pr.bts['k' + Date.now().toString(36) + i + rnd()] = bt; }); return pr; });
  if (!res.committed) { opening = false; toast(`Not enough dollars ($${price.toLocaleString()} needed)`, 'err'); return; }
  playOpen(rolls);
}
const btRank = bt => BT_RARITY.indexOf(bt.r) * 100 + (bt.v || 0);
function playOpen(list) {                           // every box rattles and bursts; only the best breakthrough is thrown out as a card
  if (!Array.isArray(list)) list = [list];
  const best = list.reduce((a, b) => btRank(b) > btRank(a) ? b : a, list[0]); const n = list.length;
  const fx = $('#openFx'), chest = $('#openChest'), burst = $('#openBurst'), card = $('#openCard'), msg = $('#openMsg'), done = $('#openDone'), stage = $('#openStage');
  fx.classList.remove('hidden'); fx.querySelectorAll('.spark,.mchest').forEach(s => s.remove());
  burst.classList.remove('go'); card.classList.remove('fly'); card.style.opacity = 0; msg.style.opacity = 0; done.style.opacity = 0; done.classList.remove('ready'); fx.classList.remove('ready');
  card.className = 'btcard big'; card.style.setProperty('--rc', BT_COLOR[best.r]); card.innerHTML = `<div class="bl">${best.r}</div><div class="bn">${esc(btLabel(best))}</div><div class="bd">${esc(btDesc(best))}</div>`;
  burst.style.background = BT_COLOR[best.r];
  const chests = [];
  if (n === 1) { chest.classList.remove('hidden'); chest.src = ICONS.bt_box || ''; chest.classList.remove('shake'); void chest.offsetWidth; chest.classList.add('shake'); }
  else {
    chest.classList.add('hidden'); const cols = Math.min(5, n), rows = Math.ceil(n / cols);
    list.forEach((bt, i) => { const im = document.createElement('img'); im.className = 'mchest shake'; im.src = ICONS.bt_box || ''; const c = i % cols, r = Math.floor(i / cols); im.style.left = (210 - cols * 45 + c * 90 - 43 + 45) + 'px'; im.style.top = (250 + r * 92 - (rows - 1) * 46) + 'px'; im.style.animationDelay = (i * 0.04) + 's'; im.style.setProperty('--rc', BT_COLOR[bt.r]); stage.appendChild(im); chests.push([im, bt]); });
  }
  setTimeout(() => {
    if (fx.classList.contains('hidden')) return;
    if (n === 1) { chest.src = ICONS.bt_boxopen || chest.src; chest.classList.remove('shake'); }
    for (const [im, bt] of chests) { im.src = ICONS.bt_boxopen || im.src; im.classList.remove('shake'); if (bt === best) im.classList.add('best'); }
    burst.classList.add('go'); card.classList.add('fly'); card.style.opacity = '';
    const k = best.r === 'X' || best.r === 'S' ? 40 : 18;
    for (let i = 0; i < k; i++) { const s = document.createElement('div'); s.className = 'spark'; const a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 150; s.style.setProperty('--dx', Math.cos(a) * r + 'px'); s.style.setProperty('--dy', (Math.sin(a) * r - 60) + 'px'); s.style.background = i % 3 ? BT_COLOR[best.r] : '#fff'; stage.appendChild(s); }
    setTimeout(() => { msg.innerHTML = `${n > 1 ? 'BEST OF ' + n + ': ' : ''}${best.r} BREAKTHROUGH<small>${esc(btLabel(best))}${n > 1 ? ` - all ${n} are in Inventory > Breakthroughs` : ' - equip it in Inventory > Breakthroughs'}</small>`; msg.style.opacity = 1; done.style.opacity = 1; done.classList.add('ready'); fx.classList.add('ready'); }, 900);
  }, 950);
}
function finishOpen() { $('#openFx').querySelectorAll('.mchest').forEach(s => s.remove()); $('#openChest').classList.remove('hidden'); $('#openFx').classList.add('hidden'); $('#openFx').classList.remove('ready'); opening = false; invTab = 'bt'; openMenu('inventory'); }
$('#openDone').onclick = e => { e.stopPropagation(); finishOpen(); };
$('#openFx').addEventListener('click', e => { if (e.currentTarget.classList.contains('ready')) finishOpen(); });
document.addEventListener('keydown', e => { if (!$('#openFx').classList.contains('hidden') && $('#openFx').classList.contains('ready') && (e.code === 'Space' || e.code === 'Enter')) finishOpen(); });
function equipBt(key) {
  const own = me.bts || {}; const bt = own[key]; if (!bt || me.guest) return;
  const lo = Object.assign({}, me.btLoad || {}); const slots = [0, 1, 2];
  if (slots.some(i => lo[i] === key)) return;
  if (bt.r === 'X' && slots.some(i => lo[i] && own[lo[i]] && own[lo[i]].r === 'X')) { toast('Only one X breakthrough can be equipped at a time', 'err'); return; }
  const free = slots.find(i => !lo[i] || !own[lo[i]]); if (free === undefined) { toast('All 3 slots are full - unequip one first', 'err'); return; }
  lo[free] = key; db.ref('profiles/' + me.id + '/btLoad').set(lo);
}
function unequipBt(i) { if (me.guest) return; db.ref('profiles/' + me.id + '/btLoad/' + i).remove(); }
async function deleteBt(key) {
  const bt = (me.bts || {})[key]; if (!bt || me.guest) return; const refund = Math.floor(BT_COST / 2);
  if (!await confirmDialog('Delete ' + bt.r + ' breakthrough?', btLabel(bt) + ' will be gone for good. You get $' + refund + ' back.')) return;
  const res = await db.ref('profiles/' + me.id).transaction(pr => { if (!pr || !pr.bts || !pr.bts[key]) return; pr.bts[key] = null; pr.dollars = (pr.dollars || 0) + refund; if (pr.btLoad) for (const i of [0, 1, 2]) if (pr.btLoad[i] === key) pr.btLoad[i] = null; return pr; });
  if (res.committed) toast('Deleted - +$' + refund, 'ok');
}

/* ---------------- Inventory (in the menu) ---------------- */
let invTab = 'skins', invSel = null;
$$('#invNav button').forEach(b => b.onclick = () => { invTab = b.dataset.inv; invSel = null; renderInventory(); });
function openInventory(tab) { if (tab) { invTab = tab; invSel = null; } openMenu('inventory'); }
function renderInventory() {
  $$('#invNav button').forEach(b => b.classList.toggle('on', b.dataset.inv === invTab));
  const bts = invTab === 'bt';
  $('#invMain').classList.toggle('hidden', bts); $('#invTraits').classList.toggle('hidden', !bts);
  if (bts) { renderBtTab(); return; }
  const K = SHOP_KINDS[invTab]; if (!K) { invTab = 'skins'; return renderInventory(); }
  const ownedMap = K.owned() || {}; const cur = K.cur(); const onWheel = K.multi ? wheelSlots() : [];
  const ids = Object.keys(K.items).filter(id => !K.items[id].price || ownedMap[id]).sort((a, b) => (RARITY_ORDER[K.items[a].rarity] - RARITY_ORDER[K.items[b].rarity]) || (K.items[a].price - K.items[b].price));
  const grid = $('#invGrid'); grid.innerHTML = '';
  if (!ids.length) grid.innerHTML = `<div id="invEmpty">Nothing here yet - see the Shop.</div>`;
  if (invSel && !ids.includes(invSel)) invSel = null;
  if (!invSel) invSel = ids.find(id => K.multi ? onWheel.includes(id) : cur === id) || ids[0] || null;
  for (const id of ids) {
    const it = K.items[id]; const eq = K.multi ? onWheel.includes(id) : cur === id;
    const d = document.createElement('div'); d.className = 'tile b-' + it.rarity + (id === invSel ? ' sel' : '');
    d.innerHTML = `<img src="${ICONS[K.icon + id] || ''}" alt="">${eq ? '<div class="eqp">EQUIPPED</div>' : ''}`;
    d.title = it.name; d.onclick = () => { invSel = id; renderInventory(); }; grid.appendChild(d);
  }
  const det = $('#invDetail'); det.classList.toggle('none', !invSel);
  if (!invSel) { det.innerHTML = 'Select an item'; return; }
  const it = K.items[invSel]; const eq = K.multi ? onWheel.includes(invSel) : cur === invSel;
  det.innerHTML = `<div class="nm">${it.name}</div><img src="${ICONS[K.icon + invSel] || ''}" alt=""><div class="rar r-${it.rarity}">${it.rarity}</div><div class="desc">${it.price ? 'Bought for $' + it.price.toLocaleString() : 'Free for everyone'}</div><button class="btn ${eq ? 'red' : 'green'}">${K.multi ? (eq ? 'REMOVE FROM WHEEL' : 'ADD TO WHEEL') : (eq ? (invSel === K.def ? 'EQUIPPED' : 'UNEQUIP') : 'EQUIP')}</button>`;
  const btn = det.querySelector('button'); if (!K.multi && eq && invSel === K.def) btn.disabled = true;
  btn.onclick = () => K.multi ? equipEmote(invSel) : equipItem(invTab, eq ? K.def : invSel);
}
function onInventoryChanged() { if (menuOpen() && menuSec === 'inventory') renderInventory(); }
function renderBtTab() {
  const lo = me.btLoad || {}, own = me.bts || {};
  $('#loadout').innerHTML = [0, 1, 2].map(i => { const k = lo[i]; const bt = k && own[k]; return bt ? btCardHtml(bt, 'slot', `<button data-un="${i}">UNEQUIP</button>`) : `<div class="btcard slot empty"><div class="bn">Empty slot</div><div class="bd">Equip a breakthrough below</div></div>`; }).join('');
  $$('#loadout [data-un]').forEach(b => b.onclick = () => unequipBt(+b.dataset.un));
  const bag = $('#invBag'); bag.innerHTML = '';
  if (me.guest) { bag.innerHTML = '<div id="invEmpty">Log in to collect breakthroughs.</div>'; return; }
  const equipped = new Set([lo[0], lo[1], lo[2]].filter(Boolean));
  const order = r => BT_RARITY.indexOf(r);
  const keys = Object.keys(own).filter(k => own[k] && !equipped.has(k)).sort((a, b) => order(own[b].r) - order(own[a].r) || (own[b].v || 0) - (own[a].v || 0));
  for (const k of keys) { const w = document.createElement('div'); w.innerHTML = btCardHtml(own[k], 'mini', '<button class="eq">EQUIP</button><button class="del" title="Delete">X</button>'); const d = w.firstChild; d.querySelector('.eq').onclick = () => equipBt(k); d.querySelector('.del').onclick = () => deleteBt(k); bag.appendChild(d); }
  if (!keys.length) bag.innerHTML = '<div id="invEmpty">No breakthroughs yet - open one in Shop > Breakthroughs ($500).</div>';
}

/* ---------------- Stats (in the menu) ---------------- */
function renderStats() {
  const list = $('#statList'); list.innerHTML = '';
  $('#statNote').textContent = me.guest ? 'Log in to buy stat points.' : `$${STAT_COST} a point, up to ${STAT_BUY_MAX} per stat. Breakthroughs add on top - reach 100 to unlock the stat's purple effect.`;
  for (const k of STAT_KEYS) {
    const [name, desc, purple] = STAT_INFO[k]; const base = statBase(k), bonus = statBonus(k), eff = base + bonus;
    const d = document.createElement('div'); d.className = 'stat' + (eff >= 100 ? ' maxed' : '');
    d.innerHTML = `<div class="sn">${name}</div>
      <div class="sbar"><i style="width:${Math.min(100, base)}%"></i><em style="left:${Math.min(100, base)}%;width:${Math.max(0, Math.min(100, eff) - Math.min(100, base))}%"></em><s style="left:50%"></s></div>
      <div class="sv"><b>${base}/${STAT_BUY_MAX}</b>${bonus ? ` <span class="bonus">(+${bonus})</span>` : ''}<small>acts as ${eff}</small></div>
      <div class="sb"><button data-k="${k}" data-n="1" ${base >= STAT_BUY_MAX || me.guest ? 'disabled' : ''}>+1 $${STAT_COST}</button><button data-k="${k}" data-n="5" ${base >= STAT_BUY_MAX || me.guest ? 'disabled' : ''}>+5</button></div>`;
    list.appendChild(d);
  }
  const bts = btEquipped(); $('#statBts').innerHTML = bts.length ? bts.map(bt => `<span class="chip" style="--rc:${BT_COLOR[bt.r]}"><b>${bt.r}</b> ${esc(btLabel(bt))}</span>`).join('') : '<span class="dim">No breakthroughs equipped.</span>';
  $$('#statList button[data-k]').forEach(b => b.onclick = () => buyStat(b.dataset.k, +b.dataset.n));
}
async function buyStat(k, n) {
  if (me.guest) return; const have = statBase(k); n = Math.min(n, STAT_BUY_MAX - have); if (n <= 0) return; const price = n * STAT_COST;
  const res = await db.ref('profiles/' + me.id).transaction(pr => { if (!pr) return pr; if ((pr.dollars || 0) < price) return; const st = pr.stats = pr.stats || {}; const cur = Math.floor(st[k] || 0); if (cur + n > STAT_BUY_MAX) return; st[k] = cur + n; pr.dollars -= price; return pr; });
  if (!res.committed) toast(`Not enough dollars ($${price.toLocaleString()} needed)`, 'err'); else toast(`${STAT_INFO[k][0]} +${n}`, 'ok');
}

/* ---------------- Quests (placeholder until they are real) ---------------- */
const QUESTS = [
  ['🏐', 'Warm Up', 'Play 3 matches of any mode', 0, 3, '$150'],
  ['🔥', 'Spike Machine', 'Land 20 spikes in', 0, 20, '$250'],
  ['🧱', 'Wall', 'Get 5 blocks in online matches', 0, 5, '$300'],
  ['🤝', 'Better Together', 'Win a match with a friend in your party', 0, 1, '$400'],
  ['🎯', 'Ace', 'Serve an ace', 0, 1, '$200'],
];
function renderQuests() {
  $('#questList').innerHTML = '<div class="pane" style="font-weight:800;font-size:13px">Daily quests will reset every day at midnight EST. They are not live yet - here is what is coming.</div>' +
    QUESTS.map(([ic, t, d, p, n, r]) => `<div class="quest"><div class="qi">${ic}</div><div style="flex:1"><div class="qt">${t}</div><div class="qd">${d}</div><div class="qb"><i style="width:${(p / n * 100).toFixed(0)}%"></i></div></div><div class="qr">${r}<br><small style="opacity:.6">${p}/${n}</small></div></div>`).join('');
}

/* ---------------- Emotes + wheel ---------------- */
let wheelOpen = false, wheelSel = -1;
function startEmote(id) { if (!EMOTES[id] || !P.onGround || P.dive || P.holding) return; P.emote = { id, t0: T }; P.rig.emote = id; P.rig.emoteT = 0; P.rig.setPose('idle'); P.rig.base = 'idle'; }
function stopEmote() { if (!P.emote) return; P.emote = null; P.rig.emote = null; P.rig.pitchTarget = 0; }
function wheelSlots() { const out = []; for (let i = 0; i < 8; i++) out.push(me.wheel && me.wheel[i] && EMOTES[me.wheel[i]] ? me.wheel[i] : null); return out; }
function toggleWheel() { wheelOpen ? closeWheel(false) : openWheel(); }
function openWheel() {
  if (uiOpen()) return;
  wheelOpen = true; wheelSel = -1; const w = $('#emoteWheel'); w.classList.remove('hidden');
  w.querySelectorAll('.slot').forEach(e => e.remove());
  const slots = wheelSlots();
  for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + i * Math.PI / 4; const el = document.createElement('div'); el.className = 'slot'; el.style.left = (180 + Math.cos(a) * 130) + 'px'; el.style.top = (180 + Math.sin(a) * 130) + 'px'; el.innerHTML = slots[i] ? `${EMOTES[slots[i]].name}` : `<small>empty</small>`; w.appendChild(el); }
}
function closeWheel(play) { if (!wheelOpen) return; wheelOpen = false; $('#emoteWheel').classList.add('hidden'); if (play && wheelSel >= 0) { const id = wheelSlots()[wheelSel]; if (id) startEmote(id); } }
const wheelPick = (x, y) => { const dx = x - innerWidth / 2, dy = y - innerHeight / 2; const dist = Math.hypot(dx, dy); wheelSel = dist < 40 ? -1 : ((Math.round((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8; $$('#emoteWheel .slot').forEach((el, i) => el.classList.toggle('sel', i === wheelSel)); };
document.addEventListener('mousemove', e => { if (wheelOpen) wheelPick(e.clientX, e.clientY); });
document.addEventListener('mousedown', e => { if (wheelOpen && e.button === 0) { e.preventDefault(); e.stopPropagation(); closeWheel(true); } }, true);
let wheelOpenTouch = null;
document.addEventListener('touchstart', e => { if (!wheelOpen) return; if ([...e.changedTouches].some(t => t.identifier === wheelOpenTouch)) return; e.preventDefault(); wheelPick(e.touches[0].clientX, e.touches[0].clientY); }, { capture: true, passive: false });
document.addEventListener('touchmove', e => { if (!wheelOpen) return; e.preventDefault(); wheelPick(e.touches[0].clientX, e.touches[0].clientY); }, { capture: true, passive: false });
document.addEventListener('touchend', e => { if (!wheelOpen) return; if ([...e.changedTouches].some(t => t.identifier === wheelOpenTouch)) { wheelOpenTouch = null; return; } e.preventDefault(); closeWheel(true); }, { capture: true, passive: false });
document.addEventListener('keydown', e => { if (wheelOpen && e.code === 'Escape') closeWheel(false); }, true);
function equipEmote(id) {
  const wheel = Object.assign({}, me.wheel || {}); const slots = wheelSlots(); const idx = slots.indexOf(id);
  if (idx >= 0) delete wheel[idx]; else { const free = slots.indexOf(null); if (free < 0) { toast('Wheel is full - remove an emote first', 'err'); return; } wheel[free] = id; }
  if (me.guest) { me.wheel = wheel; renderShop(); onInventoryChanged(); return; }
  db.ref('profiles/' + me.id + '/wheel').set(wheel);
}

/* ---------------- Chat (global + party) ---------------- */
let chatTab = 'global', lastChatSend = 0;
const chatLog = $('#chatLog'), chatInput = $('#chatInput');
$$('#chat .ctabs button').forEach(b => b.onclick = () => { chatTab = b.dataset.ct; $$('#chat .ctabs button').forEach(x => x.classList.toggle('on', x.dataset.ct === chatTab)); chatInput.placeholder = chatTab === 'party' ? 'Party chat...' : `Press ${keyName(KEYS.chat)} to chat...`; renderChat(); });
const chatLogs = { global: [], party: [] };
function chatLine(html, cls = '', which = 'global') { const arr = chatLogs[cls === 'party' ? 'party' : which]; arr.push({ html, cls }); while (arr.length > 60) arr.shift(); if ((cls === 'party' ? 'party' : which) === chatTab) renderChat(); }
function renderChat() { chatLog.innerHTML = chatLogs[chatTab].map(m => `<div class="${m.cls}">${m.html}</div>`).join(''); chatLog.scrollTop = chatLog.scrollHeight; }
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
chatInput.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Escape') { chatInput.blur(); return; }
  if (e.key !== 'Enter') return;
  const text = chatInput.value.trim(); chatInput.value = ''; chatInput.blur();
  if (!text) return;
  if (!S.online) { chatLine('<span class="sys">Offline - chat unavailable</span>'); return; }
  if (Date.now() - lastChatSend < 800) { chatLine('<span class="sys">Slow down</span>'); return; }
  lastChatSend = Date.now();
  if (chatTab === 'party') { if (!S.party) { chatLine('<span class="sys">You are not in a party</span>', 'sys', 'party'); return; } db.ref('parties/' + S.party.pid + '/chat').push({ n: me.name, sid: SID, t: text.slice(0, 120), ts: firebase.database.ServerValue.TIMESTAMP }); }
  else db.ref('chat/global').push({ n: me.name, sid: SID, t: text.slice(0, 120), ts: firebase.database.ServerValue.TIMESTAMP });
});
let chatSub = false;
function subscribeChat() { if (chatSub) return; chatSub = true; db.ref('chat/global').orderByChild('ts').startAt(snow() - 1000).on('child_added', s => { const m = s.val(); if (m) { chatLine(`<b>${esc(m.n)}:</b> ${esc(m.t)}`); addBubble(m.sid || sidForName(m.n), m.t); } }); }
function pruneChat() { try { const cutoff = snow() - 3 * 60 * 1000; db.ref('chat/global').orderByChild('ts').endAt(cutoff).limitToFirst(100).once('value').then(s => s.forEach(c => c.ref.remove())); } catch (e) { } }
setInterval(pruneChat, 60000);

/* ---------------- Parties: your party is your team when you queue ---------------- */
S.party = null; let partyUnsub = null, inviteQueue = [], partySeen = { queued: null, start: null };
function renderParty() {
  const pty = S.party; $('#partyNone').classList.toggle('hidden', !!pty); $('#partyMain').classList.toggle('hidden', !pty);
  $('#partyBadge').textContent = pty ? '(' + Object.keys(pty.members || {}).length + ')' : '';
  if (!pty) return;
  const list = $('#partyMembers'); list.innerHTML = '';
  for (const sid in (pty.members || {})) { const d = document.createElement('div'); d.className = 'mem'; d.innerHTML = `<span>${esc(pty.members[sid].name)}${sid === SID ? ' (you)' : ''}</span>${sid === pty.leader ? '<span class="lead">LEADER</span>' : ''}`; list.appendChild(d); }
  const on = $('#partyOnline'); on.innerHTML = '';
  db.ref('presence').once('value').then(s => { s.forEach(c => { const v = c.val(); if (!v || c.key === SID || (pty.members || {})[c.key]) return; const b = document.createElement('button'); b.className = 'btn small grey'; b.textContent = v.name; b.onclick = () => inviteToParty(c.key, v.name); on.appendChild(b); }); });
}
function partyCreate() {
  if (!S.online) { toast('Offline', 'err'); return; }
  const pid = 'p' + rnd() + Date.now().toString(36);
  db.ref('parties/' + pid).set({ leader: SID, created: firebase.database.ServerValue.TIMESTAMP, members: { [SID]: { name: me.name, id: me.id } } }).then(() => joinPartyLocal(pid));
}
function joinPartyLocal(pid) {
  if (partyUnsub) partyUnsub();
  const ref = db.ref('parties/' + pid);
  const mr = ref.child('members/' + SID); mr.set({ name: me.name, id: me.id }); mr.onDisconnect().remove();
  const cb = ref.on('value', s => {
    const v = s.val();
    if (!v || !v.members || !v.members[v.leader] || !v.members[SID]) { leavePartyLocal(); chatLine('<span class="sys">Party disbanded</span>', 'sys', 'party'); return; }
    const was = S.party; S.party = Object.assign({ pid }, v);
    if (!was) { chatLine('<span class="sys">You joined a party</span>', 'sys', 'party'); partySeen = { queued: (v.queued || {}).qid || null, start: (v.start || {}).mid || null }; }
    if (menuOpen()) { if (menuSec === 'social') renderParty(); if (menuSec === 'play') renderPlay(); }
    // the leader queued or started practice: follow them in
    if (v.leader !== SID && v.queued && v.queued.qid !== partySeen.queued) { partySeen.queued = v.queued.qid; if (S.scene === 'menu' && !S.queue && v.queued.players && v.queued.players[SID]) joinQueue(v.queued.mode, v.queued.qid); }
    if (v.leader !== SID && v.start && v.start.mid !== partySeen.start) { partySeen.start = v.start.mid; if (S.scene === 'menu' && v.start.for && v.start.for[SID]) { closePanels(); enterMatch(v.start.mid); } }
  });
  const cref = ref.child('chat'); const ccb = cref.orderByChild('ts').startAt(snow() - 1000).on('child_added', s => { const m = s.val(); if (m) { chatLine(`<b>${esc(m.n)}:</b> ${esc(m.t)}`, 'party'); addBubble(m.sid || sidForName(m.n), m.t); } });
  partyUnsub = () => { ref.off('value', cb); cref.off('child_added', ccb); };
}
function leavePartyLocal() { if (partyUnsub) partyUnsub(); partyUnsub = null; S.party = null; renderParty(); if (menuOpen() && menuSec === 'play') renderPlay(); }
function partyLeave() {
  const pty = S.party; if (!pty) return;
  const ref = db.ref('parties/' + pty.pid);
  if (pty.leader === SID) ref.remove(); else { ref.child('members/' + SID).onDisconnect().cancel(); ref.child('members/' + SID).remove(); }
  leavePartyLocal(); chatLogs.party = []; chatLine('<span class="sys">You left the party</span>', 'sys', 'party');
}
function inviteToParty(sid, name) { if (!S.party) return; db.ref('invites/' + sid + '/' + S.party.pid).set({ from: me.name, pid: S.party.pid, ts: firebase.database.ServerValue.TIMESTAMP }); toast('Invited ' + name, 'ok'); }
$('#partyCreate').onclick = partyCreate;
$('#partyLeave').onclick = partyLeave;
$('#partyInviteBtn').onclick = async () => {
  const name = $('#partyInviteName').value.trim().toLowerCase(); if (!name || !S.party) return;
  const snap = await db.ref('presence').once('value'); let found = null; snap.forEach(c => { const v = c.val(); if (v && (v.name || '').toLowerCase() === name && c.key !== SID) found = { sid: c.key, name: v.name }; });
  if (!found) { toast('No online player named ' + $('#partyInviteName').value, 'err'); return; }
  inviteToParty(found.sid, found.name); $('#partyInviteName').value = '';
};
$('#partyInviteName').onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') $('#partyInviteBtn').click(); };
db.ref('invites/' + SID).on('child_added', s => { const v = s.val(); if (!v) return; inviteQueue.push({ pid: s.key, from: v.from }); showInvite(); });
function showInvite() { const inv = inviteQueue[0]; const box = $('#inviteBox'); if (!inv) { box.classList.add('hidden'); return; } $('#inviteText').textContent = inv.from + ' invited you to their party'; box.classList.remove('hidden'); }
$('#inviteAccept').onclick = async () => {
  const inv = inviteQueue.shift(); showInvite(); if (!inv) return;
  db.ref('invites/' + SID + '/' + inv.pid).remove();
  const v = (await db.ref('parties/' + inv.pid).once('value')).val();
  if (!v) { toast('That party no longer exists', 'err'); return; }
  if (S.party) partyLeave();
  joinPartyLocal(inv.pid);
};
$('#inviteDecline').onclick = () => { const inv = inviteQueue.shift(); showInvite(); if (inv) db.ref('invites/' + SID + '/' + inv.pid).remove(); };

/* =====================================================================
   NETWORK: queue, matches
   ===================================================================== */
let lastSync = 0, lastSyncSig = '', lastChangeT = 0;
function syncSelf() {
  if (!inMatch() || S.match.local) return;
  const fast = !P.onGround || P.moving || P.dive; if (!S.online || T - lastSync < (fast ? 0.066 : 0.12)) return;
  const st = myState(); const sig = JSON.stringify(st);
  if (sig !== lastSyncSig) lastChangeT = T; else if (T - lastChangeT > 0.45) return;   // settled: after a few repeat packets, stop writing
  lastSync = T; lastSyncSig = sig;
  db.ref(`matches/${S.match.id}/players/${SID}`).set(st);
}
function onIdentityChangedGame() { drawAvatar(); if (menuOpen()) showSection(menuSec); }
function onProfileChanged() { if (menuOpen()) showSection(menuSec); }
const QCOUNT = {};                                  // players waiting in each online queue (shown on the mode cards)
db.ref('queue').on('value', s => {
  const all = s.val() || {}; for (const k in QCOUNT) delete QCOUNT[k];
  for (const mode in all) for (const id in all[mode]) { const q = all[mode][id]; if (q && q.d2 && !q.match) QCOUNT[mode] = (QCOUNT[mode] || 0) + Object.keys(q.players || {}).length; }
  if (menuOpen() && menuSec === 'play') renderPlay();
});

/* ---------------- PLAY section: mode, online / bots, map, team (= your party), queue ---------------- */
let selMode = '2v2', botPlay = 'online', practiceMap = 'indoor', friendsLock = false;
const MODE_CAP = { '2v2': 2, '3v3': 3, '6v6': 6, practice: 6 };
$$('#modeCards .mode').forEach(b => b.onclick = () => { selMode = b.dataset.mode; renderPlay(); });
$$('#playMode button').forEach(b => b.onclick = () => { botPlay = b.dataset.pm; renderPlay(); });
$$('#botLevel button').forEach(b => b.onclick = () => { botLevel = b.dataset.bl; renderPlay(); });
$$('#mapPick button').forEach(b => b.onclick = () => { practiceMap = b.dataset.map; renderPlay(); });
$('#lockToggle').onclick = () => { friendsLock = !friendsLock; renderPlay(); };
$('#teamInvite').onclick = () => showSection('social');
function partyMembers() { if (!S.party) return { [SID]: { name: me.name, id: me.id } }; const out = {}; for (const sid in (S.party.members || {})) out[sid] = { name: S.party.members[sid].name, id: S.party.members[sid].id }; return out; }
const amLeader = () => !S.party || S.party.leader === SID;
$('#menuLeave').onclick = () => leaveMatch();
function renderPlay() {
  $('#inMatchPane').classList.toggle('hidden', !inMatch());
  $$('#modeCards .mode').forEach(b => b.classList.toggle('on', b.dataset.mode === selMode));
  for (const m of ['2v2', '3v3', '6v6']) { const el = $('#mc' + m); if (el) el.textContent = (m === '2v2' ? 'BEACH' : 'INDOOR') + (QCOUNT[m] ? ` · ${QCOUNT[m]} IN QUEUE` : ''); }
  const prac = selMode === 'practice';
  $('#playMode').classList.toggle('hidden', prac); $$('#playMode button').forEach(b => b.classList.toggle('on', b.dataset.pm === botPlay));
  $('#botLevel').classList.toggle('hidden', prac || botPlay !== 'bots'); $$('#botLevel button').forEach(b => b.classList.toggle('on', b.dataset.bl === botLevel));
  $('#mapPick').classList.toggle('hidden', !prac); $$('#mapPick button').forEach(b => b.classList.toggle('on', b.dataset.map === practiceMap));
  $('#lockRow').classList.toggle('hidden', prac || botPlay === 'bots'); $('#lockToggle').textContent = friendsLock ? 'ON' : 'OFF'; $('#lockToggle').classList.toggle('on', friendsLock);
  const mem = partyMembers(); const list = $('#teamList'); list.innerHTML = '';
  const ids = Object.keys(mem); const cap = MODE_CAP[selMode];
  for (const sid of ids) { const nm = mem[sid].name || '?'; const d = document.createElement('div'); d.className = 'mem'; d.innerHTML = `<div class="av">${esc(nm[0].toUpperCase())}</div><span>${esc(nm)}${sid === SID ? ' (you)' : ''}</span>${S.party && sid === S.party.leader ? '<span class="lead">LEADER</span>' : ''}`; list.appendChild(d); }
  if (!prac && botPlay !== 'bots') for (let i = ids.length; i < cap; i++) { const d = document.createElement('div'); d.className = 'mem'; d.style.opacity = .35; d.innerHTML = `<div class="av">-</div><span>Filled by matchmaking</span>`; list.appendChild(d); }
  if (botPlay === 'bots' && !prac) { const d = document.createElement('div'); d.className = 'mem'; d.style.opacity = .6; d.innerHTML = `<div class="av">B</div><span>+ ${cap - 1} bot teammate${cap - 1 === 1 ? '' : 's'}, ${cap} bots against you</span>`; list.appendChild(d); }
  const qb = $('#queueBtn'); const inQ = !!S.queue;
  qb.classList.toggle('cancel', inQ); qb.disabled = false;
  if (inQ) qb.textContent = 'CANCEL';
  else if (!amLeader()) { qb.textContent = 'WAITING FOR LEADER'; qb.disabled = true; }
  else qb.textContent = prac ? 'START' : botPlay === 'bots' ? 'PLAY VS BOTS' : 'QUEUE';
  $('#queueInfo').textContent = inQ ? queueLabel() : '';
  $('#playNote').textContent = prac ? 'Practice: free play on your own court - spawn balls, serve, try everything. Your party comes with you.' : botPlay === 'bots' ? 'A local match against computer players: 25 points, win by 2. You earn a little less than online.' : ids.length > cap ? `Your party has ${ids.length} players - too many for ${selMode}.` : 'Casual: first to 25, win by 2. Every point the serve rotates. Sets go to your cursor.';
}
function queueLabel() { const s = Math.floor(T - queueStart); return `IN QUEUE - ${S.queue.mode.toUpperCase()} - ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
$('#queueBtn').onclick = () => {
  if (S.queue) { cancelQueue(true); toast('Left the queue'); renderPlay(); return; }
  if (!amLeader()) return;
  if (S.match) { toast('Leave your match first', 'err'); return; }
  const mem = partyMembers(); const n = Object.keys(mem).length;
  if (selMode === 'practice') { startPractice(mem); return; }
  if (n > MODE_CAP[selMode]) { toast(`Your party is too big for ${selMode}`, 'err'); return; }
  if (botPlay === 'bots') { closePanels(); startBotMatch(MODE_CAP[selMode]); return; }
  startQueue(selMode, mem);
};
async function startPractice(players) {
  closePanels();
  if (!S.online) { enterLocalPractice(practiceMap); return; }
  const mid = 'm' + rnd() + Date.now().toString(36);
  await db.ref('matches/' + mid).set({ d2: 1, mode: 'practice', practice: true, map: practiceMap, created: firebase.database.ServerValue.TIMESTAMP, teams: { A: players, B: {} }, state: 'practice', score: { A: 0, B: 0 }, msg: '' });
  const forP = {}; for (const sid in players) forP[sid] = true;
  if (S.party) db.ref('parties/' + S.party.pid + '/start').set({ mid, for: forP, t: firebase.database.ServerValue.TIMESTAMP });
  enterMatch(mid);
}
let queueUnsub = null, mmTimer = null, queueStart = 0;
async function startQueue(mode, players) {
  if (!S.online) { toast('Online play needs a connection - try VS BOTS', 'err'); return; }
  const qid = 'q' + rnd() + Date.now().toString(36);
  const qref = db.ref(`queue/${mode}/${qid}`);
  await qref.set({ d2: 1, leader: SID, t: firebase.database.ServerValue.TIMESTAMP, players, mode, lock: !!friendsLock });
  qref.onDisconnect().remove();
  if (S.party) db.ref('parties/' + S.party.pid + '/queued').set({ mode, qid, players: Object.fromEntries(Object.keys(players).map(k => [k, true])), t: firebase.database.ServerValue.TIMESTAMP });
  joinQueue(mode, qid);
}
function joinQueue(mode, qid) {
  if (S.queue) return;
  S.queue = { mode, qid }; queueStart = T;
  $('#queueStatus').classList.remove('hidden');
  const qref = db.ref(`queue/${mode}/${qid}`);
  const cb = qref.on('value', s => {
    const q = s.val();
    if (!q) { cancelQueue(false); toast('Queue cancelled'); if (menuOpen() && menuSec === 'play') renderPlay(); return; }
    if (q.match) { const m = q.match; cancelQueue(false); closePanels(); enterMatch(m); return; }
    if (q.leader !== SID) db.ref(`queue/${mode}/${qid}/players/${SID}`).onDisconnect().remove();
    if (q.leader === SID && !mmTimer) mmTimer = setInterval(() => matchmake(mode, qid), 2000);
  });
  queueUnsub = () => qref.off('value', cb);
  toast('In queue for ' + mode, 'ok'); if (menuOpen() && menuSec === 'play') renderPlay();
}
function cancelQueue(remove = true) {
  if (!S.queue) return;
  const { mode, qid } = S.queue; S.queue = null;
  if (queueUnsub) queueUnsub(); queueUnsub = null; if (mmTimer) clearInterval(mmTimer); mmTimer = null;
  $('#queueStatus').classList.add('hidden');
  if (remove) db.ref(`queue/${mode}/${qid}`).once('value').then(s => { const q = s.val(); if (!q) return; if (q.leader === SID) db.ref(`queue/${mode}/${qid}`).remove(); else db.ref(`queue/${mode}/${qid}/players/${SID}`).remove(); });
}
$('#queueCancelBtn').onclick = () => { cancelQueue(true); toast('Left the queue'); };
async function matchmake(mode, qid) {           // every queue leader tries: fill my team from the queue, then a full opposing team, then start the match
  if (!S.queue || S.queue.qid !== qid) return;
  const size = parseInt(mode, 10) || 2;
  const all = (await db.ref('queue/' + mode).once('value')).val() || {};
  const ids = Object.keys(all).filter(k => all[k] && all[k].d2 && !all[k].match).sort((a, b) => (all[a].t || 0) - (all[b].t || 0) || (a < b ? -1 : 1));
  if (!ids.includes(qid)) return;
  const count = id => Object.keys(all[id].players || {}).length;
  const fill = (pool) => {                                                                        // combine entries into one team of exactly `size`; friends-locked entries never share a team
    const used = []; let n = 0;
    for (const id of pool) { const c = count(id); if (!c || c > size - n) continue; if (all[id].lock && c !== size) continue; if (used.length && all[id].lock) continue; if (used.some(u => all[u].lock)) continue; used.push(id); n += c; if (n === size) break; }
    return n === size ? used : null;
  };
  const A = fill([qid].concat(ids.filter(id => id !== qid))); if (!A) return;
  const Bt = fill(ids.filter(id => !A.includes(id))); if (!Bt) return;
  const mid = 'm' + rnd() + Date.now().toString(36);
  const teamA = {}, teamB = {};
  for (const id of A) for (const sid in (all[id].players || {})) teamA[sid] = all[id].players[sid];
  for (const id of Bt) for (const sid in (all[id].players || {})) teamB[sid] = all[id].players[sid];
  await db.ref('matches/' + mid).set({ d2: 1, mode, practice: false, map: size === 2 ? 'beach' : 'indoor', created: firebase.database.ServerValue.TIMESTAMP, teams: { A: teamA, B: teamB }, state: 'serve', score: { A: 0, B: 0 }, stamina: { A: 1, B: 1 }, serve: { team: 'A', sid: Object.keys(teamA)[0] }, serveIdx: { A: 0, B: -1 }, msg: '', serveAt: firebase.database.ServerValue.TIMESTAMP });
  const others = A.concat(Bt).filter(id => id !== qid); const marked = [];
  for (const id of others) {
    const res = await db.ref(`queue/${mode}/${id}/match`).transaction(c => c ? undefined : mid);
    if (!res.committed) { for (const m of marked) db.ref(`queue/${mode}/${m}/match`).remove(); db.ref('matches/' + mid).remove(); return; }
    marked.push(id);
  }
  await db.ref(`queue/${mode}/${qid}/match`).set(mid);
  setTimeout(() => { for (const id of A.concat(Bt)) db.ref(`queue/${mode}/${id}`).remove(); }, 4000);
}
setInterval(() => { if (S.queue) { $('#queueStatusText').textContent = queueLabel(); if (menuOpen() && menuSec === 'play') $('#queueInfo').textContent = queueLabel(); } }, 500);
function renderSection(sec) {
  if (sec === 'play') renderPlay(); else if (sec === 'inventory') renderInventory(); else if (sec === 'shop') renderShop();
  else if (sec === 'quests') renderQuests(); else if (sec === 'stats') renderStats(); else if (sec === 'social') { renderFriends(); renderParty(); } else if (sec === 'settings') renderSettings();
  $('#mMoney').textContent = me.guest ? '0' : (me.dollars || 0).toLocaleString();
}
function onMenuClosed() { canvas.focus(); }

/* =====================================================================
   MATCH
   ===================================================================== */
let MATCH_NET = null;
let matchUnsubs = [];
const mref = p => (S.match && !S.match.local && S.online) ? db.ref(`matches/${S.match.id}` + (p ? '/' + p : '')) : null;
function mwrite(p, v) { const r = mref(p); if (r) r.set(v); if (S.match) applyMatchField(p, v); }
function applyMatchField(p, v) { const M = S.match; if (!M) return; if (p === 'state') onStateChange(v); else if (p === 'score') M.score = v; else if (p === 'serve') M.serve = v; else if (p === 'msg') M.msg = v; else if (p === 'serveIdx') M.serveIdx = v; else if (p === 'serveAt') M.serveAt = v; else if (p === 'stamina') M.stamina = v; }
function isHost() { const M = S.match; if (!M) return false; if (M.local) return true; const ids = Object.keys(M.players || {}).concat([SID]).sort(); return ids[0] === SID; }
const matchBall = () => balls.get('match');
function teamOf(sid) { const M = S.match; if (!M) return 'A'; if (M.teams.A && M.teams.A[sid]) return 'A'; if (M.teams.B && M.teams.B[sid]) return 'B'; const p = M.players && M.players[sid]; return p ? p.team : 'A'; }
const opp = t => t === 'A' ? 'B' : 'A';
function hostCheckHit() {
  const M = S.match, b = matchBall(); if (!M || !b || M.practice || !isHost() || M.state !== 'rally' || !b.hitter) return;
  if (b.hitType === 'toss') return;
  if (b.touches > 3) return endPoint(opp(b.sideTeam), '4 TOUCHES');
  if (b.hitter === b.prevHitter && b.hitType !== 'block' && b.prevType !== 'block' && b.prevType !== 'toss' && b.prevType) return endPoint(opp(teamOf(b.hitter)), 'DOUBLE HIT');
}
function hostBallOut() { const M = S.match, b = matchBall(); if (!M || !b || M.state !== 'rally') return; const lastTeam = b.hitter ? teamOf(b.hitter) : (M.serve ? M.serve.team : 'A'); endPoint(opp(lastTeam), 'OUT'); }
function hostBallLanded() {
  const M = S.match, b = matchBall(); if (!M || !b || M.state !== 'rally') return;
  const cd = courtDims();
  if (Math.abs(b.x) <= cd.half + BALL_R) { const side = b.x < 0 ? 'A' : 'B'; endPoint(opp(side), TEAM_NAME[opp(side)] + ' SCORES'); }
  else { const lastTeam = b.hitter ? teamOf(b.hitter) : (M.serve ? M.serve.team : 'A'); endPoint(opp(lastTeam), 'OUT'); }
}
const WIN_SCORE = 25, SERVE_LIMIT = 12;
function matchWon(sc) { const hi = Math.max(sc.A, sc.B), lo = Math.min(sc.A, sc.B); return hi >= WIN_SCORE && hi - lo >= 2; }   // one set to 25, win by 2
function endPoint(winner, msg) {
  const M = S.match, b = matchBall(); if (!M || !b || (M.state !== 'rally' && M.state !== 'serve')) return;
  const score = Object.assign({ A: 0, B: 0 }, M.score); score[winner]++;
  mwrite('score', score); mwrite('msg', msg); mwrite('state', 'point');
  writeBall(b);
  setTimeout(() => {
    if (!S.match || S.match.id !== M.id) return;
    if (matchWon(score)) { mwrite('msg', TEAM_NAME[winner] + ' TEAM WINS'); mwrite('state', 'over'); return; }
    const team = winner; const members = Object.keys(M.teams[team] || {}).filter(s => M.players[s] || s === SID).sort();
    const si = Object.assign({ A: -1, B: -1 }, M.serveIdx);
    let idx = si[team];
    if (!M.serve || M.serve.team !== team || idx < 0 || !members.includes(M.serve.sid)) idx = members.length ? (idx + 1) % members.length : 0;   // side-out: the next player in that team's order serves
    si[team] = idx; mwrite('serveIdx', si);
    const stm = Object.assign({ A: 1, B: 1 }, M.stamina); stm[winner] = Math.min(1, stm[winner] + 0.75); stm[opp(winner)] = Math.min(1, stm[opp(winner)] + 0.5); mwrite('stamina', stm);   // a new play: the winners get 75% back, the losers 50%
    mwrite('serve', { team, sid: members[idx] || null }); mwrite('msg', ''); mwrite('serveAt', snow()); mwrite('state', 'serve');
    b.active = false; b.held = null; b.hitter = b.prevHitter = null; b.hitType = b.prevType = null; b.touches = 0; b.seq++; writeBall(b);
  }, 3000);
}
function onStateChange(st) {
  const M = S.match, b = matchBall(); if (!M) return; const prev = M.state; M.state = st;
  if (st === 'point') { P.serving = false; if (P.holding) { P.holding = false; P.serveMode = false; P.serveAim = null; if (b) b.held = null; P.rig.base = 'idle'; P.rig.setPose('idle'); } }
  if (st === 'serve') { if (M.bots) botsOnServe(); P.serving = false; if (b) { b.active = false; b.held = null; b.frozen = false; } if (!M.practice && prev !== st) resetToSpawn(); P.holding = false; P.serveMode = false; P.serveAim = null; if (P.rig.base === 'hold') { P.rig.base = 'idle'; P.rig.setPose('idle'); } }
  if (st === 'over' && prev !== 'over') {
    const winner = (M.score.A > M.score.B) ? 'A' : 'B'; const won = teamOf(SID) === winner;
    if (!M.practice) { const w = M.bots ? 50 : 150, l = M.bots ? 20 : 50; addDollars(won ? w : l); toast(won ? 'Victory! +$' + w : 'Defeat. +$' + l, won ? 'ok' : 'err', 5000); }
    setTimeout(() => { if (S.match && S.match.id === M.id) leaveMatch(); }, 6000);
  }
}
function spawnX(team, idx, n) { const cd = courtDims(); const frac = n <= 1 ? 0.45 : 0.18 + 0.64 * idx / (n - 1); return teamSide(team) * frac * cd.half; }
function resetToSpawn() {                       // back to your starting spot (match start and after every point)
  const M = S.match; if (!M) return;
  const mates = Object.keys(M.teams[P.team] || {}).sort(); const idx = Math.max(0, mates.indexOf(SID));
  P.x = M.practice ? -4 : spawnX(P.team, idx, mates.length); P.y = 0; P.vx = P.vy = 0; P.onGround = true; P.f = P.team === 'A' ? 1 : -1;
  P.holding = false; P.serveMode = false; P.serveAim = null; P.dive = null; P.dash = null; P.glide = null; P.charging = false; P.airUsed = false; P.act = null; P.swingAt = 0; P.onStairs = false;
  if (P.rig) { P.rig.base = 'idle'; P.rig.setPose('idle'); P.rig.pitchTarget = 0; }
}
async function enterMatch(mid) {
  if (S.match) return;
  let m = null;
  if (S.online) m = (await db.ref('matches/' + mid).once('value')).val();
  if (!m) { toast('Match not found', 'err'); return; }
  beginMatch({ id: mid, mode: m.mode, practice: !!m.practice, map: m.map || 'indoor', teams: m.teams || { A: {}, B: {} }, players: {}, score: m.score || { A: 0, B: 0 }, stamina: m.stamina || { A: 1, B: 1 }, state: m.state, serve: m.serve || null, serveIdx: m.serveIdx || { A: -1, B: -1 }, msg: m.msg || '', local: false });
}
function enterLocalPractice(map = 'indoor') { beginMatch({ id: 'local', mode: 'practice', practice: true, map, teams: { A: { [SID]: { name: me.name } }, B: {} }, players: {}, score: { A: 0, B: 0 }, state: 'practice', serve: null, serveIdx: {}, msg: '', local: true }); }
function setMyRig(variant) {
  const model = 'boy';
  if (P.rig && P.rig.variant === variant && P.rig.model === model) return;
  const base = P.rig ? P.rig.base : 'idle'; P.rig = new Rig2D(variant, model); P.rig.base = base; P.rig.setPose(base); P.rig.place(P.x, P.y, P.f, P.onGround); P.rig.snap();
}
function onCosmeticsChanged() { if (P.rig) setMyRig(P.rig.variant); drawAvatar(); if (menuOpen()) showSection(menuSec); }
function beginMatch(M) {
  M.enteredAt = T; M.absentSince = 0;
  cancelQueue(false);
  S.match = M; S.scene = 'match'; closePanels(); remotesClear(); BOTS.length = 0; document.body.classList.add('inMatch'); document.body.classList.remove('inMenu');
  MATCH_NET = new Net2D(0, M.map === 'beach' ? 'beach' : 'indoor');
  P.team = M.teams.B && M.teams.B[SID] ? 'B' : 'A';
  resetToSpawn(); setMyRig(TEAM_VARIANT[P.team]); P.rig.base = 'idle'; P.rig.setPose('idle');
  removeBall('match'); B = makeBall('match', 'match');
  $('#matchHud').classList.remove('hidden'); $('#modeTxt').textContent = M.practice ? 'PRACTICE' : M.mode.toUpperCase();
  if (!M.local && S.online) {
    const r = db.ref('matches/' + M.id);
    const pref = r.child('players/' + SID); pref.set(myState()); pref.onDisconnect().remove();
    const subs = [];
    const on = (path, ev, cb) => { const ref = path ? r.child(path) : r; const h = ref.on(ev, cb); subs.push(() => ref.off(ev, h)); };
    on('players', 'child_added', s => { if (s.key !== SID) { M.players[s.key] = s.val(); remoteUpsert(s.key, s.val()); } });
    on('players', 'child_changed', s => { if (s.key !== SID) { M.players[s.key] = s.val(); remoteUpsert(s.key, s.val()); } });
    on('players', 'child_removed', s => { delete M.players[s.key]; remoteRemove(s.key); hostCheckServer(); });
    on('ball', 'value', s => receiveBall(matchBall(), s.val()));
    on('score', 'value', s => { const v = s.val(); if (v) M.score = v; });
    on('state', 'value', s => { const v = s.val(); if (v && v !== M.state) onStateChange(v); });
    on('serve', 'value', s => { M.serve = s.val(); });
    on('serveIdx', 'value', s => { M.serveIdx = s.val() || M.serveIdx; });
    on('serveAt', 'value', s => { M.serveAt = s.val() || M.serveAt; });
    on('msg', 'value', s => { M.msg = s.val() || ''; });
    on('stamina', 'value', s => { const v = s.val(); if (v) M.stamina = v; });
    on('mode', 'value', s => { if (!s.exists() && S.match && S.match.id === M.id) { toast('Match ended'); leaveMatch(); } });
    matchUnsubs = subs;
  }
}
function serveLeft() { const M = S.match; if (!M || M.state !== 'serve' || !M.serveAt) return SERVE_LIMIT; return Math.max(0, SERVE_LIMIT - (snow() - M.serveAt) / 1000); }
function autoServe() {                          // your serve: you are put behind your back line with the ball in hand
  const M = S.match; if (!M || M.practice || M.state !== 'serve' || !M.serve || M.serve.sid !== SID) return;
  const key = M.serveAt || 1; if (P.servedKey === key) return; P.servedKey = key;
  const cd = courtDims(); const s = teamSide(P.team);
  P.x = s * (cd.half + 1.6); P.y = 0; P.vx = P.vy = 0; P.onGround = true; P.dive = null; P.dash = null; P.f = -s;
  P.serving = true; trySpawnBall(true, true);
}
function hostServeClock() { const M = S.match; if (!M || M.practice || !isHost() || M.state !== 'serve' || !M.serve || !M.serveAt) return; if (serveLeft() > 0) return; endPoint(opp(M.serve.team), 'SERVE TIMEOUT'); }
function hostCheckServer() {
  const M = S.match; if (!M || M.practice || M.bots || !isHost() || M.state !== 'serve' || !M.serve) return;
  if (T - (M.enteredAt || 0) < 15) return;
  const present = Object.keys(M.players).concat([SID]);
  if (present.includes(M.serve.sid)) { M.absentSince = 0; return; }
  const team = M.serve.team; const members = Object.keys(M.teams[team] || {}).filter(s => present.includes(s));
  if (!members.length) { if (!M.absentSince) { M.absentSince = T; return; } if (T - M.absentSince < 10) return; mwrite('msg', TEAM_NAME[opp(team)] + ' TEAM WINS (forfeit)'); const sc = Object.assign({}, M.score); sc[opp(team)] = Math.max(WIN_SCORE, sc[team] + 2); mwrite('score', sc); mwrite('state', 'over'); return; }
  M.absentSince = 0; mwrite('serve', { team, sid: members[0] });
}
function leaveMatch() {
  const M = S.match; if (!M) return;
  BOTS.length = 0;
  matchUnsubs.forEach(f => f()); matchUnsubs = [];
  if (!M.local && S.online) { const r = db.ref('matches/' + M.id); const pref = r.child('players/' + SID); pref.onDisconnect().cancel(); pref.remove().then(() => r.child('players').once('value')).then(s => { if (!s.exists()) r.remove(); }); }
  S.match = null; S.scene = 'menu'; remotesClear(); removeBall('match'); B = null; MATCH_NET = null; FX_LIST.length = 0; PARTS.length = 0;
  P.x = -4; P.y = 0; P.vx = P.vy = 0; P.f = 1; P.onGround = true; P.holding = false; P.serveMode = false; P.serving = false; P.servedKey = null; P.dive = null; P.charging = false; keys.clear();
  setMyRig('white'); P.rig.base = 'idle'; P.rig.setPose('idle'); P.rig.pitchTarget = 0;
  $('#matchHud').classList.add('hidden'); $('#bigMsg').textContent = '';
  document.body.classList.remove('inMatch'); openMenu('play');
}
$('#leaveBtn').onclick = () => leaveMatch();
function updateMatchHud() {
  const M = S.match, b = matchBall(); if (!M) return;
  const setText = (sel, v) => { const el = $(sel); if (el.textContent !== String(v)) el.textContent = v; };
  setText('#scoreA', M.score.A || 0); setText('#scoreB', M.score.B || 0);
  $('#stamina').classList.toggle('hidden', !!M.practice);
  if (!M.practice) for (const t of ['A', 'B']) $('#stam' + t + ' i').style.width = (teamStamina(t) * 100).toFixed(1) + '%';
  $$('#touches i').forEach((el, i) => { const on = !!b && i < b.touches && b.active; if (el.classList.contains('on') !== on) el.classList.toggle('on', on); });
  setText('#bigMsg', M.msg || '');
  const sh = $('#serveHint'); let hint = '';
  if (!M.practice && M.state === 'serve' && M.serve) {
    const left = Math.ceil(serveLeft());
    if (M.serve.sid === SID) hint = P.serveAim !== null ? `YOUR SERVE (${left}s) - ${moveKeysLabel()} moves the toss, ${keyName(KEYS.toss)} tosses, then jump and spike` : `YOUR SERVE (${left}s) - ${keyName(KEYS.toss)} to aim your toss. Stay behind the line until you hit it!`;
    else { const p = M.players[M.serve.sid]; hint = `Waiting for ${p ? p.name : 'the other team'} to serve (${left}s)`; }
  }
  if (sh.textContent !== hint) sh.textContent = hint; if (sh.classList.contains('hidden') === !!hint) sh.classList.toggle('hidden', !hint);
  autoServe();
  if (isHost() && M.state === 'serve') { hostCheckServer(); hostServeClock(); }
}

/* =====================================================================
   BOTS: local casual matches against (and alongside) computer players
   ---------------------------------------------------------------------
   A bot match is a local match (no server): the ball, the scoring and the serve clock all run here. Each team runs
   one plan per frame:
     receive - the bot nearest the predicted landing runs there and passes high to the setter
     set     - the setter (2s: whoever did not receive; 3s+: a dedicated setter) jumps straight up and sets a hitter
     attack  - the hitter runs under the set, picks its hit the moment it jumps, and swings exactly like a player
     defend  - back to base; once the other side has two touches one bot fronts the attacker and blocks
               (2s: kill block or one-touch 50/50, 3s+: only the setter blocks and only one-touches)
   ===================================================================== */
const BOTS = [];
const BOT_NAMES = [['Bob', 'boy'], ['Greg', 'boy'], ['Emily', 'boy'], ['Dave', 'boy'], ['Sarah', 'boy'], ['Karen', 'boy'], ['Steve', 'boy'], ['Linda', 'boy'], ['Kevin', 'boy'], ['Jenny', 'boy'], ['Frank', 'boy'], ['Nancy', 'boy']];
const BOT_REACH_G = 1.85 * PS, BOT_REACH_A = 1.7 * PS;
let botLevel = 'easy';
const BOT_LEVELS = { easy: 40, medium: 50, hard: 50 }, BOT_BLOCK_MISS = { easy: 0.45, medium: 0.3, hard: 0.18 };
function botStats() {                              // easy: 40 everywhere, medium: 50 everywhere, hard: 100 spike, set and jump, 50 the rest
  const st = {}; for (const k of STAT_KEYS) st[k] = BOT_LEVELS[botLevel];
  if (botLevel === 'hard') for (const k of ['spike', 'set', 'jump']) st[k] = 100;
  return st;
}
const setHOf = bot => bot.jh * 0.8 + BOT_HIGH, hitHOf = bot => bot.jh * 0.92 + BOT_HIGH;
const myHitH = () => jumpV(stat('jump')) ** 2 / (2 * G) * 0.92 + 1.92 * PS + spikeReach(stat('spike'));
const BOT_HIGH = 2.0 * PS, BOT_LOW = 1.05 * PS;
function makeBot(id, name, model, team, idx, n) {
  const rig = new Rig2D(TEAM_VARIANT[team], 'boy', 1 + (idx + (team === 'B' ? 3 : 0)) % (HAIRS.length - 1)); rig.ready = true;   // same athlete, different hair so you can tell them apart
  const bot = { id, name, model, team, idx, n, rig, x: spawnX(team, idx, n), y: 0, vx: 0, vy: 0, onGround: true, f: -teamSide(team), target: null, role: 'player', plan: null, blockUntil: 0, blockTilt: -1, spike: null, lastHitT: -9, serveAt: 0, coin: 0, base: 0 };
  bot.st = botStats(); bot.jv = jumpV(bot.st.jump); bot.jh = bot.jv * bot.jv / (2 * G);
  bot.base = bot.x; rig.place(bot.x, 0, bot.f, true); rig.snap();
  remotes.set(id, { bot: true, rig, name, data: { team, name, f: bot.f, g: 1 }, x: bot.x, y: 0 });
  return bot;
}
function startBotMatch(size) {
  const map = size === 2 ? 'beach' : 'indoor';
  const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
  const teams = { A: { [SID]: { name: me.name } }, B: {} }; const players = {}; const spec = [];
  for (let i = 1; i < size; i++) { const id = 'bot_a' + i; const [nm, md] = names.pop(); teams.A[id] = { name: nm }; players[id] = { name: nm, team: 'A' }; spec.push([id, nm, md, 'A']); }
  for (let i = 0; i < size; i++) { const id = 'bot_b' + i; const [nm, md] = names.pop(); teams.B[id] = { name: nm }; players[id] = { name: nm, team: 'B' }; spec.push([id, nm, md, 'B']); }
  beginMatch({ id: 'bots', mode: size + 'v' + size, practice: false, bots: true, local: true, map, teams, players, score: { A: 0, B: 0 }, stamina: { A: 1, B: 1 }, state: 'serve', serve: { team: Math.random() < 0.5 ? 'A' : 'B', sid: null }, serveIdx: { A: -1, B: -1 }, msg: '', serveAt: snow() });
  for (const [id, nm, md, team] of spec) { const mates = Object.keys(teams[team]).sort(); BOTS.push(makeBot(id, nm, md, team, mates.indexOf(id), mates.length)); }
  if (size >= 3) for (const team of ['A', 'B']) { const first = BOTS.find(x => x.team === team); if (first) first.role = 'setter'; }
  const M = S.match; const t = M.serve.team; const members = Object.keys(M.teams[t]).sort(); M.serve.sid = members[0]; M.serveIdx[t] = 0;
  botsOnServe(); $('#modeTxt').textContent = M.mode.toUpperCase() + ' vs ' + botLevel.toUpperCase() + ' BOTS';
  toast('Bot match: ' + (size === 2 ? 'beach' : 'indoor') + ' court', 'ok');
}
function predictBall(b, opts = {}) {
  let x = b.x, y = b.y, vx = b.vx, vy = b.vy; const g = BALL_G * b.g; let t = 0; const h = 1 / 60; const wantH = opts.height; let atH = null;
  while (t < 7) { vy -= g * h; vx *= 1 - 0.015 * h; vy *= 1 - 0.015 * h; x += vx * h; y += vy * h; t += h; if (wantH !== undefined && atH === null && vy < 0 && y <= wantH) atH = { x, y, t }; if (y <= BALL_R) break; }
  return { land: { x, t }, atH };
}
function botStep(bot, dt) {
  const cd = courtDims(); const s = teamSide(bot.team);
  const spd = MOVE_SPEED * speedMult(bot.st.speed) * staminaSpeed(teamStamina(bot.team));
  if (bot.dive) {
    const e = (T - bot.dive.t0) / bot.dive.dur;
    if (e >= 1) { bot.dive = null; bot.rig.pitchTarget = 0; bot.rig.setPose('idle'); bot.rig.base = 'idle'; bot.vx = 0; }
    else bot.vx = bot.dive.dir * bot.dive.v0 * (1 - e * 0.6);
  } else if (bot.target !== null && bot.onGround) {
    const dx = bot.target - bot.x, d = Math.abs(dx); const top = bot.role === 'setter' || (bot.plan && bot.plan.startsWith('set')) ? spd * 1.3 : spd;
    bot.vx = d > 0.1 ? Math.sign(dx) * Math.min(top, d / dt) : 0;
  } else if (bot.onGround) bot.vx = 0;
  bot.vy -= G * dt; bot.x += bot.vx * dt; bot.y += bot.vy * dt;
  bot.x = s < 0 ? clamp(bot.x, -cd.wall + 1, -NET_GAP) : clamp(bot.x, NET_GAP, cd.wall - 1);
  if (bot.y <= 0) { if (!bot.onGround) { bot.rig.setPose('land', T + 0.16); bot.rig.impact(-0.17); bot.rig.base = 'idle'; landFx(bot.x, 0, groundDustColor()); } bot.y = 0; bot.vy = 0; bot.onGround = true; bot.blockUntil = 0; }
  bot.f = -s;                                                                  // bots always face the net
  const r = remotes.get(bot.id); if (r) { r.x = bot.x; r.y = bot.y; r.data.f = bot.f; }
  bot.rig.moveSpeed = bot.onGround && !bot.dive && bot.rig.anim === 'idle' ? Math.abs(bot.vx) : 0; bot.rig.place(bot.x, bot.y, bot.f, bot.onGround && !bot.dive); bot.rig.update(dt, T);
  if (MATCH_NET && Math.abs(bot.x) < NET_GAP + 0.3) MATCH_NET.touchBody(bot.x, bot.y, BODY_H, bot.x < 0 ? -1 : 1);
}
function botDive(bot, dir) {                       // the same dive a player has, at the bot's Dive level
  if (!bot.onGround || bot.dive) return;
  bot.dive = { t0: T, dur: 0.55, dir, v0: diveDist(bot.st.dive) / 0.385, hit: false }; const fwd = dir === bot.f;
  bot.rig.setPose(fwd ? 'dive' : 'diveB', T + 0.55); bot.rig.pitchTarget = fwd ? 1.3 : -0.95;
}
function botDigs() {                               // a diving bot scoops up the ball if it gets there: high and floaty toward its setter
  const b = matchBall(); if (!b || !b.active) return;
  for (const bot of BOTS) {
    const d = bot.dive; if (!d || d.hit || !botMayTouch(bot)) continue;
    if (Math.hypot(b.x - (bot.x + d.dir * 1.0 * PS), b.y - (bot.y + 0.6 * PS)) > 1.8 * PS) continue;
    d.hit = true; const team = bot.team;
    if (teamStamina(team) <= 0.001 && (b.sideTeam !== team || b.touches === 0)) { const sp = Math.hypot(b.vx, b.vy), k = 0.22 + Math.random() * 0.13, pitch = (30 + Math.random() * 25) * D; botHit(bot, 'dive', -teamSide(team) * -Math.cos(pitch) * sp * k, Math.sin(pitch) * sp * k + 3, 1); b.brk = true; showBallMsg('RECEIVE BREAK', b); continue; }
    payForPass(b, 'dive', team, bot.st.set); const v = launchTo(b.x, b.y, setterSpot(team), 0, Math.min(courtDims().ceil - 1, Math.max(11, b.y + 6)), BALL_G * 0.7); botHit(bot, 'dive', v.x, v.y, 0.7);
  }
}
function botJump(bot, straight = false) { if (!bot.onGround) return; if (straight) bot.vx = 0; bot.vy = bot.jv; bot.onGround = false; bot.rig.impact(0.14); bot.rig.base = 'air'; bot.rig.setPose('jumpUp', T + 0.18); jumpFx(bot.x, 0, groundDustColor()); }
function botHit(bot, type, vx, vy, g = 1) {
  const b = matchBall(); if (!b) return;
  b.vx = vx; b.vy = vy; b.g = g; b.seq++; b.t = snow(); b.held = null; b.active = true; b.frozen = false; b.pf = null; b.acc = 0; b.netSide = 0; b.pu = 0;
  b.nt = null; b.brk = false; b.prevHitter = b.hitter; b.prevType = b.hitType; b.hitter = bot.id; b.hitType = type; b.fx = 'none'; b.hm = bot.model; b.hitterX = bot.x; b.hitAtT = T;
  if (type === 'block') { b.touches = 0; b.sideTeam = bot.team; } else { if (b.sideTeam !== bot.team) { b.sideTeam = bot.team; b.touches = 1; } else b.touches++; }
  b.serve = false; b.spin = (Math.random() - 0.5) * 8 - vx * 1.5; b.landed = false; b.ds = false;
  if (type === 'spike') { spikeRing(b.x, b.y, vx, vy); sparkle(b.x, b.y, 14, '#ffffff', 1.3, 0.2, 0.3, 0.035, vx / 30, vy / 30); }
  b.path = type === 'set' ? computePath(b) : null; b.pathI = 0;
  if (type === 'bump') { bot.rig.setPose('bump', T + 0.45); setTimeout(() => actionFx('bump', bot.x, bot.y, bot.f), 60); }
  else if (type === 'set') { bot.rig.setPose('set', T + 0.45); if (!bot.onGround) bot.rig.base = 'airDown'; setTimeout(() => actionFx('set', bot.x, bot.y, bot.f), 80); }
  else if (type === 'spike' || type === 'tip') { bot.rig.setPose(type === 'tip' ? 'tip' : 'spikeHit', T + 0.4); bot.rig.base = 'airDown'; actionFx('spike', bot.x, bot.y, bot.f); }
  else if (type === 'block') { bot.rig.setPose('block', T + 0.3); actionFx('block', bot.x, bot.y, bot.f); }
  bot.lastHitT = T; bot.plan = null;
  hostCheckHit();
}
const botReach = (bot, high) => { const b = matchBall(); if (!b || !b.active || b.held || b.frozen) return false; const cx = bot.x + bot.f * 0.3 * PS, cy = bot.y + (high ? BOT_HIGH : BOT_LOW); return Math.hypot(b.x - cx, b.y - cy) < (high ? BOT_REACH_A : BOT_REACH_G); };
const botMayTouch = bot => { const b = matchBall(); return b && b.hitter !== bot.id && b.nt !== bot.team && T - bot.lastHitT > 0.35 && !(b.hitter && T - (b.hitAtT || -9) < 1 / 6 && teamOf(b.hitter) === bot.team); };
/* spots on the court (side view: distance from the net) */
const setterSpot = team => teamSide(team) * 1.9;
const attackSpots = team => { const s = teamSide(team); return { front: s * 4.0, middle: s * 2.9, back: s * 7.2 }; };
const humanOnTeam = team => P.team === team;
function spikeTarget(kind, team) {
  const cd = courtDims(); const ez = -teamSide(team); const hl = cd.half - 1.0;
  return { deep: ez * hl, deep2: ez * (hl - 1.2), middle: ez * hl * 0.55, sharp: ez * 2.2, line: ez * (hl - 2.5), tip: ez * 1.8 }[kind];
}
function botPickSpike(bot) {                      // decided the moment the hitter leaves the ground
  const kinds = ['deep', 'deep2', 'middle', 'sharp', 'line', 'tip']; const kind = kinds[Math.floor(Math.random() * kinds.length)];
  const tz = { deep: -0.7, deep2: -0.4, middle: 0, sharp: 0.55, line: -0.15, tip: 0 }[kind];
  bot.spike = { kind, tg: spikeTarget(kind, bot.team), tz, c: 0.5 + Math.random() * 0.5 };
}
function botSpike(bot) {
  const b = matchBall(); if (!bot.spike) botPickSpike(bot);
  const sp = bot.spike; bot.spike = null; const fwd = bot.f;
  if (sp.kind === 'tip') { const pitch = 32 * D, s = 7; botHit(bot, 'tip', fwd * Math.cos(pitch) * s, Math.sin(pitch) * s, 1); return; }
  const r = spikeSolve(b.x, b.y, fwd, sp.tz, sp.c, spikeMult(bot.st.spike));   // exactly the player's spike, at the bot's level
  botHit(bot, 'spike', r.vx, r.vy, r.g); if (r.lob) showBallMsg('TOO LOW', b);
}
function botsOnServe() {
  const M = S.match; if (!M || !M.bots) return;
  for (const bot of BOTS) { bot.plan = null; bot.target = bot.base; bot.x = bot.base; bot.vx = bot.vy = 0; bot.onGround = true; bot.y = 0; bot.rig.base = 'idle'; bot.rig.setPose('idle'); bot.coin = Math.random(); bot.blockUntil = 0; bot.spike = null; bot.dive = null; bot.jserve = null; bot.rig.pitchTarget = 0; }
  const s = M.serve && BOTS.find(x => x.id === M.serve.sid);
  if (s) { const cd = courtDims(); s.x = teamSide(s.team) * (cd.half + 1.6); s.target = null; s.serveAt = T + 1.6 + Math.random() * 0.8; }
}
function botServe(bot) {
  const b = matchBall(); const cd = courtDims(); const ez = -teamSide(bot.team);
  if (Math.random() < ({ easy: 0.35, medium: 0.6, hard: 0.85 })[botLevel]) {           // a jump serve: toss it to just over their reach, jump in time, spike it
    const gT = BALL_G * 0.7, hc = bot.jh + BOT_HIGH, apex = hc + 0.9;
    b.active = true; b.frozen = false; b.held = null; b.x = bot.x + bot.f * 0.3 * PS; b.y = 1.7 * PS; b.vx = 0; b.vy = Math.sqrt(2 * gT * (apex - b.y)); b.g = 0.7;
    b.hitter = null; b.hitType = 'toss'; b.prevHitter = null; b.prevType = null; b.touches = 0; b.sideTeam = bot.team; b.serve = true; b.tossedBy = bot.id; b.nt = bot.team; b.landed = false; b.seq++; b.t = snow(); b.acc = 0; b.path = null;
    bot.rig.setPose('toss', T + 0.45);
    bot.jserve = { jumpAt: T + b.vy / gT + Math.sqrt(2 * 0.9 / gT) - bot.jv / G, c: 0.6 + Math.random() * 0.4, tz: -0.5 + Math.random() * 0.8 };
    mwrite('state', 'rally'); return;
  }
  b.active = true; b.frozen = false; b.held = null; b.x = bot.x + bot.f * 0.5 * PS; b.y = bot.y + 1.1 * PS; b.hitter = null; b.hitType = null; b.prevHitter = null; b.touches = 0; b.sideTeam = bot.team; b.serve = false; b.tossedBy = null; b.landed = false; b.vx = b.vy = 0;
  const tg = ez * (cd.half / 2 + Math.random() * cd.half / 2 - 0.8);
  const v = launchTo(b.x, b.y, tg, 0, NET_H + 3); botHit(bot, 'bump', v.x, v.y, 1); b.nt = bot.team;
  mwrite('state', 'rally');
}
/* a bot pass: what it costs the team and how far off it lands when they are tired */
function botPass(bot, kind) { const b = matchBall(); const st = payForPass(b, kind, bot.team, bot.st.set); return scatterFor(st, bot.st.set); }
function planTeam(team, bots) {
  const M = S.match, b = matchBall(); if (!b) return;
  const cd = courtDims(); const s = teamSide(team); const human = humanOnTeam(team);
  const pred = predictBall(b); const incoming = Math.sign(pred.land.x) === s || (b.x * s > 0 && b.vx * s >= 0);
  const oursTouches = b.sideTeam === team ? b.touches : 0;
  const size = bots.length + (human ? 1 : 0);
  const setter = size >= 3 ? (bots.find(x => x.role === 'setter') || bots[0]) : null;
  const spots = attackSpots(team);
  if (!b.active || M.state !== 'rally') { for (const bot of bots) bot.target = bot.base; return; }
  if (b.serve || (b.nt === team && b.x * s > 0)) { for (const bot of bots) if (!bot.jserve) bot.target = bot.base; return; }   // our own serve in the air: hands off
  if (b.brk && b.sideTeam === team && oursTouches >= 1 && oursTouches < 3) {                              // a broken pass: the nearest bot chases it down, diving if it has to
    const land = pred.land.x; const cands = bots.filter(x => x.id !== b.hitter && !x.dive);
    const ch = cands.length ? cands.reduce((a, x) => Math.abs(x.x - land) < Math.abs(a.x - land) ? x : a, cands[0]) : null;
    for (const bot of bots) if (bot !== ch && !bot.dive) { bot.target = bot === setter ? setterSpot(team) : bot.base; bot.plan = 'wait'; }
    if (ch) {
      ch.target = land; ch.plan = 'chase';
      if (ch.onGround && pred.land.t < 0.7 && Math.abs(land - ch.x) > 1.2 * PS && Math.abs(land - ch.x) < diveDist(ch.st.dive) + 2) botDive(ch, Math.sign(land - ch.x));
      else if (ch.onGround && botReach(ch, false) && botMayTouch(ch)) { const sc = botPass(ch, 'bump'); const v = launchTo(b.x, b.y, setterSpot(team) + randn() * sc, 0, Math.max(10, b.y + 5), BALL_G * BUMP_G); botHit(ch, 'bump', v.x, v.y, BUMP_G); }
    }
    return;
  }
  if (incoming && oursTouches < 3) {
    if (oursTouches === 0) {                                                                            // RECEIVE
      if (T - (b.hitAtT || 0) < ({ easy: 0.2, medium: 0.14, hard: 0.08 })[botLevel] && b.hitType !== 'toss') return;
      const land = pred.land.x;
      let cands = bots.filter(x => (x !== setter || bots.length === 1)); const grounded = cands.filter(x => x.onGround && !x.dive); if (grounded.length) cands = grounded;   // a blocker still in the air is not the one who passes
      const recv = cands.reduce((a, x) => Math.abs(x.x - land) < Math.abs(a.x - land) ? x : a, cands[0]);
      for (const bot of bots) {
        if (bot === recv) { bot.target = land + s * 0.5; bot.plan = 'receive'; }
        else if (bot === setter || (!setter && bots.length > 1)) { bot.target = setterSpot(team); bot.plan = 'setter'; }
        else { bot.target = bot.base; bot.plan = 'wait'; }
      }
      if (recv && recv.readSeq !== b.seq) { recv.readSeq = b.seq; const sp = Math.hypot(b.vx, b.vy); recv.misread = b.hitType === 'spike' && Math.random() < clamp((sp - 20) / 45, 0, 0.35) * ({ easy: 1, medium: 0.55, hard: 0.25 })[botLevel]; }
      if (recv && recv.misread) recv.target = land - s * 1.6;
      if (recv && !recv.misread && recv.onGround && !recv.dive && botReach(recv, false) && botMayTouch(recv) && (b.vy < 1 || b.y < 1.6 * PS)) {   // touch 1: a high floaty pass to the setter spot
        if (teamStamina(team) <= 0.001) { const sp = Math.hypot(b.vx, b.vy), k = 0.22 + Math.random() * 0.13, pitch = (30 + Math.random() * 25) * D; botHit(recv, 'bump', s * Math.cos(pitch) * sp * k, Math.sin(pitch) * sp * k + 3, 1); b.brk = true; showBallMsg('RECEIVE BREAK', b); recv.plan = 'wait'; return; }   // 0% stamina: the pass breaks
        const sc = botPass(recv, 'bump');
        const v = launchTo(b.x, b.y, setterSpot(team) + randn() * sc, 0, Math.max(10, b.y + 5), BALL_G * BUMP_G);
        botHit(recv, 'bump', v.x, v.y, BUMP_G);
        recv.plan = 'toAttack'; recv.target = spots.front;
      }
    } else if (oursTouches === 1) {                                                                     // SET
      const st = setter || bots.find(x => x.id !== b.hitter);
      if (!st) { for (const bot of bots) { bot.plan = 'hitter'; bot.target = spots.front; } return; }
      const hitters = bots.filter(x => x !== st && x.id !== b.hitter);
      if (!st.plan || !st.plan.startsWith('set:')) {
        let pick = null;
        if (human && b.hitter !== SID && Math.abs(P.x) < cd.half && Math.random() < 0.55) pick = 'human';
        else if (hitters.length) pick = hitters[Math.floor(Math.random() * hitters.length)].id;
        else if (human) pick = 'human';
        st.plan = 'set:' + pick;
      }
      const pick = st.plan.slice(4);
      const order = ['front', 'middle', 'back']; let k = 0;
      for (const bot of bots) {
        if (bot === st) continue;
        if (bot.id === b.hitter && bots.length <= 2) { bot.target = spots.front; bot.plan = 'hitter'; continue; }
        if (k < 3) { bot.target = spots[order[k++]]; bot.plan = 'hitter'; } else { bot.target = bot.base; bot.plan = 'wait'; }
      }
      const setH = setHOf(st);
      const hi = predictBall(b, { height: setH }).atH;
      const at = hi || predictBall(b, { height: BOT_LOW * 2 }).atH; const under = at ? at.x : pred.land.x;
      if (st.onGround) st.target = under + s * 0.35;
      const tRise = st.jv / G * 0.75;
      const wantJump = hi && Math.abs(st.x - (under + s * 0.35)) < 0.7 && hi.t < tRise && b.y > setH - 0.5;
      if (wantJump && st.onGround) botJump(st, true);
      if (botMayTouch(st) && botReach(st, !st.onGround) && (!hi || !st.onGround || (b.vy < 0 && b.y < BOT_HIGH * 1.3))) {
        const tg = Math.random() < 0.5 ? b.x : s * (NET_GAP + 1.6);            // bots set straight up, or just off the net - the hitter runs under it
        const sc = botPass(st, 'set');
        const hb = pick === 'human' ? null : bots.find(x => x.id === pick); const aimH = pick === 'human' ? myHitH() : hitHOf(hb || st);   // as high as the hitter can reach - your Jump when it is your set
        const v = setAim(b.x, b.y, tg + randn() * sc, aimH + 2 + randn() * sc * 0.4, 1, st.st.set); botHit(st, 'set', v.vx, v.vy, v.g);
        st.plan = 'setter'; st.target = setterSpot(team);
      }
    } else {                                                                                            // ATTACK
      const cands = bots.filter(x => x.id !== b.hitter && x !== setter);
      const spikeAt = predictBall(b, { height: hitHOf(cands[0] || bots[0]) }).atH;
      const aim = spikeAt ? spikeAt.x : pred.land.x;
      const hitter = cands.length ? cands.reduce((a, x) => Math.abs(x.x - aim) < Math.abs(a.x - aim) ? x : a, cands[0]) : null;
      for (const bot of bots) if (bot !== hitter) { bot.target = bot === setter ? setterSpot(team) : bot.base; bot.plan = 'wait'; }
      if (hitter) {
        hitter.plan = 'attack'; hitter.target = aim + s * 0.6;
        if (hitter.onGround) hitter.spike = null;
        const tLeft = spikeAt ? spikeAt.t : pred.land.t;
        if (hitter.onGround && spikeAt && tLeft < hitter.jv / G * 0.95 && Math.abs(hitter.x - (aim + s * 0.6)) < 1.6) { botPickSpike(hitter); botJump(hitter); }
        if (!hitter.onGround && botReach(hitter, true) && botMayTouch(hitter) && b.vy < 2) botSpike(hitter);
        else if (hitter.onGround && !spikeAt && botReach(hitter, false) && botMayTouch(hitter) && b.y < 1.7 * PS) { const v = launchTo(b.x, b.y, -s * 5, 0, Math.max(NET_H + 2.5, b.y + 3), BALL_G * BUMP_G); botHit(hitter, 'bump', v.x, v.y, BUMP_G); }   // the set never got up: bump it over
      }
    }
  } else {
    /* they have the ball: defend */
    const theirs = b.sideTeam !== team ? b.touches : 0;
    let blocker = null;
    if (theirs >= 2 && b.x * s < 0) {
      const netP = predictBall(b, { height: NET_H }).atH; const aimX = netP ? netP.x : pred.land.x;
      const atk = []; if (!human && b.hitter !== SID) atk.push({ x: P.x, up: !P.onGround }); for (const x of BOTS) if (x.team !== team && x.id !== b.hitter) atk.push({ x: x.x, up: !x.onGround });
      const attacker = atk.length ? atk.reduce((a, x) => Math.abs(x.x - aimX) < Math.abs(a.x - aimX) ? x : a, atk[0]) : null;
      const cands = setter ? [setter] : bots.filter(x => !(human && x.coin < 0.5 && bots.length === 1));
      if (cands.length) blocker = cands[0];
      if (blocker) {
        blocker.plan = 'block'; blocker.target = s * (NET_GAP + 0.15);
        if (attacker && attacker.up && blocker.onGround && Math.abs(blocker.x) < 2.2) { blocker.blockTilt = (size <= 2 && Math.random() < 0.5) ? 1 : -1; blocker.blockMiss = Math.random() < BOT_BLOCK_MISS[botLevel]; botJump(blocker, true); blocker.blockUntil = T + 10; blocker.rig.base = 'block'; blocker.rig.setPose('block'); }
      }
    }
    for (const bot of bots) {
      if (bot === blocker) continue;
      if (bot.plan === 'block' && bot.onGround) bot.plan = 'wait';
      const land = pred.land.x;
      if (Math.sign(land) === s && !incoming) { bot.target = land + s * 0.5; bot.plan = 'dig'; }
      else { bot.target = bot === setter ? setterSpot(team) : bot.base; bot.plan = 'wait'; }
    }
  }
}
function botBlockContacts() {
  const b = matchBall(); if (!b || !b.active) return;
  for (const bot of BOTS) {
    const s = teamSide(bot.team);
    if (bot.onGround || T >= bot.blockUntil || bot.blockMiss || b.hitter === bot.id || b.vx * s <= 0 || b.x * s > 0.9 || b.x * s < -1.3) continue;
    const top = bot.y + 2.6 * PS; if (b.y < bot.y - BALL_R || b.y > top + BALL_R) continue; const t = clamp((b.y - bot.y) / (top - bot.y), 0, 1); if (Math.abs(b.x - (bot.x + bot.f * 0.3 * PS * t)) > 0.7 * PS + BALL_R) continue;   // feet to hands, like a player's block
    const r = blockTouch(b, bot.x, bot.y, bot.f, -s, (bot.blockTilt || -1) * 0.3, bot.st.block);   // the same block a player makes
    botHit(bot, 'block', r.vx, r.vy, r.g); if (r.kind) showBallMsg(r.kind, b);
  }
}
function updateBots(dt) {
  const M = S.match; if (!M || !M.bots || !BOTS.length) return;
  if (M.state === 'serve') {
    const s = M.serve && BOTS.find(x => x.id === M.serve.sid);
    if (s && s.serveAt && T >= s.serveAt) { s.serveAt = 0; botServe(s); }
    for (const bot of BOTS) if (bot !== s) bot.target = bot.base;
  } else if (M.state === 'rally') {
    const js = BOTS.find(x => x.jserve), b = matchBall();
    if (js) {
      if (!b.serve || b.landed) js.jserve = null;
      else { if (js.onGround && T >= js.jserve.jumpAt) botJump(js, true); if (!js.onGround && botReach(js, true) && b.vy < 1) { const v = serveSolve(b.x, b.y, js.f, js.jserve.c, js.jserve.tz, spikeMult(js.st.spike)); botHit(js, 'spike', v.vx, v.vy, v.g); b.nt = js.team; js.jserve = null; } }
    }
    botBlockContacts(); botDigs(); for (const team of ['A', 'B']) planTeam(team, BOTS.filter(x => x.team === team)); }
  else for (const bot of BOTS) { bot.target = bot.base; bot.plan = null; }
  for (const bot of BOTS) botStep(bot, dt);
}

/* =====================================================================
   RENDER
   ===================================================================== */
function drawTag(x, y, text, color = '#fff', size = 13) {
  C.font = `900 ${size}px Montserrat, Arial`; C.textAlign = 'center'; C.textBaseline = 'bottom';
  C.lineWidth = 4; C.strokeStyle = 'rgba(10,14,34,.75)'; C.lineJoin = 'round'; C.strokeText(text, x, y); C.fillStyle = color; C.fillText(text, x, y);
}
function wrapText(text, maxW) { const words = String(text).split(' '); const lines = []; let cur = ''; for (const w of words) { const t = cur ? cur + ' ' + w : w; if (C.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines.slice(0, 4); }
function drawBubbles(sid, sx, sy) {
  const items = BUBBLES.get(sid); if (!items) return sy; const now = performance.now();
  while (items.length && items[0].until < now) items.shift(); if (!items.length) { BUBBLES.delete(sid); return sy; }
  C.font = '800 12px Montserrat, Arial'; C.textAlign = 'center'; C.textBaseline = 'middle';
  let y = sy;
  for (let i = items.length - 1; i >= 0; i--) {
    const lines = wrapText(items[i].text, 200); const w = Math.min(220, Math.max(...lines.map(l => C.measureText(l).width)) + 18), h = lines.length * 15 + 10;
    const fade = Math.min(1, (items[i].until - now) / 400); C.globalAlpha = fade;
    y -= h + 6; rrScreen(sx - w / 2, y, w, h, 8, 'rgba(255,255,255,.96)');
    if (i === items.length - 1) { C.beginPath(); C.moveTo(sx - 6, y + h); C.lineTo(sx + 6, y + h); C.lineTo(sx, y + h + 6); C.fillStyle = 'rgba(255,255,255,.96)'; C.fill(); }
    C.fillStyle = '#111'; lines.forEach((l, k) => C.fillText(l, sx, y + 12 + k * 15));
  }
  C.globalAlpha = 1; return y;
}
function rrScreen(x, y, w, h, r, fill) { C.beginPath(); C.moveTo(x + r, y); C.arcTo(x + w, y, x + w, y + h, r); C.arcTo(x + w, y + h, x, y + h, r); C.arcTo(x, y + h, x, y, r); C.arcTo(x, y, x + w, y, r); C.closePath(); C.fillStyle = fill; C.fill(); }
function render(dt) {
  C = ctx; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const M = S.match; const cd = M ? courtDims() : null;
  if (!M) { drawMenuScene(T, dt); drawParts(); drawFx('mid'); screenTf(); const tint = PAL.tint; if (tint[3] > 0.005) { C.fillStyle = `rgba(${tint[0] | 0},${tint[1] | 0},${tint[2] | 0},${tint[3].toFixed(3)})`; C.fillRect(0, 0, VW, VH); } return; }
  if (M.map === 'beach') drawBeachCourt(T, cd); else drawGym(T, cd);
  worldTf();
  drawFx('back');
  for (const n of netsFor()) if (onScreen(n.x - 1, n.x + 1)) n.draw(T);
  for (const r of remotes.values()) if (onScreen(r.x - 2, r.x + 2)) r.rig.draw();
  P.rig.draw();
  for (const b of balls.values()) {                // the dotted path of the last set, from where the ball is now
    if (!b.active || !b.path || b.held) continue; const p = b.path; if (b.landed) { b.path = null; continue; }
    while (b.pathI < p.length - 1 && Math.hypot(p[b.pathI + 1][0] - b.x, p[b.pathI + 1][1] - b.y) < Math.hypot(p[b.pathI][0] - b.x, p[b.pathI][1] - b.y)) b.pathI++;
    C.save(); C.setLineDash([0.25, 0.3]); C.lineCap = 'round'; C.beginPath(); C.moveTo(b.x, b.y); for (let i = b.pathI + 1; i < p.length; i++) C.lineTo(p[i][0], p[i][1]);
    C.strokeStyle = 'rgba(255,255,255,.85)'; C.lineWidth = 0.09; C.stroke(); C.setLineDash([]); const e = p[p.length - 1]; ellipse(e[0], 0.03, 0.5, 0.12, 0, null, 'rgba(255,255,255,.8)', 0.06); C.restore();
  }
  for (const b of balls.values()) { if (b.scene !== S.scene || !b.active) continue; const x = b.x + b.visX, y = b.y + b.visY; if (!onScreen(x - 1, x + 1)) continue; ellipse(x, ballFloor(b) + 0.02, 0.32 * clamp(1 - (y - ballFloor(b)) * 0.05, 0.3, 1), 0.07, 0, `rgba(0,0,0,${clamp(0.3 - y * 0.02, 0.06, 0.3)})`); drawBallSkin(x, y, b.skin, b.rot, T, BALL_R, !b.held && b.hitter === SID && b.hitType !== 'toss'); }
  drawMarks(dt); drawParts(); drawFx('mid');
  // ---- screen space ----
  screenTf();
  const outside = M.map === 'beach';
  const tint = PAL.tint; if (tint[3] > 0.005) { C.fillStyle = `rgba(${tint[0] | 0},${tint[1] | 0},${tint[2] | 0},${(tint[3] * (outside ? 1 : 0.45)).toFixed(3)})`; C.fillRect(0, 0, VW, VH); }
  if (skyFlash > 0) { C.fillStyle = `rgba(235,240,255,${skyFlash * 0.55})`; C.fillRect(0, 0, VW, VH); skyFlash = Math.max(0, skyFlash - dt * 3); }
  // name tags + bubbles
  for (const [sid, r] of remotes) {
    if (!onScreen(r.x - 2, r.x + 2)) continue;
    const sx = toSX(r.x), sy = toSY(r.rig.headTop()); const party = S.party && S.party.members && S.party.members[sid];
    const col = party ? '#5dffa0' : M && r.data && r.data.team && r.data.team !== 'L' ? (r.data.team === P.team ? '#9fd4ff' : '#ffb3b3') : '#ffffff';
    drawTag(sx, sy, r.name || '?', col);
    let top = sy - 16;
    if (hasTrait('b4p2') && Math.abs(r.x - P.x) < 22) { const team = r.data && r.data.team; C.fillStyle = M && team && team !== 'L' ? (team === P.team ? '#3b8ff0' : '#e5484d') : `hsl(${(r.hue = r.hue == null ? ([...(r.name || sid)].reduce((a, c) => a + c.charCodeAt(0), 0) * 37) % 360 : r.hue)},85%,55%)`; C.fillRect(sx - 7, top - 16, 14, 14); C.strokeStyle = '#fff'; C.lineWidth = 2; C.strokeRect(sx - 7, top - 16, 14, 14); top -= 20; }   // Setter Vision
    drawBubbles(sid, sx, top);
  }
  drawBubbles(SID, toSX(P.x), toSY(P.rig.headTop()) - 4);
  // charge bar
  if (P.charging) { const sup = hasAbility('supercharge'); const H = sup ? 150 : 110, full = 110; const sx = toSX(P.x) + 50 * (P.f > 0 ? -1 : 1) - 6, sy = toSY(P.y + 1.4 * PS) - H / 2; C.fillStyle = '#ffffff'; C.fillRect(sx - 2, sy - 2, 16, H + 4); C.fillStyle = 'rgba(0,0,0,.65)'; C.fillRect(sx, sy, 12, H); const c = P.charge; const h1 = full * Math.min(1, c); C.fillStyle = '#ffd23f'; C.fillRect(sx, sy + H - h1, 12, h1); if (sup) { C.fillStyle = 'rgba(178,92,255,.35)'; C.fillRect(sx, sy, 12, H - full); if (c > 1) { const h2 = (H - full) * (c - 1) / 0.5; C.fillStyle = '#b25cff'; C.fillRect(sx, sy + H - full - h2, 12, h2); } } C.fillStyle = 'rgba(255,255,255,.8)'; C.fillRect(sx, sy + H - full * 0.35, 12, 2); }
  // serve aim
  if (P.holding && P.serveAim !== null) { const sx = toSX(P.x + P.f * 0.3), sy = toSY(P.y) + 16; C.fillStyle = 'rgba(255,255,255,.9)'; for (const d of [-1, 1]) { C.beginPath(); C.moveTo(sx + d * 58, sy); C.lineTo(sx + d * 40, sy - 10); C.lineTo(sx + d * 40, sy + 10); C.closePath(); C.fill(); } C.fillRect(sx - 40, sy - 3, 80, 6); C.beginPath(); C.arc(sx + P.f * P.serveAim * 44, sy, 9, 0, TAU); C.fillStyle = '#e5484d'; C.fill(); C.strokeStyle = '#000'; C.lineWidth = 2; C.stroke(); }
  // set aim: the peak your set would reach from here (dotted arc), capped at 2.5 nets
  if (!uiOpen() && !P.holding && M) { const m = worldMouse(); const top = Math.min(setTopFor(stat('set')), ceilY() - 0.6); const cy = Math.min(m.y, top); const sx = toSX(m.x), sy = toSY(cy); if (m.y > top) { C.setLineDash([4, 5]); C.strokeStyle = 'rgba(255,255,255,.35)'; C.lineWidth = 1.5; C.beginPath(); C.moveTo(sx, toSY(m.y)); C.lineTo(sx, sy); C.stroke(); C.setLineDash([]); } C.beginPath(); C.arc(sx, sy, 5, 0, TAU); C.strokeStyle = 'rgba(255,255,255,.55)'; C.lineWidth = 2; C.stroke(); }
  // TOO LOW
  if (ballMsg) { if (performance.now() > ballMsg.until) ballMsg = null; else { const bx = ballMsg.b && ballMsg.b.active ? ballMsg.b.x : ballMsg.x, by = ballMsg.b && ballMsg.b.active ? ballMsg.b.y : ballMsg.y; const sx = toSX(bx), sy = toSY(by + 0.8); C.font = '900 13px Montserrat, Arial'; const w = C.measureText(ballMsg.text).width + 16; rrScreen(sx - w / 2, sy - 22, w, 22, 5, '#e5484d'); C.fillStyle = '#fff'; C.textAlign = 'center'; C.textBaseline = 'middle'; C.fillText(ballMsg.text, sx, sy - 11); } }
  // balls above the view: a marker on the top edge
  for (const b of balls.values()) { if (b.scene !== S.scene || !b.active) continue; const sy = toSY(b.y); if (sy > 4) continue; const sx = clamp(toSX(b.x), 16, VW - 16); C.beginPath(); C.moveTo(sx, 6); C.lineTo(sx - 9, 20); C.lineTo(sx + 9, 20); C.closePath(); C.fillStyle = b.hitter === SID ? '#ff5a5a' : '#ffd23f'; C.fill(); drawTag(sx, 38, Math.round(b.y) + 'm', '#fff', 11); }
}

/* =====================================================================
   MAIN LOOP (fixed timestep, keeps simulating while the tab is hidden)
   ===================================================================== */
const FIXED = 1 / 60;
let last = performance.now(), acc = 0;
function simulate(dt) {
  T += dt;
  if (!inMatch()) return;
  updatePlayer(dt); P.rig.update(dt, T);
  updateBots(dt);
  updateBalls(dt); updateRemotes(dt);
  for (const n of netsFor()) n.step(dt, T, S.match.map === 'beach' ? WIND.x : 0);
  if (S.match.map === 'beach') updateWind();
}
let lastFrameAt = 0;
function tick(nowMs, headless = false) {
  let dt = (nowMs - last) / 1000; last = nowMs;
  if (!S.booted) return;
  if (headless || document.hidden) {
    acc += Math.min(dt, 6); let n = 0; while (acc >= FIXED && n < 400) { simulate(FIXED); acc -= FIXED; n++; }
    updateFx(Math.min(dt, 0.1)); if (S.scene === 'match') updateMatchHud(); syncSelf();
    return;
  }
  lastFrameAt = nowMs;
  acc = 0; let rem = Math.min(dt, 0.1); while (rem > 0.0001) { const h = Math.min(rem, 1 / 60); simulate(h); rem -= h; }
  const fdt = Math.max(1e-4, Math.min(dt, 0.1));
  if (inMatch()) updateCamera(fdt); updateFx(Math.min(dt, 0.05)); updateCards();
  render(fdt);
  if (S.scene === 'match') updateMatchHud();
  syncSelf();
}
function frame(nowMs) { requestAnimationFrame(frame); if (!document.hidden) tick(nowMs); }
try {                                            // hidden tab: a worker drives the ticks so the match keeps running until the tab is closed
  const wk = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50);'], { type: 'text/javascript' })));
  wk.onmessage = () => { const now = performance.now(); if (document.hidden || now - lastFrameAt > 120) tick(now, true); else if (S.booted) syncSelf(); };
} catch (e) { setInterval(() => { const now = performance.now(); if (document.hidden || now - lastFrameAt > 120) tick(now, true); }, 100); }
document.addEventListener('visibilitychange', () => { last = performance.now(); lastFrameAt = performance.now(); });
async function cleanupStale() {
  try {
    const t = snow();
    const ms = (await db.ref('matches').once('value')).val() || {};
    for (const id in ms) { const m = ms[id]; if (!m.players && t - (m.created || 0) > 120000) db.ref('matches/' + id).remove(); }
    const pres = (await db.ref('presence').once('value')).val() || {};
    const lb = (await db.ref('lobbyBalls').once('value')).val() || {};
    for (const id in lb) if (!pres[id]) db.ref('lobbyBalls/' + id).remove();
    const qs = (await db.ref('queue').once('value')).val() || {};
    for (const mode in qs) for (const id in qs[mode]) { const q = qs[mode][id]; if (t - (q.t || 0) > 900000) db.ref(`queue/${mode}/${id}`).remove(); }
  } catch (e) { }
}
function applyQuality(q) {                       // high: crisp pixels; medium: 1x pixels; low: fewer particles, lower resolution; ultra: no effects, still scenery, classic balls
  GFX = q; ULTRA = q === 'ultra';
  if (ULTRA) { FX_LIST.length = 0; PARTS.length = 0; }
  PIX_CAP = q === 'high' ? 1.5 : q === 'medium' ? 1 : q === 'low' ? 0.8 : 0.7; resize();
}
const setLoad = async (pct, msg) => { $('#loadMsg').textContent = msg; $('#loadBar i').style.width = pct + '%'; $('#loadPct').textContent = pct + '%'; await new Promise(r => { let done = false; const fin = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(fin); setTimeout(fin, 60); }); };
async function boot(online) {
  if (S.booted) return; S.online = online;
  await setLoad(10, 'Painting the beach...'); updateDayNight();
  await setLoad(30, 'Drawing icons...'); renderIcons();
  { let q = 'high'; try { q = localStorage.getItem('vg_gfx') || 'high'; } catch (e) { } applyQuality(q); $('#gfxSel').value = q; $('#gfxSel').onchange = () => { applyQuality($('#gfxSel').value); try { localStorage.setItem('vg_gfx', $('#gfxSel').value); } catch (e) { } }; }
  $('#todSel').value = TOD; $('#todSel').onchange = () => { TOD = $('#todSel').value; try { localStorage.setItem('vg_tod', TOD); } catch (e) { } updateDayNight(); };
  setMyRig('white');
  if (online) { await setLoad(60, 'Signing in...'); const ok = await resumeSession(); if (!ok) await becomeGuest(); else onIdentityChanged(); await setLoad(85, 'Warming up...'); writePresence(); }
  else { me.name = 'Guest 1'; applyIdentityUI(); toast('Offline: could not reach the server. Practice and bot matches still work.', 'err', 6000); }
  $('#onlineDot').classList.toggle('on', online);
  if (online) { cleanupStale(); pruneChat(); subscribeChat(); db.ref('invites/' + SID).onDisconnect().remove(); }
  await setLoad(100, 'Ready!');
  S.booted = true; last = performance.now(); $('#loading').classList.add('hidden'); renderKeys(); applyTouch(touchWanted()); drawAvatar(); document.body.classList.add('inMenu'); openMenu('play');
  toast(`Welcome, ${me.name}!`, 'ok', 3000);
}
let bootTimer = setTimeout(() => boot(false), 8000);
db.ref('.info/connected').on('value', s => {
  const v = !!s.val();
  if (v && !S.booted) { clearTimeout(bootTimer); boot(true); }
  else if (S.booted) { S.online = v; $('#onlineDot').classList.toggle('on', v); if (v) writePresence(); }
});
requestAnimationFrame(frame);
</script>
</body>
</html>
