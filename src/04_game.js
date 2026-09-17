/* =====================================================================
   GAMEPLAY: input, player, balls, networking, match, loop
   ===================================================================== */
const V3 = THREE.Vector3;
const G = 14;
const MOVE_SPEED = 6.5, JUMP_V = 9.03, GROUND_CD = 0.7, DIVE_CD = 0.3, GLIDE_SPEED = 4.5;   // dive recovery halved
const REACH_G = 1.9, REACH_A = 1.8;
const TEAM_VARIANT = { A: 'black', B: 'white', L: 'white' };

/* ---------------- Player ---------------- */
const P = {
  pos: new V3(0, 0, 7), vel: new V3(), ry: Math.PI, onGround: true,
  tilt: new THREE.Vector2(), tiltIn: new THREE.Vector2(), airUsed: false, cd: 0,
  moveDir: new V3(0, 0, -1), moving: false, charging: false, chargeStart: 0, charge: 0,
  holding: false, serveMode: false, serveAim: null, act: null, dive: null, emote: null, blockUntil: 0, blockHit: false, team: 'A', rig: null, jumpFwd: new V3(0, 0, -1)
};
let camYaw = Math.PI, camPitch = 0.3, camDist = 6.0, shiftLock = false, rightDrag = false;
const cf = () => new V3(Math.sin(P.ry), 0, Math.cos(P.ry));
const cr = () => new V3(-Math.cos(P.ry), 0, Math.sin(P.ry));
const camF = () => new V3(Math.sin(camYaw), 0, Math.cos(camYaw));
const camR = () => new V3(-Math.cos(camYaw), 0, Math.sin(camYaw));
let T = 0;

/* ---------------- Balls ----------------
   balls: id -> ball. Match ball id = 'match'; beach balls are keyed by the spawner's sid and anyone can hit them.
   B = the ball the local player is currently engaged with (holding / last reached). */
const balls = new Map();
let B = null;
function makeBall(id, sceneName, skin = 'default') {
  const bm = makeBallMesh(skin); scene.add(bm.mesh); scene.add(bm.shadow);
  const b = { id, scene: sceneName, active: false, held: null, frozen: false, pos: new V3(), vel: new V3(), g: 1, seq: 0, t: 0, hitter: null, hitType: null, prevHitter: null, prevType: null, touches: 0, sideTeam: 'A', spin: new V3(), landed: false, serve: false, tossedBy: null, skin, fx: 'none', hitterPos: null, mesh: bm.mesh, shadow: bm.shadow };
  b.mesh.visible = b.shadow.visible = false; balls.set(id, b); return b;
}
function removeBall(id) { const b = balls.get(id); if (!b) return; scene.remove(b.mesh); scene.remove(b.shadow); balls.delete(id); if (B === b) B = null; }
function acrossNet(a, b) {                       // true if the segment a->b passes through a net
  for (const n of netsFor()) {
    const da = (a.x - n.cx) * n.nx + (a.z - n.cz) * n.nz, db = (b.x - n.cx) * n.nx + (b.z - n.cz) * n.nz;
    if (Math.sign(da) === Math.sign(db) || da === 0) continue;
    const f = da / (da - db); const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
    const lat = -(x - n.cx) * n.nz + (z - n.cz) * n.nx;
    if (Math.abs(lat) < n.half + 0.3) return true;
  }
  return false;
}
function ballReach(center, r, vScale = 1, allowAcross = false) {   // nearest reachable ball in this scene becomes B (vScale squashes the reach vertically)
  let best = null, bd = r;
  for (const b of balls.values()) {
    if (b.scene !== S.scene || !b.active || b.held || b.frozen) continue;
    if (S.match && !S.match.practice && b.hitter === SID && b.hitType !== 'block' && b.hitType !== 'toss') continue;   // one touch each: wait for someone else to play it (a block does not count as your touch)
    if (b.serve && b.tossedBy && b.tossedBy !== SID) continue;                                              // a serve toss can only be hit by the player who tossed it
    const dx = b.pos.x - center.x, dy = (b.pos.y - center.y) / vScale, dz = b.pos.z - center.z; const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > bd) continue;
    if (!allowAcross && acrossNet(P.pos, b.pos)) continue;                   // can't play a ball that's on the other side of the net
    bd = d; best = b;
  }
  if (best) B = best; return !!best;
}

/* ---------------- Input ---------------- */
const keys = new Set();
const isTyping = () => ['INPUT', 'TEXTAREA'].includes((document.activeElement || {}).tagName);
document.addEventListener('keydown', e => {
  if (rebinding) { e.preventDefault(); setBind(e.code); return; }
  if (isTyping()) return;
  if (e.code === 'Escape' || e.code === KEYS.menu) {                       // Escape closes no matter what it is bound to
    if (uiOpen()) { if (S.padId === null) closePanels(); }
    else if (e.code !== 'Escape') { e.preventDefault(); openPanel('#settingsPanel'); }   // Escape itself only closes: it is also how the browser frees the cursor
    return;
  }
  if (e.code === KEYS.chat && !uiOpen()) { e.preventDefault(); $('#chatInput').focus(); return; }
  if (BOUND.has(e.code) || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();   // whatever is bound must not also drive the browser
  if (e.repeat || uiOpen()) return;
  if (e.code === KEYS.shiftLock) { toggleShiftLock(); }
  if (!keys.has(e.code)) { keys.add(e.code); onPress(e.code); }
});
document.addEventListener('keyup', e => { keys.delete(e.code); if (!uiOpen()) onRelease(e.code); });
addEventListener('blur', () => { keys.clear(); rightDrag = false; });
document.addEventListener('contextmenu', e => e.preventDefault());   // never show the browser's right-click menu
canvas.addEventListener('mousedown', e => {
  const code = 'Mouse' + e.button;
  if (rebinding) { setBind(code); return; }
  if (uiOpen()) return;
  if (shiftLock && !document.pointerLockElement) { canvas.requestPointerLock(); return; }
  if (!shiftLock && e.button === 2) { rightDrag = true; canvas.requestPointerLock(); }   // hold right click: cursor locks in place while you look around
  if (!keys.has(code)) { keys.add(code); onPress(code); }
});
document.addEventListener('mouseup', e => { const code = 'Mouse' + e.button; if (e.button === 2) { rightDrag = false; if (!shiftLock && document.pointerLockElement) document.exitPointerLock(); } if (keys.has(code)) { keys.delete(code); onRelease(code); } });
document.addEventListener('mousedown', e => { if (rebinding && e.target !== canvas && !e.target.classList.contains('key')) { setBind('Mouse' + e.button); e.preventDefault(); } });
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas && !rightDrag) return;
  camYaw -= e.movementX * 0.0024; camPitch = clamp(camPitch + e.movementY * 0.0024, -0.35, 1.25);
});
function toggleShiftLock() {
  shiftLock = !shiftLock;
  if (shiftLock) { if (!uiOpen() && !TOUCH.on) canvas.requestPointerLock(); } else if (document.pointerLockElement && !rightDrag) document.exitPointerLock();   // a held right click keeps looking after shift lock comes off; on touch there is no cursor to lock
  updateLockHint();
}
$('#lockHint').onclick = () => canvas.requestPointerLock();
document.addEventListener('pointerlockchange', updateLockHint);
function updateLockHint() {
  const locked = document.pointerLockElement === canvas;
  $('#lockHint').classList.add('hidden');
  $('#crosshair').classList.toggle('hidden', !(shiftLock && locked));
}

/* ---------------- Actions ---------------- */
function onPress(code) {
  if (code === KEYS.emote) { toggleWheel(); return; }
  if (P.emote) stopEmote();
  if (code === KEYS.interact && P.onGround && nearNPC()) { openShop(); return; }
  if (code === KEYS.interact && P.onGround && nearNPC2()) { openTraitShop(); return; }
  if (code === KEYS.interact && P.onGround && nearNPC3()) { openShop('woman'); return; }
  if (code === KEYS.jump) tryJump();
  if (code === KEYS.ability) { tryDash(); return; }
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
    if (P.doubleSpike) { if (code === KEYS.spike) startSpike(); return; }   // Double Spike: the second action is a spike, nothing else
    if (code === KEYS.block) doBlock();
    else if (code === KEYS.jumpSet) doJumpSet();
    else if (code === KEYS.spike) startSpike();
  }
}
function onRelease(code) { if (P.charging && code === KEYS.spike) releaseSpike(); }

function tryJump() {
  if (!P.onGround || P.dive || T < (P.landLock || 0)) return;
  P.vel.y = JUMP_V * (hasTrait('b3p2') ? Math.sqrt(1.32) : 1); P.onGround = false; P.airUsed = false; P.doubleSpike = false; P.dsUsed = false; P.glide = null; P.tilt.set(0, 0); P.tiltIn.set(0, 0);   // Power Jump: 20% more height under 10% more gravity
  jumpFx(P.pos.x, P.pos.z, groundDustColor());
  P.jumpFwd = cf(); P.rig.base = P.holding ? 'hold' : 'air';
  P.rig.impact(0.16); camKick(0.05, 2.0);                                   // stretch off the floor + a small lens kick
  P.rig.setPose(P.holding ? 'hold' : 'jumpUp', P.holding ? 0 : T + 0.18);   // take-off extension, then settle into the spike-ready air pose
}
const chestPos = () => P.pos.clone().add(new V3(0, 1.07, 0)).addScaledVector(cf(), 0.35);
const highPos = () => P.pos.clone().add(new V3(0, 1.92, 0)).addScaledVector(cf(), 0.3);
function launchTo(from, target, apexY, g = BALL_G) {
  const apex = Math.max(apexY, from.y + 0.4, target.y + 0.4);
  const vy = Math.sqrt(2 * g * (apex - from.y)); const tUp = vy / g; const tDown = Math.sqrt(2 * Math.max(0.01, apex - target.y) / g); const Tt = tUp + tDown;
  return new V3((target.x - from.x) / Tt, vy, (target.z - from.z) / Tt);
}
function netDir() { if (S.match && !S.match.practice) return new V3(0, 0, P.team === 'A' ? 1 : -1); return cf(); }
function tiltWorld() { return cr().multiplyScalar(P.tilt.x).add(cf().multiplyScalar(P.tilt.y)); }
function withLateral(dir, tx, deg = 30) { const a = tx * deg * D; const r = new V3(-dir.z, 0, dir.x); return dir.clone().multiplyScalar(Math.cos(a)).add(r.multiplyScalar(Math.sin(a))).normalize(); }
function inputAxes(ui) {                     // keyboard + joystick, each clamped to a unit square
  if (ui) return { ix: 0, iz: 0 };
  const ix = clamp((keys.has(KEYS.moveR) ? 1 : 0) - (keys.has(KEYS.moveL) ? 1 : 0) + TOUCH.x, -1, 1);
  const iz = clamp((keys.has(KEYS.moveF) ? 1 : 0) - (keys.has(KEYS.moveB) ? 1 : 0) + TOUCH.y, -1, 1);
  return { ix, iz };
}
function groundTilt() {                      // WASD while on the ground, relative to the character (W = forward)
  const ui = uiOpen();
  const { ix, iz } = inputAxes(ui);
  const w = camR().multiplyScalar(ix).add(camF().multiplyScalar(iz)); const t = new THREE.Vector2(w.dot(cr()), w.dot(cf()));
  if (t.length() > 1) t.normalize(); return t;
}

const ACT_WINDOW = 0.3, BUMP_POWER = 1.25;         // bumps launch 25% harder than the aimed arc (so they carry further and higher)                      // bump / set / jump set stay armed this long, so the ball can arrive a bit late
function doBump() { P.rig.setPose('bump', T + 0.45); P.cd = GROUND_CD; P.act = { type: 'bump', until: T + ACT_WINDOW }; setTimeout(() => actionFx('bump', P.rig, cf()), 60); tryAct(); }
function doGroundSet() { P.rig.setPose('set', T + 0.45); P.cd = GROUND_CD; P.act = { type: 'set', until: T + ACT_WINDOW }; setTimeout(() => actionFx('set', P.rig, cf()), 80); tryAct(); }
function doJumpSet() { P.airUsed = true; P.airActed = true; P.rig.base = 'airDown'; P.rig.setPose('set', T + 0.45); P.act = { type: 'jset', until: T + ACT_WINDOW }; setTimeout(() => actionFx('set', P.rig, cf()), 80); tryAct(); }
function tryAct() {
  const a = P.act; if (!a) return;
  if (T > a.until) {
    P.act = null;
    if ((a.type === 'spike' || a.type === 'tip') && !P.onGround && !P.doubleSpike && !P.dsUsed && hasTrait('b2a')) {   // Double Spike: a whiffed swing arms one more, full-power lightning spike this jump
      P.doubleSpike = true; P.dsUsed = true; P.airUsed = false; P.rig.base = 'air'; P.rig.setPose('air');                       // no popup: the blue charge bar is the only tell
    }
    return;
  }
  if (a.type === 'bump') {
    if (!ballReach(chestPos(), REACH_G)) return; P.act = null;
    const gt = groundTilt();                                   // forward = stronger, back = softer bump
    const dist = 7.5 + 5.0 * gt.y; const dir = withLateral(cf(), gt.x, 25);
    const tg = P.pos.clone().addScaledVector(dir, dist); tg.y = 0;
    hitBall('bump', launchTo(B.pos, tg, Math.max(5.8 - Math.max(0, gt.y) * 1.0, B.pos.y + 2)).multiplyScalar(BUMP_POWER), 1);   // higher bump; forward tilt = flatter and faster; BUMP_POWER scales the whole launch
  } else if (a.type === 'set') {
    if (!ballReach(chestPos().add(new V3(0, 0.5, 0)), REACH_G + 0.2)) return; P.act = null;
    const dir = P.moving ? P.moveDir.clone() : cf().multiplyScalar(0.12);
    if (hasTrait('b2p2')) {                                    // 4th Tempo: floaty, higher set that carries further in the direction you are running
      const tg = P.pos.clone().addScaledVector(dir, P.moving ? 6.5 : 1.2); tg.y = 0; const g4 = 0.55;
      finishSet(launchTo(B.pos, tg, Math.max(7.0, B.pos.y + 3.5), BALL_G * g4), g4);
    } else {
    const tg = P.pos.clone().addScaledVector(dir, 3.7); tg.y = 0;
    finishSet(launchTo(B.pos, tg, Math.max(5.3, B.pos.y + 2.2)), 1);
    }
  } else if (a.type === 'spike' || a.type === 'tip') {
    if (P.onGround) { P.act = null; return; }
    if (a.type === 'spike' ? doSpike(a.c) : doTip()) P.act = null;
  } else if (a.type === 'jset') {
    if (P.onGround) { P.act = null; return; }
    if (!ballReach(highPos(), REACH_A + 0.2)) return; P.act = null;
    const tw = tiltWorld(); const mag = Math.min(1, tw.length());
    const dir = mag > 0.05 ? tw.normalize() : cf().multiplyScalar(0.1);
    const tg = P.pos.clone().addScaledVector(dir, 0.5 + mag * 9.5); tg.y = 0;
    finishSet(launchTo(B.pos, tg, Math.max(4.4, B.pos.y + 1.4)), 1);
  }
}
const ANTENNA_TOP = () => NET_H + 0.8;          // antennas reach 80 cm over the tape
function nearestNetInfo(pos) {                   // nearest net to a point: its normal (pointing from the ball toward the net), the distance along that normal, and where the plane is
  let best = null;
  for (const n of netsFor()) { const dn = (pos.x - n.cx) * n.nx + (pos.z - n.cz) * n.nz; const lat = -(pos.x - n.cx) * n.nz + (pos.z - n.cz) * n.nx; if (Math.abs(lat) > n.half + 3) continue; if (!best || Math.abs(dn) < best.dist) best = { n, dist: Math.abs(dn), sign: Math.sign(dn) || 1 }; }
  return best;
}
function finishSet(vel, g) {                     // every set (ground, jump, 4th Tempo) ends here so the setter traits apply to all of them
  if (hasTrait('b4a')) {
    const info = nearestNetInfo(B.pos);
    if (info && info.dist > 0.6) {
      const toward = new V3(-info.n.nx * info.sign, 0, -info.n.nz * info.sign);   // unit vector from the ball to the net plane
      const h = new V3(vel.x, 0, vel.z); const hs = h.length();
      if (hs > 0.1 && h.clone().normalize().dot(toward) > 0.35) {          // aimed at the nearest net: Perfect Set
        const s0 = hs * 3; h.normalize().multiplyScalar(s0);              // 3x faster leaving the hands...
        const tNet = info.dist / h.dot(toward) * 1.394;                   // ...holding its pace and then decaying hard to 33% right at the net (integral of 1 / 0.33^(p^3) over the run = 1.394)
        const apex = Math.max(ANTENNA_TOP() + 0.3, B.pos.y + 0.5);       // and peaks just over the antennas, right at the net
        const gg = 2 * (apex - B.pos.y) / (tNet * tNet); const vy = gg * tNet;
        hitBall('set', new V3(h.x, vy, h.z), gg / BALL_G);
        B.pf = { nx: info.n.nx, nz: info.n.nz, cx: info.n.cx, cz: info.n.cz, side: info.sign, d0: info.dist, s0 };   // the flight rule the ball carries (synced in its record)
        writeBall(B); return;
      }
    }
  }
  if (hasTrait('b2p2') && g !== 1) { hitBall('set', vel, g); return; }   // 4th Tempo keeps its own float
  if (hasTrait('b4p1')) { vel.y *= 1.2; vel.x *= 2; vel.z *= 2; }        // Speed Set: 2x the horizontal speed, 1.2x the height
  hitBall('set', vel, g);
}
function doBlock() { P.airUsed = true; P.airActed = true; P.rig.base = 'block'; P.rig.setPose('block'); P.blockUntil = T + 10; P.blockHit = false; setTimeout(() => actionFx('block', P.rig, cf()), 90); }
function blockContact() {
  P.blockHit = true; camKick(-0.04, 3.2);
  const s = B.vel.length(); const tz = P.tilt.y * (hasTrait('b1p2') ? -1 : 1), tx = P.tilt.x; const nd = netDir();   // Fake Block: forward / back tilt swapped
  let vel, g = 1;
  if (tz >= 0) {
    if (s >= 13) { const dir = withLateral(nd, tx, 30); const sp = s * 0.5; const ang = 52 * D; vel = new V3(dir.x * Math.cos(ang) * sp, -Math.sin(ang) * sp, dir.z * Math.cos(ang) * sp); g = 0.35; }
    else { const tg = P.pos.clone().addScaledVector(withLateral(nd, tx, 30), 5.5); tg.y = 0; vel = launchTo(B.pos, tg, B.pos.y + 3.6); }
  } else {
    const f = clamp((s - 6) / 22, 0, 1); const dist = 1.5 + 6.5 * f;
    const tg = P.pos.clone().addScaledVector(nd, -dist).addScaledVector(cr(), tx * 2); tg.y = 0;
    vel = launchTo(B.pos, tg, B.pos.y + lerp(3.6, 1.1, f));
  }
  hitBall('block', vel, g);
}
function chargeAt(dt) { return dt <= 0.1875 ? dt / 0.1875 * 0.5 : clamp(0.5 + (dt - 0.1875) / 0.375 * 0.5, 0, 1); }   // 0.19s to half, 0.56s to full
function startSpike() {
  P.airUsed = true; P.charging = true; P.chargeStart = T; P.charge = 0; const dc = P.dashCharge; P.dashCharge = false;
  if (P.doubleSpike) { P.chargeStart = T - 1; P.charge = 1; }                            // Double Spike: the second swing is always a full charge
  else if (dc) { P.chargeStart = T - 0.375; P.charge = 0.75; }                     // fresh off a dash: the bar begins at 75%
  else if (hasTrait('b2p1')) { P.chargeStart = T - 0.09375; P.charge = 0.25; }             // Spike Startup: the bar begins at 25%
  $('#chargeBar').classList.remove('hidden'); $('#chargeBar').classList.toggle('storm', !!P.doubleSpike);
}   // stays in the jump pose while charging; the swing plays on release
function releaseSpike() {
  P.charging = false; $('#chargeBar').classList.add('hidden');
  const c = P.charge;                                            // decide from the charge that is on screen, so a frame hitch between press and release can never turn a tap into a spike
  if (c <= 0.35) { /* a tap up to 35% charge is a tip; past that it swings */ P.rig.base = 'airDown'; P.rig.setPose('tip', T + 0.4); if (!doTip()) P.act = { type: 'tip', until: T + 0.16 }; }
  else { P.rig.setPose('spikeCharge', T + 0.07); P.swingAt = T + 0.07; if (!doSpike(c)) P.act = { type: 'spike', c, until: T + 0.16 }; }   // the hit stays armed briefly after the swing
}
function netAhead(from, fwd) {                 // distance to the nearest net in front of the ball (Infinity if none)
  let best = Infinity;
  for (const n of netsFor()) {
    const dn = fwd.x * n.nx + fwd.z * n.nz; if (Math.abs(dn) < 0.2) continue;
    const dist = -((from.x - n.cx) * n.nx + (from.z - n.cz) * n.nz) / dn; if (dist < 0.3) continue;
    const lat = -(from.x + fwd.x * dist - n.cx) * n.nz + (from.z + fwd.z * dist - n.cz) * n.nx;
    if (Math.abs(lat) < n.half + 2) best = Math.min(best, dist);
  }
  return best;
}
// pitch (rad) that lands a shot of speed s under gravity gg at horizontal distance R with height change h (low trajectory); null if unreachable
function ballisticPitch(s, gg, R, h) { const disc = s * s * s * s - gg * (gg * R * R + 2 * h * s * s); if (disc < 0) return null; return Math.atan((s * s - Math.sqrt(disc)) / (gg * R)); }
function spikeGeom() {
  const tz = P.tilt.y; const fwd = P.jumpFwd.clone().normalize();      // aim = facing at the moment you jumped; tilt never steers it
  let toNet = netAhead(B.pos, fwd); if (!isFinite(toNet)) toNet = 7;
  const CL = S.scene === 'match' ? courtDims().l : COURT_L; const dMid = clamp(toNet + CL / 4, 3, 24);
  const clearPitch = toNet < 1.2 ? -Math.PI / 2 : Math.min(35 * D, Math.atan2((NET_H + 0.35) - B.pos.y, toNet));   // capped; right at the net TOO LOW handles it instead
  const neutralPitch = Math.max(Math.atan2(-B.pos.y, dMid), clearPitch);
  const far = clamp((toNet - 3) / (8 * (S.scene === 'match' ? courtDims().l / COURT_L : 1)), 0, 1);   // 0 at the net, 1 from the back line
  return { tz, fwd, neutralPitch, clearPitch, toNet, far };
}
function doSpike(c) {
  if (!ballReach(highPos(), REACH_A, 0.6)) return false;                  // spike hitbox: 60% as tall
  camKick(0.05 + c * 0.06, 2.6 + c * 4.5);                                // the harder the swing, the harder the camera takes it
  const { tz, fwd, neutralPitch, clearPitch } = spikeGeom();
  const sp = (13 + 22 * c) * (tz > 0 ? lerp(1, 0.75, tz) : 1) * (P.doubleSpike ? 1.2 : 1);   // W tilt trades power for steepness; Double Spike hits 20% harder
  if (B.serve) {                                                // serve: slightly up, full gravity, tilt ignored (full charge ~ back line)
    const ss = (13 + 22 * c) * (P.doubleSpike ? 1.2 : 1) * (hasTrait('b3p1') ? 1.1 : 1);   // serve speed IS your spike power, uncapped (35 m/s at full charge); every spike modifier carries over; King Serve +10%
    let gs = lerp(1, 2.0, c), pitch = lerp(20, 5, c) * D;                   // the harder the serve, the heavier it falls
    const toNet = spikeGeom().toNet; const CL = S.scene === 'match' ? courtDims().l : COURT_L; const aimed = isFinite(toNet) && toNet < 40;
    const R = aimed ? lerp(toNet + CL / 4 + 1, toNet + CL / 2 - 1.2, c) : 14 + 10 * c;   // aim deeper the harder you hit: mid far court -> just inside the far back line
    for (let k = 0; k < 12; k++) {                                           // lowest arc that reaches the spot and still clears the net; if clearing the net would carry it out, fall heavier and retry
      const gg = BALL_G * gs; const p0 = ballisticPitch(ss, gg, R, -B.pos.y); if (p0 === null) break; pitch = p0;
      if (aimed) for (let i = 0; i < 8; i++) { const t = toNet / (ss * Math.cos(pitch)); const y = B.pos.y + ss * Math.sin(pitch) * t - 0.5 * gg * t * t; if (y >= NET_H + 0.4) break; pitch += 3 * D; }
      const vy = ss * Math.sin(pitch), tf = (vy + Math.sqrt(vy * vy + 2 * gg * B.pos.y)) / gg;
      if (!aimed || ss * Math.cos(pitch) * tf <= R + 0.6) break; gs += 0.15;
    }
    hitBall('spike', new V3(fwd.x * Math.cos(pitch) * ss, Math.sin(pitch) * ss, fwd.z * Math.cos(pitch) * ss), gs, c);
    return true;
  }
  const { toNet, far } = spikeGeom();
  let pitch = tz >= 0 ? lerp(neutralPitch, -60 * D, tz) : lerp(neutralPitch, neutralPitch * 0.4, -tz);   // near the net: as before
  if (tz < 0.35) pitch = Math.max(pitch, clearPitch);
  let g = 0.18;
  if (far > 0) {                                                        // far from the net: aim higher with more gravity so every tilt can still land in
    const gFar = lerp(0.18, 2.6, far); const gg = BALL_G * gFar;      // heavier and heavier the further back you are
    const CL2 = S.scene === 'match' ? courtDims().l : COURT_L; const R = tz >= 0 ? lerp(toNet + CL2 / 4, toNet + 1.5, tz) : lerp(toNet + CL2 / 4, toNet + CL2 / 2 - 0.8, -tz);
    let pf = ballisticPitch(sp, gg, R, -B.pos.y); if (pf === null) pf = 40 * D;
    for (let i = 0; i < 6; i++) {                                       // make sure it clears the net on the way
      const t = toNet / (sp * Math.cos(pf)); const y = B.pos.y + sp * Math.sin(pf) * t - 0.5 * gg * t * t;
      if (y >= NET_H + 0.4) break; pf += 4 * D;
    }
    pitch = lerp(pitch, pf, Math.min(1, far / 0.3)); g = gFar;
  }
  // TOO LOW: decided once, right here at the swing - if this spike would go into the net it becomes a high, airy ball over instead
  if (isFinite(toNet) && toNet < 40) {
    const tN = toNet / Math.max(0.5, sp * Math.cos(pitch)); const yN = B.pos.y + sp * Math.sin(pitch) * tN - 0.5 * BALL_G * g * tN * tN;
    if (yN < NET_H + BALL_R) {
      const tg = B.pos.clone().addScaledVector(fwd, toNet + 4.5); tg.y = 0;
      hitBall('spike', launchTo(B.pos, tg, Math.max(B.pos.y + 4.5, NET_H + 3.5)), 1, c);
      showBallMsg('TOO LOW', B.pos); return true;
    }
  }
  hitBall('spike', new V3(fwd.x * Math.cos(pitch) * sp, Math.sin(pitch) * sp, fwd.z * Math.cos(pitch) * sp), g, c); return true;
}
function doTip() {
  if (!ballReach(highPos(), REACH_A, 0.6)) return false;
  if (B.serve) return doSpike(0.3);                              // a tap on a serve toss = soft serve
  const { tz, fwd } = spikeGeom();
  let sp = 7, pitch = 32 * D;
  if (tz > 0) { sp = lerp(7, 5.0, tz); pitch = lerp(32, 62, tz) * D; } else if (tz < 0) { sp = lerp(7, 9.0, -tz); pitch = lerp(32, 22, -tz) * D; }
  const v = new V3(fwd.x * Math.cos(pitch) * sp, Math.sin(pitch) * sp, fwd.z * Math.cos(pitch) * sp);
  if (hasTrait('b1a')) {                                          // Lightning Drop: same landing spot, but the ball rockets 3 m up and slams down under heavy gravity
    const tf = (v.y + Math.sqrt(v.y * v.y + 2 * BALL_G * B.pos.y)) / BALL_G;   // where the normal tip would land
    const tg = new V3(B.pos.x + v.x * tf, 0, B.pos.z + v.z * tf); const gd = 3.2;
    hitBall('tip', launchTo(B.pos, tg, B.pos.y + 3, BALL_G * gd), gd); return true;
  }
  hitBall('tip', v, 1); return true;
}
function tryDash() {                          // Dash (ability trait): a burst in your movement direction, 3 s cooldown; in the air it kills vertical momentum and refreshes your air action
  if (!hasTrait('b3a') || P.dash || P.dive || P.holding || P.emote) return;
  if (T < (P.dashReady || 0)) return;
  const ui = uiOpen();
  const { ix, iz } = inputAxes(ui);
  const dir = (ix || iz) ? camF().multiplyScalar(iz).add(camR().multiplyScalar(ix)).normalize() : cf();
  P.dash = { t0: T, dur: 0.15, dir }; P.dashReady = T + 4; P.vel.set(0, 0, 0); P.glide = null; P.dashCharge = true;   // the next spike after a dash starts half charged
  if (!P.onGround) {                                                       // reset the jump: spike, dash, spike again
    P.airUsed = false; P.airActed = false; P.act = null; P.swingAt = 0; P.blockUntil = 0; P.doubleSpike = false; P.dsUsed = false; P.jumpFwd = cf();
    if (P.charging) { P.charging = false; $('#chargeBar').classList.add('hidden'); }
  } else { P.moveDir.copy(dir); P.moving = true; P.cd = 0; P.landLock = 0; P.act = null; }   // and the ground: set, dash, set again
  P.rig.setPose('dash', T + 0.15); lightningFx(P.pos.clone().add(new V3(0, 0.9, 0)), dir.clone().negate(), 0xfff1a0, 0xffe066, 6);   // yellow lightning crackles off you
}
function doDive() {
  const dir = P.moving ? P.moveDir.clone() : cf();
  P.dive = { t0: T, dur: 0.55, dir, hit: false };
  const side = dir.dot(cr()), fwd = dir.dot(cf());
  let pose = 'dive', pitch = 1.25, roll = 0;
  if (Math.abs(fwd) >= Math.abs(side)) { if (fwd < 0) { pose = 'diveB'; pitch = -0.95; } }
  else if (side > 0) { pose = 'diveR'; pitch = 0; roll = 1.15; } else { pose = 'diveL'; pitch = 0; roll = -1.15; }   // +roll = body rolls onto its right side
  P.rig.setPose(pose); P.rig.pitchTarget = pitch; P.rig.rollTarget = roll; P.diveAnim = { pitch, roll };
}
function diveContact() {
  P.dive.hit = true; const tg = P.pos.clone().addScaledVector(cf(), 2.5); tg.y = 0;
  hitBall('dive', launchTo(B.pos, tg, Math.max(5.5, B.pos.y + 3)), 1);
}
function canSpawnHere() { const M = S.match; if (!M) return S.scene === 'lobby' && !indoors(P.pos.x, P.pos.z); return M.practice; }
function trySpawnBall(serveMode, force = false) {
  if ((!force && !canSpawnHere()) || P.holding) return;
  const M = S.match; let b;
  if (!M) b = balls.get(SID) || makeBall(SID, 'lobby'); else b = balls.get('match');
  if (!b) return;
  B = b; b.skin = me.skin || 'default'; applySkin(b.mesh, b.skin);
  b.active = true; b.frozen = false; b.vel.set(0, 0, 0); b.hitter = null; b.hitType = null; b.prevHitter = null; b.touches = 0; b.sideTeam = P.team; b.serve = false; b.tossedBy = null; b.landed = false; b.seq++; b.t = snow();
  P.holding = true; P.serveMode = !!serveMode || !!(M && !M.practice); P.serveAim = null; b.held = SID; P.rig.base = 'hold'; P.rig.setPose('hold');
  writeBall(b);
}
function doToss() {
  const b = B; if (!b) { P.holding = false; return; }
  if (P.serveMode && !P.serveAim) { P.serveAim = new THREE.Vector2(0, 0); return; }   // first press: show the aim arrows
  P.holding = false; P.rig.setPose('toss', T + 0.45); P.rig.base = P.onGround ? 'idle' : 'air';
  b.held = null; P.rig.handPos('L', b.pos); b.tossedBy = SID;
  if (P.serveMode) {                                                                  // second press: toss where the arrows point
    const a = P.serveAim || new THREE.Vector2(); const m = Math.min(1, a.length());
    const w = camR().multiplyScalar(a.x).add(camF().multiplyScalar(a.y)); if (m > 0.01) w.normalize();
    b.serve = true; hitBall('toss', w.multiplyScalar(0.35 + 1.2 * m).add(new V3(0, 8.8, 0)), 0.7);   // floaty toss: ~4.4 m up under 70% gravity, drifting ~0.8 m (up to ~3.5 m when aimed)
  } else { b.serve = false; hitBall('toss', cf().multiplyScalar(0.4).add(new V3(0, Math.sqrt(2 * BALL_G * (P.pos.y + 1.7 + 5 - b.pos.y)), 0)), 1); }   // apex 5 m over the head
  P.serveMode = false; P.serveAim = null;
  const M = S.match; if (M && !M.practice && M.state === 'serve') mwrite('state', 'rally');
}
function hitBall(type, vel, g, charge = 0) {
  const b = B; if (!b) return;
  b.vel.copy(vel); b.g = g; b.seq++; b.t = snow(); b.held = null; b.active = true; b.frozen = false; b.pf = null;
  b.prevHitter = b.hitter; b.prevType = b.hitType; b.hitter = SID; b.hitType = type; b.fx = me.fx || 'none'; b.hm = me.model || 'boy'; b.hitterPos = { x: P.pos.x, z: P.pos.z };
  if (type === 'toss' || type === 'block') { b.touches = 0; b.sideTeam = P.team; }
  else { if (b.sideTeam !== P.team) { b.sideTeam = P.team; b.touches = 1; } else b.touches++; }
  if (type !== 'toss') { b.serve = false; P.serving = false; }                                       // the serve is away: you may step into the court again
  b.spin.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(vel.length() * 0.4);
  b.landed = false;
  b.ds = type === 'spike' && !!P.doubleSpike;                                                         // lightning spike: everyone sees the bolts
  if (b.ds) lightningFx(b.pos.clone(), vel.clone().normalize());
  else if (type === 'spike') sparkle(b.pos, 12, 0xffffff, 1.4, 0.6, 0.35, 0.07, vel.clone().normalize());   // impact sparks (also seen by others via the ball's hit sync)
  if (type === 'spike' || type === 'tip') { P.doubleSpike = false; $('#chargeBar').classList.remove('storm'); }
  writeBall(b); hostCheckHit();
}

/* ---------------- Player update ---------------- */
function updatePlayer(dt) {
  const ui = uiOpen();
  const { ix, iz } = inputAxes(ui);
  if (P.cd > 0) P.cd -= dt;
  const steering = !!(P.holding && P.serveAim);
  tryAct();
  if (P.swingAt && T >= P.swingAt) { P.swingAt = 0; if (!P.onGround) { P.rig.base = 'airDown'; P.rig.setPose('spikeHit', T + 0.4); actionFx('spike', P.rig, P.jumpFwd); } }   // the arm stays down through the fall instead of re-cocking
  if (P.dash) {
    const e = (T - P.dash.t0) / P.dash.dur;
    if (e >= 1) {
      P.dash = null; P.vel.x = P.vel.z = 0;                                                  // the dash leaves you with no momentum...
      if (P.onGround) { P.rig.base = 'idle'; P.rig.setPose('idle'); }
      else { P.rig.base = 'air'; P.rig.setPose('air'); const w = camR().multiplyScalar(ix).add(camF().multiplyScalar(iz)); P.glide = w.lengthSq() > 0 ? w.normalize() : null; }   // ...then you glide the way you were tilting (locked in until you land)
    }
    else { const sp = 55.4 * (1 - e * 0.55); P.vel.x = P.dash.dir.x * sp; P.vel.z = P.dash.dir.z * sp; if (!P.onGround) P.vel.y = 0; if (e > 0.1 && Math.random() < 0.7) sparkle(P.pos.clone().add(new V3(0, 0.8, 0)), 3, 0xffe066, 0.35, 0.3, 0.25, 0.05); }   // yellow trail
  } else if (P.dive) {
    const e = (T - P.dive.t0) / P.dive.dur;
    if (e >= 1) { P.dive = null; P.cd = DIVE_CD; P.rig.pitchTarget = 0; P.rig.rollTarget = 0; P.diveAnim = null; P.rig.setPose('idle'); P.rig.base = 'idle'; }
    else { const sp = 15 * (1 - e * 0.6); P.vel.x = P.dive.dir.x * sp; P.vel.z = P.dive.dir.z * sp; }   // ~2x dive distance
  } else if (P.onGround) {
    if (P.emote && (ix || iz)) stopEmote();
    const mv = steering || P.emote ? new V3() : camF().multiplyScalar(iz).add(camR().multiplyScalar(ix));
    if (mv.lengthSq() > 0) { mv.normalize(); const ms = MOVE_SPEED * (hasTrait('b1p1') ? 1.1 : 1); P.vel.x = mv.x * ms; P.vel.z = mv.z * ms; P.moveDir.copy(mv); P.moving = true; }   // Quick Feet: +10%
    else { P.vel.x = P.vel.z = 0; P.moving = false; }
    if (shiftLock) P.ry = camYaw;
    else if (P.moving) { const tr = Math.atan2(mv.x, mv.z); let d = tr - P.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); P.ry += d * Math.min(1, dt * 14); }
  } else {
    if (P.glide) { P.vel.x = P.glide.x * GLIDE_SPEED; P.vel.z = P.glide.z * GLIDE_SPEED; }   // post-dash glide: fixed direction
    const w = camR().multiplyScalar(ix).add(camF().multiplyScalar(iz));   // tilt: camera-relative, mapped onto the character
    P.tiltIn.set(w.dot(cr()), w.dot(cf())); if (P.tiltIn.length() > 1) P.tiltIn.normalize();
  }
  if (steering) {                                                          // serve aim: WASD slides the ghost ball to the edge of the arrows
    P.serveAim.x += (ix - P.serveAim.x) * Math.min(1, dt * 8); P.serveAim.y += (iz - P.serveAim.y) * Math.min(1, dt * 8);
    if (P.serveAim.length() > 1) P.serveAim.normalize();
  }
  for (const f of FX_LIST) {                                              // black holes slowly pull anyone inside the outer ring
    if (f.type !== 'blackhole' || f.t > f.dur * 0.8) continue;
    const dx = f.x - P.pos.x, dz = f.z - P.pos.z, dist = Math.hypot(dx, dz);
    if (dist > f.pull || dist < f.core) continue;
    const pull = 4.8; P.pos.x += dx / dist * pull * dt; P.pos.z += dz / dist * pull * dt;   // 4.8 m/s toward the centre
  }
  if (P.onGround && P.moving && !P.dive) { P.stepAcc = (P.stepAcc || 0) + dt; if (P.stepAcc > 0.16) { P.stepAcc = 0; puff(P.pos.x - P.moveDir.x * 0.2, P.pos.z - P.moveDir.z * 0.2, 2, 0.6, 0.8, groundDustColor()); } }
  P.tilt.lerp(P.onGround ? new THREE.Vector2() : P.tiltIn, Math.min(1, dt * 12));
  const tsf = timeStopFactor(P.pos.x, P.pos.z, P.pos.y); dt *= tsf;              // Time Stop: inside the clock you move, jump and fall at 12% speed (P.vel stays normal so animations still read)
  if (!P.dash) P.vel.y -= G * (hasTrait('b3p2') ? 1.1 : 1) * (P.vel.y < 0 && hasTrait('b4p2') ? 0.7 : 1) * dt;   // Setter Vision: floaty descent                // a dash holds you at your height; Power Jump falls 10% harder
  const prevPos = P.pos.clone();
  const nx = P.pos.x + P.vel.x * dt, nz = P.pos.z + P.vel.z * dt;
  if (S.scene === 'lobby') {
    const py = P.pos.y, air = !P.onGround; if (walkable(nx, nz, py, air)) { P.pos.x = nx; P.pos.z = nz; } else if (walkable(nx, P.pos.z, py, air)) P.pos.x = nx; else if (walkable(P.pos.x, nz, py, air)) P.pos.z = nz;
  } else {
    const mb = matchBounds();
    P.pos.x = clamp(nx, -mb.x + 1, mb.x - 1);
    let z = clamp(nz, -mb.z + 1, mb.z - 1);
    if (S.match && !S.match.practice) z = P.team === 'A' ? Math.min(z, -0.45) : Math.max(z, 0.45);
    if (P.serving && P.onGround) { const back = courtDims().l / 2 + 0.35; z = P.team === 'A' ? Math.min(z, -back) : Math.max(z, back); }   // foot fault: no stepping over the back line until the serve is hit
    P.pos.z = z;
  }
  blockNetCrossing(prevPos, P.pos);
  P.pos.y += P.vel.y * dt;
  if (S.scene === 'lobby') { const cy = ceilingY(P.pos.x, P.pos.z, P.pos.y) - 1.75; if (P.pos.y > cy) { P.pos.y = cy; if (P.vel.y > 0) P.vel.y = 0; } }   // head against the ceiling
  const gh = S.scene === 'lobby' ? groundHeight(P.pos.x, P.pos.z, P.pos.y) : 0;   // floors: ground, the stairs, the second floor
  if (P.onGround && P.vel.y <= 0 && P.pos.y > gh + 0.7) P.onGround = false;   // walked off an edge
  if (P.pos.y <= gh || (P.onGround && P.vel.y <= 0 && P.pos.y - gh <= 0.7)) {
    const impV = P.vel.y;
    P.pos.y = gh; P.vel.y = 0;
    if (!P.onGround) {
      const hard = clamp(-impV / 11, 0, 1);                                    // how fast you were falling, 0..1
      P.rig.impact(-0.09 - hard * 0.15); camKick(-0.05 - hard * 0.11, 1.6 + hard * 2.2);
      P.onGround = true; P.airUsed = false; P.blockUntil = 0; P.doubleSpike = false; P.dsUsed = false; P.glide = null; P.dashCharge = false; $('#chargeBar').classList.remove('storm');
      if (P.airActed) { P.landLock = T + 0.5; P.airActed = false; }           // used block / jump set on that jump: on landing, 0.5s of no jump / set / bump / dive
      if (P.charging) { P.charging = false; $('#chargeBar').classList.add('hidden'); } P.swingAt = 0;
      P.rig.base = P.holding ? 'hold' : 'idle';
      P.rig.setPose(P.holding ? 'hold' : 'land', P.holding ? 0 : T + 0.16);   // short landing crouch, then back to idle / run
      if (P.act && P.act.type !== 'bump' && P.act.type !== 'set') P.act = null;
    }
  }
  if (P.emote && T - P.emote.t0 > 6) stopEmote();
  const rig = P.rig; rig.root.position.copy(P.pos); rig.root.rotation.y = P.ry;
  rig.tiltX = P.tilt.x; rig.tiltZ = P.tilt.y;
  rig.moveSpeed = P.onGround && !P.dive ? Math.hypot(P.vel.x, P.vel.z) : 0;
  if (P.charging) P.charge = chargeAt(T - P.chargeStart);
}

/* ---------------- Ball physics ---------------- */
const matchBounds = () => (S.match && S.match.map === 'beach') ? { x: 26, z: 32, walls: false } : { x: GYM_X, z: GYM_Z, walls: true };
const netsFor = () => S.scene === 'match' ? courtDims().nets : BEACH_NETS;
const courtsFor = () => S.scene === 'match' ? courtDims().courts : BEACH_COURTS;
const inAnyCourt = (x, z) => courtsFor().some(c => Math.abs(x - c.cx) <= c.hx + BALL_R && Math.abs(z - c.cz) <= c.hz + BALL_R);
function blockNetCrossing(prev, pos) {          // players stop at the net (they can walk around the posts)
  for (const n of netsFor()) {
    const dp = (prev.x - n.cx) * n.nx + (prev.z - n.cz) * n.nz, dc = (pos.x - n.cx) * n.nx + (pos.z - n.cz) * n.nz;
    const lat = -(pos.x - n.cx) * n.nz + (pos.z - n.cz) * n.nx;
    if (Math.abs(lat) > n.half + 0.4) continue;
    const crossed = Math.sign(dp) !== Math.sign(dc) && dp !== 0;
    if (crossed || Math.abs(dc) < 0.45) {
      const side = (dp !== 0 ? Math.sign(dp) : (dc !== 0 ? Math.sign(dc) : 1)) * 0.45;
      pos.x += (side - dc) * n.nx; pos.z += (side - dc) * n.nz;
    }
  }
}
function ballNets(b, prev) {
  for (const n of netsFor()) {
    const dp = (prev.x - n.cx) * n.nx + (prev.z - n.cz) * n.nz, dc = (b.pos.x - n.cx) * n.nx + (b.pos.z - n.cz) * n.nz;
    if (Math.sign(dp) === Math.sign(dc) || dp === 0) continue;
    const lat = -(b.pos.x - n.cx) * n.nz + (b.pos.z - n.cz) * n.nx;
    if (b.pos.y < NET_H + BALL_R * 0.5 && Math.abs(lat) < n.half + 0.3) {                 // anything below the tape, all the way to the ground: a ball can never pass under a net
      const side = Math.sign(dp) * (0.15 + BALL_R);
      b.pos.x += (side - dc) * n.nx; b.pos.z += (side - dc) * n.nz;
      const vn = b.vel.x * n.nx + b.vel.z * n.nz;
      b.vel.x -= vn * n.nx * 1.25; b.vel.z -= vn * n.nz * 1.25; b.vel.x *= 0.6; b.vel.z *= 0.6; b.vel.y = Math.min(b.vel.y, 0) * 0.5; b.g = 1;
      return true;
    } else if (b.id === 'match' && S.match && !S.match.practice) { const st = b.pos.z < 0 ? 'A' : 'B'; if (st !== b.sideTeam) { b.sideTeam = st; b.touches = 0; } }
  }
  return false;
}
function timeStopFactor(x, z, y = 0) { if (y >= 4) return 1; for (const f of FX_LIST) if (f.type === 'timestop' && Math.hypot(x - f.x, z - f.z) < f.r) return TIMESTOP_SLOW; return 1; }
const BALL_STEP = 1 / 120;                       // balls always step in exact 1/120 s slices, so every client integrates the same trajectory from the same hit record (no drift, no snap on the next hit)
function stepBall(b, dt) {                        // advance a ball by dt using whole fixed steps (the remainder is kept for next time); Time Stop scales the time that flows into it
  b.acc = (b.acc || 0) + dt * timeStopFactor(b.pos.x, b.pos.z, b.pos.y);
  let n = 0; while (b.acc >= BALL_STEP && n < 200) { simBall(b, BALL_STEP); b.acc -= BALL_STEP; n++; }
}
function simBall(b, dt) {
  const M = S.match;
  const steps = 1, h = dt;
  for (let i = 0; i < steps; i++) {
    const prev = b.pos.clone();
    if (b.pf) {                                                            // Perfect Set: slow toward the net, then hand over to plain physics once it is there
      const f = b.pf; const dn = (b.pos.x - f.cx) * f.nx + (b.pos.z - f.cz) * f.nz;
      if (Math.sign(dn) !== f.side || Math.abs(dn) < 0.05) { b.pf = null; b.g = 1; }
      else { const want = f.s0 * Math.pow(0.33, Math.pow(clamp(1 - Math.abs(dn) / f.d0, 0, 1), 3)); /* stays fast, then decays steeply in the last stretch before the net */ const hs = Math.hypot(b.vel.x, b.vel.z); if (hs > 1e-3) { const k = want / hs; b.vel.x *= k; b.vel.z *= k; } }
    }
    b.vel.y -= BALL_G * b.g * h; b.vel.multiplyScalar(1 - 0.015 * h);
    if (b.scene === 'lobby' && b.pos.y > 0.5) { b.vel.x += WIND.x * 0.35 * h; b.vel.z += WIND.z * 0.35 * h; }   // wind drift outside
    b.pos.addScaledVector(b.vel, h);
    ballNets(b, prev);
    if (S.scene === 'match' && matchBounds().walls) {
      if (Math.abs(b.pos.x) > GYM_X - 0.5) { b.pos.x = Math.sign(b.pos.x) * (GYM_X - 0.5); b.vel.x *= -0.5; }
      if (Math.abs(b.pos.z) > GYM_Z - 0.5) { b.pos.z = Math.sign(b.pos.z) * (GYM_Z - 0.5); b.vel.z *= -0.5; }
      if (b.pos.y > 10.7) { b.pos.y = 10.7; b.vel.y *= -0.5; }
    }
    if (b.pos.y < BALL_R) {
      b.pos.y = BALL_R; b.serve = false;
      if (!b.landed) {
        b.landed = true; const inC = inAnyCourt(b.pos.x, b.pos.z); landingMark(b.pos.x, b.pos.z, inC);
        if (inC && b.fx && b.fx !== 'none' && b.hitter && b.hitterPos && b.hitType !== 'toss' && acrossNet(new V3(b.hitterPos.x, 0, b.hitterPos.z), b.pos)) playScoreFx(b.fx, b.pos.x, b.pos.z, b.hm || 'boy');
      }
      if (b.id === 'match' && M && !M.practice && M.state === 'rally' && isHost()) hostBallLanded();   // the point is decided, but the ball keeps its physics until the next serve
      if (Math.abs(b.vel.y) < 1.2) { b.vel.y = 0; b.vel.x *= 0.97; b.vel.z *= 0.97; } else b.vel.y *= -0.55;
      b.vel.x *= 0.85; b.vel.z *= 0.85;
    }
  }
}
function updateBalls(dt) {
  for (const b of balls.values()) {
    const here = b.scene === S.scene;
    b.mesh.visible = b.shadow.visible = here && b.active;
    if (!here || !b.active) continue;
    if (b.held) {
      const holderRig = b.held === SID ? P.rig : (remotes.get(b.held) || {}).rig;
      if (holderRig) { holderRig.handPos('L', b.pos); b.pos.y += BALL_R * 0.6; }
    } else if (!b.frozen) stepBall(b, dt);
    if (b.visOff) { const k = Math.exp(-dt * 14); b.visOff.multiplyScalar(k); if (b.visOff.lengthSq() < 1e-6) b.visOff = null; }   // a network correction is eased out visually instead of popping
    b.mesh.position.copy(b.pos); if (b.visOff) b.mesh.position.add(b.visOff); if (!b.held) { b.mesh.rotation.x += b.spin.x * dt; b.mesh.rotation.y += b.spin.y * dt; b.mesh.rotation.z += b.spin.z * dt; }
    b.shadow.position.set(b.pos.x, 0.015, b.pos.z); b.shadow.material.opacity = clamp(0.45 - b.pos.y * 0.04, 0.08, 0.45);
  }
  // local player contact actions (block / dive) against any reachable ball
  if (T < P.blockUntil && !P.blockHit && ballReach(highPos(), 1.6, 1, true) && B.hitter !== SID && B.vel.dot(cf()) < 0) blockContact();   // blocks may reach over the net
  if (P.dive && !P.dive.hit && ballReach(P.pos.clone().add(new V3(0, 0.6, 0)).addScaledVector(P.dive.dir, 1.0), 1.8)) diveContact();
}
/* ---- "TOO LOW" popup at the ball ---- */
let ballMsg = null;
function showBallMsg(text, pos) { ballMsg = { pos: pos.clone(), until: performance.now() + 1500 }; const el = $('#ballMsg'); el.textContent = text; el.classList.remove('hidden'); }
function projectBallMsg() {
  const el = $('#ballMsg'); if (!ballMsg) return;
  if (performance.now() > ballMsg.until) { ballMsg = null; el.classList.add('hidden'); return; }
  if (B && B.active) ballMsg.pos.copy(B.pos);
  _v.copy(ballMsg.pos); _v.y += 0.8; _v.project(camera);
  el.style.display = _v.z < 1 ? '' : 'none'; el.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px';
}
/* ---- serve aim arrows (under the ball while steering a serve toss) ---- */
function projectServeAim() {
  const el = $('#serveAim');
  const on = !!(P.holding && P.serveAim);
  el.classList.toggle('hidden', !on); if (!on) return;
  _v.set(P.pos.x, 0.05, P.pos.z).addScaledVector(camF(), 1.2); _v.project(camera);
  el.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px';
  const g = el.querySelector('.ghost'); g.style.transform = `translate(${P.serveAim.x * 52}px, ${-P.serveAim.y * 52}px)`;
}

/* ---------------- Ball sync ---------------- */
function ballRecord(b) { return { active: b.active, held: b.held || null, frozen: b.frozen, x: b.pos.x, y: b.pos.y, z: b.pos.z, vx: b.vel.x, vy: b.vel.y, vz: b.vel.z, g: b.g, seq: b.seq, t: b.t, hitter: b.hitter || null, hitType: b.hitType || null, prevHitter: b.prevHitter || null, prevType: b.prevType || null, touches: b.touches, sideTeam: b.sideTeam, serve: !!b.serve, tossedBy: b.tossedBy || null, skin: b.skin || 'default', fx: b.fx || 'none', hm: b.hm || 'boy', hitterPos: b.hitterPos || null, ds: !!b.ds, pf: b.pf || null, by: SID }; }
function writeBall(b) {
  if (!b || !S.online) return;
  if (b.id === 'match') { const r = mref('ball'); if (r) r.set(ballRecord(b)); }
  else db.ref('lobbyBalls/' + b.id).set(ballRecord(b));
}
function receiveBall(b, v) {
  if (!b || !v || v.by === SID) return;
  if (v.seq < b.seq) return;
  b.seq = v.seq; b.active = !!v.active; b.held = v.held || null; b.frozen = !!v.frozen; b.g = v.g || 1; b.t = v.t || snow();
  b.hitter = v.hitter || null; b.hitType = v.hitType || null; b.prevHitter = v.prevHitter || null; b.prevType = v.prevType || null; b.touches = v.touches || 0; b.sideTeam = v.sideTeam || 'A';
  b.serve = !!v.serve; b.tossedBy = v.tossedBy || null; b.landed = false;
  if (v.skin && v.skin !== b.skin) { b.skin = v.skin; applySkin(b.mesh, b.skin); }
  b.fx = v.fx || 'none'; b.hm = v.hm || 'boy'; b.hitterPos = v.hitterPos || null; b.pf = v.pf || null;
  if (P.holding && B === b && b.held !== SID) { P.holding = false; P.serveMode = false; P.serveAim = null; P.rig.base = P.onGround ? 'idle' : 'air'; P.rig.setPose(P.rig.base); }
  const newHit = v.hitType === 'spike' && v.seq !== b.lastSparkSeq; b.lastSparkSeq = v.seq;
  if (b.active && !b.held) {
    const wasShown = b.mesh.visible && b.scene === S.scene; const before = wasShown ? b.mesh.position.clone() : null;
    b.pos.set(v.x, v.y, v.z); b.vel.set(v.vx, v.vy, v.vz); b.acc = 0;
    if (newHit) { if (v.ds) lightningFx(b.pos.clone(), b.vel.clone().normalize()); else sparkle(b.pos.clone(), 12, 0xffffff, 1.4, 0.6, 0.35, 0.07, b.vel.clone().normalize()); }
    const dt = clamp((snow() - b.t) / 1000, 0, 0.6);
    if (!b.frozen && dt > 0) { let left = dt; while (left > 0) { const h = Math.min(BALL_STEP, left); simBall(b, h); left -= h; } }   // catch up with the same fixed-step physics everyone else runs
    if (before && !newHit) { const off = before.sub(b.pos); if (off.length() < 1.5) b.visOff = off; }                                        // small correction: slide over ~0.15 s; a real hit or teleport shows immediately
    b.spin.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(b.vel.length() * 0.4);
  }
  if (b.id === 'match') hostCheckHit();
}
const JOIN_T = Date.now();
db.ref('lobbyBalls').on('child_added', s => { const v = s.val(); if (!v) return; if ((v.t || 0) < JOIN_T - 20000 && (Math.abs(v.vx || 0) + Math.abs(v.vz || 0) + Math.abs(v.vy || 0) < 0.5)) { s.ref.remove(); return; }   /* stale ball left behind before you joined: clear it */ const b = balls.get(s.key) || makeBall(s.key, 'lobby'); receiveBall(b, v); });
db.ref('lobbyBalls').on('child_changed', s => { const b = balls.get(s.key) || makeBall(s.key, 'lobby'); receiveBall(b, s.val()); });
db.ref('lobbyBalls').on('child_removed', s => { if (s.key !== SID) removeBall(s.key); });

/* ---------------- Remote players ---------------- */
const remotes = new Map();
function remoteUpsert(sid, d) {
  if (sid === SID || !d) return;
  let r = remotes.get(sid);
  const variant = TEAM_VARIANT[d.team] || 'white'; const model = d.md || 'boy';
  if (r && (r.rig.variant !== variant || r.rig.model !== model)) { remoteRemove(sid); r = null; }
  if (!r) {
    const rig = new Rig(variant, model); scene.add(rig.root); rig.root.position.set(d.x || 0, d.y || 0, d.z || 0);
    const tag = document.createElement('div'); tag.className = 'tag'; $('#tags').appendChild(tag);
    r = { rig, tag, name: d.name || '', buf: [], data: d, speed: 0, stamp: null, gap: 0.09, jit: 0.02, delay: INTERP_DELAY, lastArrive: 0, ptx: null, pty: 0, ptz: 0 };
    remotes.set(sid, r);
  }
  // de-jitter: packets are stamped onto a steady timeline running at the sender's average rate, not at
  // their arrival time — otherwise network latency wobble is replayed as speed wobble (surge / stall).
  const since = T - r.lastArrive;
  if (r.stamp === null || since > 0.8) { r.stamp = T; r.gap = 0.09; }
  else {
    if (since < 1.0) r.jit = lerp(r.jit, Math.min(0.2, Math.abs(since - r.gap)), 0.1);   // how unevenly this peer's packets arrive (stalls count, up to 200 ms)
    if (since < r.gap * 2.2) r.gap = lerp(r.gap, clamp(since, 0.03, 0.4), 0.07);           // average send interval, ignoring stalls
    const step = since > r.gap * 2.2 ? since : r.gap;                                      // a real stall keeps its true length; only wobble is smoothed away
    r.stamp = clamp(r.stamp + step + (T - r.stamp - step) * 0.05, T - 0.45, T + 0.12);     // steady step, creeping toward real arrival
  }
  r.lastArrive = T;
  r.buf.push({ t: r.stamp, x: d.x || 0, y: d.y || 0, z: d.z || 0, ry: d.ry || 0 }); if (r.buf.length > 12) r.buf.shift();
  r.data = d;
  if (r.rig.anim !== d.anim) { r.rig.setPose(d.anim || 'idle'); const fwd = new V3(Math.sin(d.ry || 0), 0, Math.cos(d.ry || 0)); if (d.anim === 'bump' || d.anim === 'set' || d.anim === 'block' || d.anim === 'spikeHit') setTimeout(() => actionFx(d.anim === 'spikeHit' ? 'spike' : d.anim, r.rig, fwd), 60); }
  const em = d.em || null; if (em !== r.rig.emote) { r.rig.emote = em; r.rig.emoteT = 0; if (!em) r.rig.pitchTarget = d.pt || 0; }
  r.rig.tiltX = d.tx || 0; r.rig.tiltZ = d.tz || 0; r.rig.pitchTarget = d.pt || 0; r.rig.rollTarget = d.rl || 0;
  r.tag.textContent = d.name || '?'; r.tag.classList.toggle('party', !!(S.party && S.party.members && S.party.members[sid]));
}
function remoteRemove(sid) { const r = remotes.get(sid); if (!r) return; scene.remove(r.rig.root); r.tag.remove(); if (r.mark) r.mark.remove(); remotes.delete(sid); }
function remotesClear() { for (const sid of Array.from(remotes.keys())) remoteRemove(sid); }
const INTERP_DELAY = 0.18;                       // default render delay for other players; each peer then adapts it to how steadily their packets arrive (see updateRemotes)
// cubic Hermite through the buffer: tangents come from the neighbouring samples, so speed carries across
// each sample instead of kinking at it (plain lerp changes direction every packet, which reads as chatter).
function hermite(a, b, o, n, s, h, key) {
  const va = (b[key] - o[key]) / Math.max(0.001, b.t - o.t), vb = (n[key] - a[key]) / Math.max(0.001, n.t - a.t);
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * a[key] + (s3 - 2 * s2 + s) * h * va + (-2 * s3 + 3 * s2) * b[key] + (s3 - s2) * h * vb;
}
function updateRemotes(dt) {
  for (const r of remotes.values()) {
    const buf = r.buf; if (!buf.length) continue;
    const want = clamp(r.gap * 1.5 + r.jit * 3 + 0.03, 0.12, 0.35); r.delay += (want - r.delay) * Math.min(1, dt * 0.5);   // steady senders get ~120 ms, jittery ones up to 350 ms; the delay itself drifts slowly so it never causes speed ripple
    const rt = T - r.delay; const p = r.rig.root.position; let px = p.x, pz = p.z;
    let tx, ty, tz, ry;
    if (buf.length === 1 || rt <= buf[0].t) { const a = buf[0]; tx = a.x; ty = a.y; tz = a.z; ry = a.ry; }
    else {
      let i = buf.length - 1; while (i > 0 && buf[i - 1].t > rt) i--;
      const a = buf[i - 1], b = buf[i];
      if (rt <= b.t) {
        const h = Math.max(0.001, b.t - a.t), f = (rt - a.t) / h, o = buf[i - 2] || a, n = buf[i + 1] || b;   // no neighbour = one-sided tangent, which is just the lerp
        tx = hermite(a, b, o, n, f, h, 'x'); ty = hermite(a, b, o, n, f, h, 'y'); tz = hermite(a, b, o, n, f, h, 'z');
        let dr = b.ry - a.ry; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); ry = a.ry + dr * f;
      }
      else { const span = Math.max(0.05, b.t - a.t), ex = clamp(rt - b.t, 0, 0.12); tx = b.x + (b.x - a.x) / span * ex; ty = b.y; tz = b.z + (b.z - a.z) / span * ex; ry = b.ry; }   // coast on the last known velocity while a packet is late, never freeze
    }
    const off = Math.hypot(tx - p.x, tz - p.z);
    if (r.ptx === null || off > 8) p.set(tx, ty, tz);                             // first frame, or a real teleport
    else {
      // ease onto the target, faster the further behind. Solved for a *moving* target, so the filter
      // settles to a constant lag instead of adding speed ripple every time a frame runs long or short.
      const a = 18 + Math.min(42, off * 14), e = Math.exp(-a * dt), inv = 1 / a;
      const ease = (cur, t1, t0) => { const v = clamp((t1 - t0) / Math.max(dt, 1e-4), -25, 25); return t1 - v * inv + (cur - t0 + v * inv) * e; };
      p.set(ease(p.x, tx, r.ptx), ease(p.y, ty, r.pty), ease(p.z, tz, r.ptz));
    }
    r.ptx = tx; r.pty = ty; r.ptz = tz;
    const k = 1 - Math.exp(-dt * 22);
    let dry = ry - r.rig.root.rotation.y; dry = Math.atan2(Math.sin(dry), Math.cos(dry)); ry = r.rig.root.rotation.y + dry * k;
    if (!r.wasAir && p.y > 0.25) { jumpFx(p.x, p.z, groundDustColor()); r.rig.impact(0.14); }
    if (r.wasAir && p.y < 0.05) r.rig.impact(-0.17);                            // other players squash on landing too
    r.wasAir = p.y > 0.05;
    if (p.y < 0.05 && r.speed > 1.5) { r.stepAcc = (r.stepAcc || 0) + dt; if (r.stepAcc > 0.16) { r.stepAcc = 0; puff(p.x, p.z, 2, 0.6, 0.8, groundDustColor()); } }
    r.rig.root.rotation.y = ry;
    r.speed = lerp(r.speed, Math.hypot(p.x - px, p.z - pz) / Math.max(dt, 0.001), Math.min(1, dt * 7));   // steadier speed = steadier run cycle
    r.rig.moveSpeed = r.rig.anim === 'idle' ? r.speed : 0;
    r.rig.update(dt, T);
  }
}
function myState() {
  return { name: me.name, id: me.id, team: S.scene === 'match' ? P.team : 'L', x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), ry: +P.ry.toFixed(2), anim: P.rig.anim, em: P.emote ? P.emote.id : '', tx: +P.tilt.x.toFixed(2), tz: +P.tilt.y.toFixed(2), pt: P.diveAnim ? P.diveAnim.pitch : 0, rl: P.diveAnim ? P.diveAnim.roll : 0, md: me.model || 'boy' };
}

/* ---------------- Tags / charge bar projection ---------------- */
const _v = new V3();
function projectTags() {
  const W = innerWidth, H = innerHeight;
  for (const [sid, r] of remotes) {
    _v.copy(r.rig.root.position); _v.y += 2.05; _v.project(camera);
    const vis = _v.z < 1 && _v.z > -1; r.tag.style.display = vis ? '' : 'none';
    if (vis) { const lx = Math.round((_v.x + 1) / 2 * W), ly = Math.round((1 - _v.y) / 2 * H); if (lx !== r.tagX || ly !== r.tagY) { r.tagX = lx; r.tagY = ly; r.tag.style.left = lx + 'px'; r.tag.style.top = ly + 'px'; } }   // only touch the DOM when the tag actually moves
    const near = vis && hasTrait('b4p2') && r.rig.root.position.distanceTo(P.pos) < 22;   // Setter Vision: a coloured square over everyone around you
    if (near) { if (!r.mark) { r.mark = document.createElement('div'); r.mark.className = 'vmark'; $('#tags').appendChild(r.mark); } const team = r.data && r.data.team; r.mark.style.background = S.scene === 'match' && team && team !== 'L' ? (team === P.team ? '#3b8ff0' : '#e5484d') : `hsl(${(r.hue = r.hue == null ? ([...r.name || sid].reduce((a, c) => a + c.charCodeAt(0), 0) * 37) % 360 : r.hue)},85%,55%)`; r.mark.style.left = r.tag.style.left; r.mark.style.top = (parseFloat(r.tag.style.top) - 22) + 'px'; r.mark.style.display = ''; }
    else if (r.mark) r.mark.style.display = 'none';
  }
  projectBubbles(W, H);
  const cb = $('#chargeBar');
  if (P.charging) { _v.copy(P.pos); _v.y += 1.2; _v.addScaledVector(cr(), 0.9); _v.project(camera); cb.style.left = ((_v.x + 1) / 2 * W) + 'px'; cb.style.top = ((1 - _v.y) / 2 * H) + 'px'; cb.querySelector('i').style.height = (P.charge * 100) + '%'; }
}

/* ---------------- Touch controls ----------------
   Left of the screen: a joystick that appears under your thumb (movement, air tilt, serve aim - the same
   axes the keyboard drives). Right of the screen: drag to look. Round buttons press the same key codes the
   keyboard would, so every mechanic (charge spikes, contextual set / spike / toss, bump / block, jump set /
   talk, dive, dash, emotes, practice-mode ball + serve) works unchanged. Buttons can be dragged anywhere in
   Menu > Touch controls > Edit layout; the layout is saved per device. */
const TOUCH = { on: false, x: 0, y: 0, edit: false, joyId: null, joyOrigin: null, lookId: null, lookLast: null, pressed: new Map(), layout: null, drag: null };
const TOUCH_DEFAULT = { jump: [30, 110], action: [130, 40], q: [40, 212], e: [140, 150], dive: [230, 60], dash: [230, 140], emote: [320, 26], lock: [320, 100], ball: [400, 26], serve: [470, 26] };   // [right, bottom] in px - fits a landscape phone (390 px tall)
function touchWanted() { let pref = 'auto'; try { pref = localStorage.getItem('vg_touch') || 'auto'; } catch (e) { } if (pref === 'on') return true; if (pref === 'off') return false; const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0; return touch && (matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile|CrOS.*Touch/i.test(navigator.userAgent)); }
function applyTouch(on) {
  TOUCH.on = on; $('#touchUi').classList.toggle('hidden', !on); document.body.classList.toggle('touch', on);
  if (!on) { TOUCH.x = TOUCH.y = 0; for (const [el, code] of TOUCH.pressed) { keys.delete(code); onRelease(code); } TOUCH.pressed.clear(); }
  if (on && document.pointerLockElement) document.exitPointerLock();
  layoutTouch();
}
function layoutTouch() {
  if (!TOUCH.layout) { try { TOUCH.layout = JSON.parse(localStorage.getItem('vg_touch_layout') || 'null'); } catch (e) { } if (!TOUCH.layout) TOUCH.layout = Object.assign({}, TOUCH_DEFAULT); }
  $$('#touchUi .tbtn').forEach(b => { const p = TOUCH.layout[b.dataset.act] || TOUCH_DEFAULT[b.dataset.act]; const sz = b.classList.contains('big') ? 84 : 64; b.style.right = clamp(p[0], 0, Math.max(0, innerWidth - sz)) + 'px'; b.style.bottom = clamp(p[1], 0, Math.max(0, innerHeight - sz)) + 'px'; });   // kept on screen whatever the screen size
}
function touchCode(act) {                        // the key each button presses, decided at press time so the contextual ones match what the keyboard would do
  switch (act) {
    case 'jump': return KEYS.jump;
    case 'action': return P.holding ? KEYS.toss : P.onGround ? KEYS.groundSet : KEYS.spike;
    case 'q': return P.onGround ? KEYS.bump : KEYS.block;
    case 'e': return P.onGround ? KEYS.interact : KEYS.jumpSet;
    case 'dive': return KEYS.dive; case 'dash': return KEYS.ability; case 'emote': return KEYS.emote; case 'ball': return KEYS.spawnBall; case 'serve': return KEYS.serve;
  } return null;
}
function updateTouchLabels() {                   // labels follow the situation, like the action cards do
  if (!TOUCH.on) return;
  const ground = P.onGround, hold = P.holding, spawn = canSpawnHere();
  const near = nearNPC() || nearNPC2() || nearNPC3();
  const set = (act, text, show = true, dim = false) => { const b = $(`#touchUi .tbtn[data-act="${act}"]`); if (!b) return; if (!TOUCH.edit) b.style.display = show ? '' : 'none'; if (b.dataset.txt !== text) { b.dataset.txt = text; b.textContent = text; } b.classList.toggle('dim', dim && !TOUCH.edit); };
  set('action', hold ? 'TOSS' : ground ? 'SET' : 'SPIKE');
  set('q', ground ? 'BUMP' : 'BLOCK');
  set('e', ground ? (near ? 'TALK' : 'JUMP SET') : 'JUMP SET', true, ground && !near);
  set('dive', 'DIVE', true, !ground);
  const dash = hasTrait('b3a'); const cd = Math.max(0, (P.dashReady || 0) - T); set('dash', cd > 0 ? cd.toFixed(1) : 'DASH', dash, cd > 0);
  set('ball', 'BALL', spawn); set('serve', 'SERVE', spawn);
  set('jump', 'JUMP', true, !ground); set('emote', 'EMOTE'); set('lock', 'LOCK'); const lb = $('#touchUi .tbtn[data-act="lock"]'); if (lb) lb.classList.toggle('on', shiftLock);
}
(function initTouch() {
  const ui = $('#touchUi'); if (!ui) return;
  const joyZone = $('#joyZone'), lookZone = $('#lookZone'), joy = $('#joy'), knob = $('#joyKnob');
  const R = 46;
  const joyMove = (t) => { const dx = t.clientX - TOUCH.joyOrigin.x, dy = t.clientY - TOUCH.joyOrigin.y; const d = Math.hypot(dx, dy), k = d > R ? R / d : 1; TOUCH.x = dx * k / R; TOUCH.y = -dy * k / R; knob.style.transform = `translate(${dx * k}px,${dy * k}px)`; };
  joyZone.addEventListener('touchstart', e => { e.preventDefault(); if (TOUCH.joyId !== null || wheelOpen) return; const t = e.changedTouches[0]; TOUCH.joyId = t.identifier; TOUCH.joyOrigin = { x: t.clientX, y: t.clientY }; joy.style.left = t.clientX + 'px'; joy.style.top = t.clientY + 'px'; joy.style.display = 'block'; knob.style.transform = ''; }, { passive: false });
  const joyEnd = e => { for (const t of e.changedTouches) if (t.identifier === TOUCH.joyId) { TOUCH.joyId = null; TOUCH.x = TOUCH.y = 0; joy.style.display = 'none'; } };
  joyZone.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === TOUCH.joyId) joyMove(t); }, { passive: false });
  joyZone.addEventListener('touchend', joyEnd); joyZone.addEventListener('touchcancel', joyEnd);
  lookZone.addEventListener('touchstart', e => { e.preventDefault(); if (TOUCH.lookId !== null || wheelOpen) return; const t = e.changedTouches[0]; TOUCH.lookId = t.identifier; TOUCH.lookLast = { x: t.clientX, y: t.clientY }; }, { passive: false });
  lookZone.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === TOUCH.lookId) { const k = 3.4 / Math.max(480, innerWidth); camYaw -= (t.clientX - TOUCH.lookLast.x) * k; camPitch = clamp(camPitch + (t.clientY - TOUCH.lookLast.y) * k, -0.35, 1.25); TOUCH.lookLast = { x: t.clientX, y: t.clientY }; } }, { passive: false });
  const lookEnd = e => { for (const t of e.changedTouches) if (t.identifier === TOUCH.lookId) TOUCH.lookId = null; };
  lookZone.addEventListener('touchend', lookEnd); lookZone.addEventListener('touchcancel', lookEnd);
  // buttons: press / release the mapped key; in edit mode they drag instead
  for (const b of $$('#touchUi .tbtn')) {
    const press = e => {
      e.preventDefault(); e.stopPropagation();
      if (TOUCH.edit) { const t = e.touches ? e.touches[0] : e; const r = b.getBoundingClientRect(); TOUCH.drag = { b, dx: r.right - t.clientX, dy: r.bottom - t.clientY }; return; }
      if (uiOpen()) return;
      if (b.dataset.act === 'lock') { toggleShiftLock(); return; }                        // camera lock: the character faces where you look
      const code = touchCode(b.dataset.act); if (!code) return;
      if (b.dataset.act === 'emote' && e.changedTouches) wheelOpenTouch = e.changedTouches[0].identifier;
      TOUCH.pressed.set(b, code); b.classList.add('on'); if (!keys.has(code)) { keys.add(code); onPress(code); }
    };
    const release = e => {
      e.preventDefault(); e.stopPropagation(); b.classList.remove('on');
      const code = TOUCH.pressed.get(b); if (code === undefined) return; TOUCH.pressed.delete(b);
      if (keys.has(code)) { keys.delete(code); onRelease(code); }
    };
    b.addEventListener('touchstart', press, { passive: false }); b.addEventListener('touchend', release); b.addEventListener('touchcancel', release);
    b.addEventListener('mousedown', press); b.addEventListener('mouseup', release); b.addEventListener('mouseleave', e => { if (TOUCH.pressed.has(b)) release(e); });
  }
  const dragMove = e => { const d = TOUCH.drag; if (!d) return; const t = e.touches ? e.touches[0] : e; const right = clamp(innerWidth - t.clientX - d.dx, 0, innerWidth - 64), bottom = clamp(innerHeight - t.clientY - d.dy, 0, innerHeight - 64); d.b.style.right = right + 'px'; d.b.style.bottom = bottom + 'px'; TOUCH.layout[d.b.dataset.act] = [Math.round(right), Math.round(bottom)]; e.preventDefault(); };
  const dragEnd = () => { TOUCH.drag = null; };
  document.addEventListener('touchmove', dragMove, { passive: false }); document.addEventListener('touchend', dragEnd); document.addEventListener('mousemove', dragMove); document.addEventListener('mouseup', dragEnd);
  $('#touchEditDone').onclick = () => { TOUCH.edit = false; ui.classList.remove('edit'); $('#touchEdit').classList.add('hidden'); try { localStorage.setItem('vg_touch_layout', JSON.stringify(TOUCH.layout)); } catch (e) { } toast('Touch layout saved', 'ok'); };
  $('#touchEditReset').onclick = () => { TOUCH.layout = Object.assign({}, TOUCH_DEFAULT); layoutTouch(); };
  $('#touchEditBtn').onclick = () => { closePanels(); if (!TOUCH.on) applyTouch(true); TOUCH.edit = true; ui.classList.add('edit'); $('#touchEdit').classList.remove('hidden'); $$('#touchUi .tbtn').forEach(b => { b.style.display = ''; }); };
  $('#touchSel').onchange = () => { try { localStorage.setItem('vg_touch', $('#touchSel').value); } catch (e) { } applyTouch(touchWanted()); };
  try { $('#touchSel').value = localStorage.getItem('vg_touch') || 'auto'; } catch (e) { }
  canvas.addEventListener('touchstart', e => { if (TOUCH.on) e.preventDefault(); }, { passive: false });   // no synthetic mouse clicks from stray touches on the canvas
  addEventListener('resize', () => { if (TOUCH.on) layoutTouch(); });
})();

/* ---------------- Chat bubbles over heads ---------------- */
const BUBBLES = new Map();                   // sid -> { el, items: [{ text, until }] }; newest at the bottom, older ones stack upward
const BUBBLE_MS = 6000, BUBBLE_MAX = 4;
function addBubble(sid, text) {
  if (!sid || !text) return;
  let b = BUBBLES.get(sid);
  if (!b) { b = { el: document.createElement('div'), items: [] }; b.el.className = 'bubbles'; $('#tags').appendChild(b.el); BUBBLES.set(sid, b); }
  b.items.push({ text, until: performance.now() + BUBBLE_MS }); while (b.items.length > BUBBLE_MAX) b.items.shift();
  const d = document.createElement('div'); d.className = 'bub'; d.textContent = text; b.el.appendChild(d); while (b.el.children.length > BUBBLE_MAX) b.el.firstChild.remove();
}
function projectBubbles(W, H) {
  const now = performance.now();
  for (const [sid, b] of BUBBLES) {
    while (b.items.length && b.items[0].until < now) { b.items.shift(); const c = b.el.querySelector('.bub:not(.fade)'); if (c) { c.classList.add('fade'); setTimeout(() => c.remove(), 400); } }   // oldest not-yet-fading bubble goes
    if (!b.items.length && !b.el.children.length) { b.el.remove(); BUBBLES.delete(sid); continue; }
    let pos = null; if (sid === SID) pos = P.pos; else { const r = remotes.get(sid); if (r) pos = r.rig.root.position; }
    if (!pos) { b.el.style.display = 'none'; continue; }
    _v.copy(pos); _v.y += 2.3; _v.project(camera);
    const vis = _v.z < 1 && _v.z > -1; b.el.style.display = vis ? '' : 'none';
    if (vis) { b.el.style.left = ((_v.x + 1) / 2 * W) + 'px'; b.el.style.top = ((1 - _v.y) / 2 * H) + 'px'; }
  }
}
function sidForName(n) { for (const [sid, r] of remotes) if ((r.data && r.data.name) === n) return sid; return n === me.name ? SID : null; }

/* ---------------- Camera ---------------- */
const camRay = new THREE.Raycaster();
let impactTimer = 0;
function impactFrame(x, z, frames = 1) {        // impact frames for players near an effect: black/blue + white for a moment, then a white flash
  if (ULTRA) return;
  const dist = Math.hypot(P.pos.x - x, P.pos.z - z); if (dist > 24 || FX_WARMING) return;
  clearTimeout(impactTimer);
  canvas.classList.add('impact');
  const fl = $('#impactFlash'); fl.style.transition = 'none'; fl.style.opacity = '0';
  impactTimer = setTimeout(() => {
    canvas.classList.remove('impact');
    fl.style.transition = 'none'; fl.style.opacity = dist < 6 ? '1' : '0.7';
    requestAnimationFrame(() => { fl.style.transition = 'opacity .22s ease-out'; fl.style.opacity = '0'; });
  }, 40 * frames);
}
let LOBBY_COLL = [], COURT_COLL = [];
let FOV_BASE = 70;                                   // the player's own FOV setting; the lens effects below ride on top of it
let camFovK = 0, camShake = 0, camFovCur = FOV_BASE;
const camLook = new V3(); let camLookInit = false;
/* A short lens + positional punch. `fov` is in kick units (1.0 ~ 26 degrees, so the values passed in are
   small); `shake` decays over roughly a fifth of a second. Jumps, landings, spikes and score effects use it. */
function camKick(fov, shake) { camFovK = clamp(camFovK + fov, -0.45, 0.45); camShake = Math.min(0.6, camShake + shake * 0.03); }
function updateCamera(dt) {
  const f = camF();
  const target = P.pos.clone().add(new V3(0, 1.5, 0));                     // shift lock keeps the character centered
  target.x += clamp(P.vel.x, -9, 9) * 0.03; target.z += clamp(P.vel.z, -9, 9) * 0.03;   // lead the player slightly in the direction of travel
  if (!camLookInit) { camLook.copy(target); camLookInit = true; }
  camLook.lerp(target, smoothT(34, dt));
  const off = f.clone().multiplyScalar(-camDist * Math.cos(camPitch)).add(new V3(0, camDist * Math.sin(camPitch), 0));
  const fl = S.scene === 'lobby' ? groundHeight(P.pos.x, P.pos.z, P.pos.y) : 0;   // the floor you are on (second floor included)
  const pos = camLook.clone().add(off); pos.y = clamp(pos.y, fl + 0.3, S.scene === 'lobby' && indoors(P.pos.x, P.pos.z) ? fl + (fl > 1 ? F2H - 0.5 : 4.6) : (S.match && S.match.map === 'beach' ? 40 : 10.5));
  const dirC = pos.clone().sub(camLook); const len = dirC.length(); dirC.normalize();
  camRay.set(camLook, dirC); camRay.far = len;
  const hits = camRay.intersectObjects(S.scene === 'lobby' ? LOBBY_COLL : (S.match && S.match.map === 'beach' ? [] : COURT_COLL), false);
  if (hits.length) pos.copy(camLook).addScaledVector(dirC, Math.max(0.6, hits[0].distance - 0.35));
  camera.position.lerp(pos, smoothT(hits.length ? 60 : 28, dt));            // frame-rate independent: the old per-frame lerp ran twice as fast on a 120 Hz screen
  camera.lookAt(camLook.clone().add(f.multiplyScalar(1.5)));
  // ---- lens: speed widens the view, impacts punch it; a decaying shake rides on top ----
  camFovK *= Math.exp(-dt * 7); camShake *= Math.exp(-dt * 9);
  const sp = Math.hypot(P.vel.x, P.vel.z);
  const fovT = FOV_BASE + clamp((sp - 6.6) / 38, 0, 1) * 11 + camFovK * 26;
  camFovCur = lerp(camFovCur, fovT, smoothT(10, dt));
  if (Math.abs(camera.fov - camFovCur) > 0.01) { camera.fov = camFovCur; camera.updateProjectionMatrix(); }
  if (camShake > 0.002) { const st = performance.now() * 0.001; camera.position.x += Math.sin(st * 47) * camShake * 0.1; camera.position.y += Math.sin(st * 61 + 1.7) * camShake * 0.1; camera.position.z += Math.sin(st * 53 + 3.1) * camShake * 0.08; }
  sun.target.position.copy(P.pos); sun.position.copy(P.pos).addScaledVector(SUN_DIR, 40);
  sunMesh.position.copy(camera.position).addScaledVector(SUN_DIR, 230);
  moonMesh.position.copy(camera.position).addScaledVector(SUN_DIR, 230); moonMesh.lookAt(camera.position);   // cratered face and halo both turned toward the player
  if (sky) sky.position.copy(camera.position);
  const outside = S.scene === 'lobby' || (S.match && S.match.map === 'beach'); sunMesh.visible = !isNight && outside; moonMesh.visible = isNight && outside;
  if (sky) sky.visible = outside;
}

/* ---------------- Action cards ---------------- */
const CARD_SETS = {
  ground: [['bump', 'BUMP', 'bump'], ['groundSet', 'SET', 'set'], ['dive', 'DIVE', 'dive']],
  air: [['block', 'BLOCK', 'block'], ['jumpSet', 'JUMP SET', 'set'], ['spike', 'SPIKE', 'spikeHit', true]],
  dash: ['ability', 'DASH', 'dash'],           // added to the right of the ground / air sets while the Dash trait is equipped
  hold: [['toss', 'TOSS', 'toss']],
};
let cardSig = '', utilSig = '';
function cardHtml(act, label, pose, hold, cd = 0) { return `<div class="card${hold ? ' hold' : ''}"><img src="${ICONS[pose] || ''}" alt=""><div class="key">${keyName(KEYS[act])}</div>${cd > 0 ? `<div class="cdov" style="height:${Math.min(100, cd / 4 * 100).toFixed(0)}%"></div><div class="cdt">${cd.toFixed(1)}</div>` : ''}<div class="lbl">${label}</div></div>`; }
function updateCards() {
  const set = P.holding ? 'hold' : P.onGround ? 'ground' : 'air';
  const dash = set !== 'hold' && hasTrait('b3a'); const dcd = dash ? Math.max(0, (P.dashReady || 0) - T) : 0;
  const sig = set + '|' + CARD_SETS[set].map(c => KEYS[c[0]]).join(',') + (dash ? '|D' + KEYS.ability + ':' + Math.ceil(dcd * 10) : '');
  if (sig !== cardSig) { cardSig = sig; $('#actions').innerHTML = CARD_SETS[set].map(c => cardHtml(...c)).join('') + (dash ? cardHtml(...CARD_SETS.dash, false, dcd) : ''); }
  updateTouchLabels();
  // spawn / serve cards in practice and outside on the beach
  const show = (S.match && S.match.practice) || (S.scene === 'lobby' && !indoors(P.pos.x, P.pos.z));
  const usig = (show ? 1 : 0) + '|' + KEYS.spawnBall + KEYS.serve;
  if (usig !== utilSig) { utilSig = usig; $('#utilCards').classList.toggle('hidden', !show); $('#utilCards').innerHTML = show ? cardHtml('spawnBall', 'SPAWN BALL', 'ball') + cardHtml('serve', 'SERVE', 'ball') : ''; }
}

/* ---------------- Lil Man Dealer (NPC) + shop ---------------- */
function nearNPC() { return S.scene === 'lobby' && Math.hypot(P.pos.x - NPC_POS.x, P.pos.z - NPC_POS.z) < 4.2; }
function nearNPC2() { return S.scene === 'lobby' && !nearNPC() && Math.abs(P.pos.y - NPC2_POS.y) < 2 && Math.hypot(P.pos.x - NPC2_POS.x, P.pos.z - NPC2_POS.z) < 3.4; }
function nearNPC3() { return S.scene === 'lobby' && Math.hypot(P.pos.x - NPC3_POS.x, P.pos.z - NPC3_POS.z) < 3.2; }
const NPCS = [{ name: 'Lil Man Dealer', pos: NPC_POS, tagY: 1.75, promptY: 2.15, near: nearNPC, tag: null }, { name: 'Big Man Dealer', pos: NPC2_POS, tagY: 1.75, promptY: 2.1, near: nearNPC2, tag: null }, { name: 'Lil Woman Dealer', pos: NPC3_POS, tagY: 1.75, promptY: 2.1, near: nearNPC3, tag: null }];
function projectNpc() {
  const el = $('#npcPrompt'); let prompted = false;
  for (const n of NPCS) {
    if (!n.tag) { n.tag = document.createElement('div'); n.tag.className = 'tag'; n.tag.textContent = n.name; $('#tags').appendChild(n.tag); }
    const showTag = S.scene === 'lobby' && P.pos.distanceTo(n.pos) < 30 && Math.abs(P.pos.y - n.pos.y) < 3;   // only on your own floor
    n.tag.style.display = showTag ? '' : 'none';
    if (showTag) { _v.copy(n.pos); _v.y += n.tagY; _v.project(camera); const vis = _v.z < 1; n.tag.style.display = vis ? '' : 'none'; n.tag.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; n.tag.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px'; }
    if (!prompted && n.near() && !uiOpen()) {
      prompted = true; el.classList.remove('hidden'); el.querySelector('b').textContent = keyName(KEYS.interact);
      _v.copy(n.pos); _v.y += n.promptY; _v.project(camera);
      el.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px';
    }
  }
  if (!prompted) el.classList.add('hidden');
}
let shopTab = 'skins', shopDealer = 'lil';
const DEALER_TABS = { lil: ['skins', 'models', 'fx'], woman: ['emotes'] };   // Lil Man sells balls / characters / score effects; Lil Woman sells emotes
const SHOP_KINDS = {
  skins:  { items: SKINS, icon: 'skin_', owned: () => me.skins, cur: () => me.skin, def: 'default', ownedKey: 'skins', curKey: 'skin', note: 'Ball skins. Same size, same hitbox - looks only.' },
  models: { items: MODELS, icon: 'model_', owned: () => me.models, cur: () => me.model, def: 'boy', ownedKey: 'models', curKey: 'model', note: 'Characters. Pick who you play as.' },
  fx:     { items: FXS, icon: 'fx_', owned: () => me.fxs, cur: () => me.fx, def: 'none', ownedKey: 'fxs', curKey: 'fx', note: 'Score effects play where a ball you hit lands in on the other side of the net.' },
  emotes: { items: EMOTES, icon: 'emote_', owned: () => me.emotes, cur: () => null, def: null, ownedKey: 'emotes', curKey: null, note: 'Emotes. Equipped emotes go on your emote wheel (8 slots) - open it with ' + 'the Emote Wheel key.', multi: true },
};
$$('#shopPanel .tabs button').forEach(b => b.onclick = () => { shopTab = b.dataset.tab; renderShop(); });
function openShop(dealer = 'lil') { shopDealer = dealer; if (!DEALER_TABS[dealer].includes(shopTab)) shopTab = DEALER_TABS[dealer][0]; $('#shopTitle').textContent = dealer === 'woman' ? 'Lil Woman Dealer' : 'Lil Man Dealer'; openPanel('#shopPanel'); renderShop(); }
function renderShop() {
  $('#shopMoney').textContent = me.guest ? 'Sign in to buy' : '$' + (me.dollars || 0).toLocaleString();
  $$('#shopPanel .tabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === shopTab); b.classList.toggle('hidden', !DEALER_TABS[shopDealer].includes(b.dataset.tab)); });
  const K = SHOP_KINDS[shopTab]; $('#shopNote').textContent = K.note;
  const grid = $('#shopGrid'); grid.innerHTML = '';
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
  if (me.guest) { toast('Sign in to buy', 'err'); return; }
  const K = SHOP_KINDS[kind]; const price = K.items[id].price;
  const res = await db.ref('profiles/' + me.id).transaction(pr => { if (!pr) return pr; if ((pr.dollars || 0) < price) return; pr.dollars = (pr.dollars || 0) - price; pr[K.ownedKey] = pr[K.ownedKey] || {}; pr[K.ownedKey][id] = true; if (K.curKey) pr[K.curKey] = id; else { pr.wheel = pr.wheel || {}; for (let i = 0; i < 8; i++) if (!pr.wheel[i]) { pr.wheel[i] = id; break; } } return pr; });
  if (!res.committed) { toast(`Not enough dollars ($${price.toLocaleString()} needed)`, 'err'); return; }
  toast('Bought ' + K.items[id].name + '!', 'ok');
}
function equipItem(kind, id) {
  const K = SHOP_KINDS[kind];
  if (me.guest) { if (K.items[id].price > 0) { toast('Sign in to buy', 'err'); return; } if (kind === 'skins') me.skin = id; else if (kind === 'models') me.model = id; else me.fx = id; onCosmeticsChanged(); renderShop(); return; }
  db.ref('profiles/' + me.id + '/' + K.curKey).set(id);
}

/* ---------------- Big Man Dealer: trait boxes ---------------- */
// Every box holds 3 cards: 2 passives (blue) + 1 ability (red). Pull odds are the same for every box: 45 / 45 / 10.
// All three boxes' traits are live (see hasTrait uses).
const TRAITS = {
  b1p1: { name: 'Quick Feet', type: 'passive', sym: 'QF', desc: '10% faster movement.' },
  b1p2: { name: 'Fake Block', type: 'passive', sym: 'FB', desc: 'Your block tilts are reversed: S acts like W and W like S.' },
  b1a:  { name: 'Lightning Drop', type: 'ability', sym: 'LD', desc: 'Tips rocket 3 m up, then slam straight down under heavy gravity.' },
  b2p1: { name: 'Spike Startup', type: 'passive', sym: 'SS', desc: 'Your spike charge bar starts at 25%.' },
  b2p2: { name: '4th Tempo', type: 'passive', sym: '4T', desc: 'Ground sets float higher with less gravity and carry further in the direction you run.' },
  b2a:  { name: 'Double Spike', type: 'ability', sym: 'DS', desc: 'Whiff a spike mid-air and you get one more swing - a spike only: instantly full charge, 1.2x power, lightning on contact.' },
  b3p1: { name: 'King Serve', type: 'passive', sym: 'KS', desc: '10% more serve power.' },
  b3p2: { name: 'Power Jump', type: 'passive', sym: 'PJ', desc: '20% more jump height, with 10% more gravity on the way down.' },
  b4p1: { name: 'Speed Set', type: 'passive', sym: 'SP', desc: 'Your sets leave with 2x the horizontal speed and 1.2x the height.' },
  b4p2: { name: 'Setter Vision', type: 'passive', sym: 'SV', desc: 'You fall at 0.7x gravity, and every player near you gets a coloured marker over their head.' },
  b4a:  { name: 'Perfect Set', type: 'ability', sym: 'PS', desc: 'Sets aimed at the nearest net leave 3x faster, climb to just above the antennas and decay to a third of their speed as they reach the net.' },
  b3a:  { name: 'Dash', type: 'ability', sym: 'DA', desc: 'Press your Ability key to dash (4 s cooldown). It kills all your momentum and refreshes your action the moment you dash, your next spike starts three-quarters charged, and in the air you then glide the way you were tilting.' },
};
const TRAIT_BOXES = {
  1: { name: 'Trait Box 1', price: 1000, traits: ['b1p1', 'b1p2', 'b1a'] },
  2: { name: 'Trait Box 2', price: 2000, traits: ['b2p1', 'b2p2', 'b2a'] },
  3: { name: 'Trait Box 3', price: 5000, traits: ['b3p1', 'b3p2', 'b3a'] },
  4: { name: 'Setter Crate', price: 3000, traits: ['b4p1', 'b4p2', 'b4a'] },
};
const BOX_ODDS = [0.45, 0.45, 0.1];
function rollBox(tier) { const r = Math.random(); let acc = 0; for (let i = 0; i < BOX_ODDS.length; i++) { acc += BOX_ODDS[i]; if (r < acc) return TRAIT_BOXES[tier].traits[i]; } return TRAIT_BOXES[tier].traits[2]; }
function traitCardHtml(tid, cls = '', extra = '') {
  const t = TRAITS[tid]; if (!t) return '';
  return `<div class="tcard ${t.type === 'ability' ? 'abl' : 'pas'} ${cls}"><div class="ty">${t.type}</div><div class="sym">${t.sym}</div><div class="tn">${t.name}</div><div class="td">${t.desc}</div>${extra}</div>`;
}
function openTraitShop() { openPanel('#traitPanel'); renderTraitShop(); }
function renderTraitShop() {
  $('#traitMoney').textContent = me.guest ? 'Sign in to buy' : '$' + (me.dollars || 0).toLocaleString();
  const grid = $('#traitGrid'); grid.innerHTML = '';
  for (const tier of [1, 2, 3, 4]) {
    const bx = TRAIT_BOXES[tier]; const d = document.createElement('div'); d.className = 'item tier' + tier;
    d.innerHTML = `<img src="${ICONS['box_' + tier] || ''}" alt=""><div class="nm">${bx.name}</div><div class="rar">${['', 'bronze box', 'silver box', 'gold box', 'setter crate'][tier]}</div><div class="pr">$${bx.price.toLocaleString()}</div><button>BUY</button>`;
    d.querySelector('button').onclick = () => buyBox(tier);
    d.onmouseenter = () => peekBox(tier);
    grid.appendChild(d);
  }
}
function peekBox(tier) {
  const bx = TRAIT_BOXES[tier]; $('#traitPeekTitle').textContent = 'Inside ' + bx.name;
  $('#traitPeekCards').innerHTML = bx.traits.map((tid, i) => traitCardHtml(tid, 'mini', `<div class="odds">${Math.round(BOX_ODDS[i] * 100)}%</div>`)).join('');
}
async function buyBox(tier) {
  if (me.guest) { toast('Sign in to buy', 'err'); return; }
  const bx = TRAIT_BOXES[tier]; const key = 'b' + Date.now().toString(36) + rnd();          // every box is its own item - they never stack
  const res = await db.ref('profiles/' + me.id).transaction(pr => { if (!pr) return pr; if ((pr.dollars || 0) < bx.price) return; pr.dollars = (pr.dollars || 0) - bx.price; pr.boxes = pr.boxes || {}; pr.boxes[key] = { tier, t: Date.now() }; return pr; });
  if (!res.committed) { toast(`Not enough dollars ($${bx.price.toLocaleString()} needed)`, 'err'); return; }
  toast('Bought ' + bx.name + ' - open it in your Inventory', 'ok');
}

function hasTrait(id) { const lo = me.loadout || {}, own = me.traits || {}; return ['p1', 'p2', 'a'].some(s => lo[s] && own[lo[s]] && own[lo[s]].id === id); }   // is this trait in an equipped slot?
/* ---------------- Inventory ---------------- */
let invTab = 'skins', invSel = null;
$$('#invNav button').forEach(b => b.onclick = () => { invTab = b.dataset.inv; invSel = null; renderInventory(); });
function openInventory(tab) { if (tab) { invTab = tab; invSel = null; } openPanel('#invPanel'); renderInventory(); }
function renderInventory() {
  $('#invMoney').textContent = me.guest ? 'Guest' : '$' + (me.dollars || 0).toLocaleString();
  $$('#invNav button').forEach(b => b.classList.toggle('on', b.dataset.inv === invTab));
  const traits = invTab === 'traits';
  $('#invMain').classList.toggle('hidden', traits); $('#invTraits').classList.toggle('hidden', !traits);
  if (traits) { renderTraitsTab(); return; }
  const K = SHOP_KINDS[invTab]; const ownedMap = K.owned() || {}; const cur = K.cur(); const onWheel = K.multi ? wheelSlots() : [];
  const ids = Object.keys(K.items).filter(id => !K.items[id].price || ownedMap[id]).sort((a, b) => (RARITY_ORDER[K.items[a].rarity] - RARITY_ORDER[K.items[b].rarity]) || (K.items[a].price - K.items[b].price));
  const grid = $('#invGrid'); grid.innerHTML = '';
  if (!ids.length) grid.innerHTML = `<div id="invEmpty">Nothing here yet - visit ${invTab === 'emotes' ? 'Lil Woman Dealer in the hut on the pier' : 'Lil Man Dealer'}.</div>`;
  if (invSel && !ids.includes(invSel)) invSel = null;
  if (!invSel) invSel = ids.find(id => K.multi ? onWheel.includes(id) : cur === id) || ids[0] || null;
  for (const id of ids) {
    const it = K.items[id]; const eq = K.multi ? onWheel.includes(id) : cur === id;
    const d = document.createElement('div'); d.className = 'tile b-' + it.rarity + (id === invSel ? ' sel' : '');
    d.innerHTML = `<img src="${ICONS[K.icon + id] || ''}" alt="">${eq ? '<div class="eqp">EQUIPPED</div>' : ''}`;
    d.title = it.name; d.onclick = () => { invSel = id; renderInventory(); };
    grid.appendChild(d);
  }
  const det = $('#invDetail'); det.classList.toggle('none', !invSel);
  if (!invSel) { det.innerHTML = 'Select an item'; return; }
  const it = K.items[invSel]; const eq = K.multi ? onWheel.includes(invSel) : cur === invSel;
  const src = it.price ? `Bought from ${invTab === 'emotes' ? 'Lil Woman Dealer' : 'Lil Man Dealer'} for $${it.price.toLocaleString()}` : 'Free for everyone';
  det.innerHTML = `<div class="nm">${it.name}</div><img src="${ICONS[K.icon + invSel] || ''}" alt=""><div class="rar r-${it.rarity}">${it.rarity}</div><div class="desc">${src}</div><button class="btn ${eq ? 'red' : 'green'}">${K.multi ? (eq ? 'REMOVE FROM WHEEL' : 'ADD TO WHEEL') : (eq ? (invSel === K.def ? 'EQUIPPED' : 'UNEQUIP') : 'EQUIP')}</button>`;
  const btn = det.querySelector('button'); if (!K.multi && eq && invSel === K.def) btn.disabled = true;
  btn.onclick = () => K.multi ? equipEmote(invSel) : equipItem(invTab, eq ? K.def : invSel);
}
function onInventoryChanged() { if (!$('#invPanel').classList.contains('hidden')) renderInventory(); }
function renderTraitsTab() {
  const lo = me.loadout || {}; const own = me.traits || {}; const boxes = me.boxes || {};
  const slot = (key, type, label) => {
    const tr = key && own[key] && TRAITS[own[key].id] ? own[key] : null;
    if (tr) { const t = TRAITS[tr.id]; return `<div class="tcard slot ${type === 'ability' ? 'abl' : 'pas'}" data-slot="${label}" title="Click to unequip"><div class="ty">${t.type}</div><div class="sym">${t.sym}</div><div class="tn">${t.name}</div><div class="td">${t.desc}</div></div>`; }
    return `<div class="tcard slot empty ${type === 'ability' ? 'abl' : 'pas'}"><div class="tn">${type === 'ability' ? 'Ability' : 'Passive'}</div><div class="td">empty slot</div></div>`;
  };
  $('#loadout').innerHTML = slot(lo.p1, 'passive', 'p1') + slot(lo.p2, 'passive', 'p2') + slot(lo.a, 'ability', 'a');
  $$('#loadout .slot[data-slot]').forEach(el => el.onclick = () => unequipTrait(el.dataset.slot));
  const bag = $('#invBag'); bag.innerHTML = '';
  if (me.guest) { bag.innerHTML = '<div id="invEmpty">Sign in to collect traits.</div>'; return; }
  const equipped = new Set([lo.p1, lo.p2, lo.a].filter(Boolean));
  const boxKeys = Object.keys(boxes).sort((a, b) => (boxes[a].t || 0) - (boxes[b].t || 0));
  for (const k of boxKeys) {
    const bx = TRAIT_BOXES[boxes[k].tier]; if (!bx) continue;
    const d = document.createElement('div'); d.className = 'bag-box tier' + boxes[k].tier;
    d.innerHTML = `<img src="${ICONS['box_' + boxes[k].tier] || ''}" alt=""><div class="tn">${bx.name}</div><button>OPEN</button>`;
    d.querySelector('button').onclick = () => openBox(k); bag.appendChild(d);
  }
  const trKeys = Object.keys(own).filter(k => !equipped.has(k) && TRAITS[own[k].id]).sort((a, b) => (own[a].t || 0) - (own[b].t || 0));
  for (const k of trKeys) {
    const w = document.createElement('div'); w.innerHTML = traitCardHtml(own[k].id, 'mini', '<button>EQUIP</button><button class="del" title="Delete this trait">X</button>');
    const d = w.firstChild; const [eqB, delB] = d.querySelectorAll('button'); eqB.onclick = (e) => { e.stopPropagation(); equipTrait(k); }; delB.onclick = (e) => { e.stopPropagation(); deleteTrait(k); }; bag.appendChild(d);
  }
  if (!boxKeys.length && !trKeys.length) bag.innerHTML = '<div id="invEmpty">No traits or boxes yet - Big Man Dealer sells trait boxes upstairs.</div>';
}
function equipTrait(key) {
  const tr = (me.traits || {})[key]; if (!tr || !TRAITS[tr.id]) return;
  const T = TRAITS[tr.id]; const lo = Object.assign({}, me.loadout || {}); const own = me.traits;
  if (T.type === 'ability') lo.a = key;
  else if (!lo.p1 || !own[lo.p1]) lo.p1 = key;
  else if (!lo.p2 || !own[lo.p2]) lo.p2 = key;
  else { toast('Both passive slots are full - unequip one first', 'err'); return; }
  db.ref('profiles/' + me.id + '/loadout').set(lo);
}
function traitRefund(tid) { for (const t in TRAIT_BOXES) if (TRAIT_BOXES[t].traits.includes(tid)) return Math.floor(TRAIT_BOXES[t].price / 2); return 0; }   // deleting a trait pays back half of its box
async function deleteTrait(key) {
  const tr = (me.traits || {})[key]; if (!tr || me.guest) return; const T = TRAITS[tr.id]; if (!T) return;
  const refund = traitRefund(tr.id);
  if (!await confirmDialog('Delete ' + T.name + '?', 'This ' + T.type + ' trait will be gone for good. You get $' + refund.toLocaleString() + ' back (half the box price).')) return;
  const res = await db.ref('profiles/' + me.id).transaction(pr => {
    if (!pr) return pr; if (!pr.traits || !pr.traits[key]) return;                 // already gone (double click / other tab)
    pr.traits[key] = null; pr.dollars = (pr.dollars || 0) + refund;
    if (pr.loadout) for (const s of ['p1', 'p2', 'a']) if (pr.loadout[s] === key) pr.loadout[s] = null;   // pull it out of the loadout too, just in case
    return pr;
  });
  if (!res.committed) { toast('That trait is already gone', 'err'); return; }
  toast('Deleted ' + T.name + ' - +$' + refund.toLocaleString(), 'ok');
}
function unequipTrait(slot) { if (me.guest) return; db.ref('profiles/' + me.id + '/loadout/' + slot).remove(); }
let opening = false;
async function openBox(key) {
  const bx = (me.boxes || {})[key]; if (!bx || me.guest) return; if (opening && !$('#openFx').classList.contains('hidden')) return;
  opening = true;
  const tid = rollBox(bx.tier); const newKey = 't' + Date.now().toString(36) + rnd();
  const res = await db.ref('profiles/' + me.id).transaction(pr => { if (!pr) return pr; if (!pr.boxes || !pr.boxes[key]) return; pr.boxes[key] = null; pr.traits = pr.traits || {}; pr.traits[newKey] = { id: tid, t: Date.now() }; return pr; });
  if (!res.committed) { opening = false; toast('That box is already gone', 'err'); return; }
  playOpen(bx.tier, tid);
}
function playOpen(tier, tid) {                      // inventory steps aside, the chest rattles, pops open and throws the card out
  const t = TRAITS[tid]; $('#invPanel').classList.add('hidden');
  const fx = $('#openFx'), chest = $('#openChest'), burst = $('#openBurst'), card = $('#openCard'), msg = $('#openMsg'), done = $('#openDone');
  fx.classList.remove('hidden'); fx.querySelectorAll('.spark').forEach(s => s.remove());
  chest.src = ICONS['box_' + tier] || ''; chest.classList.remove('shake'); void chest.offsetWidth; chest.classList.add('shake');
  burst.classList.remove('go'); card.classList.remove('fly'); card.style.opacity = 0; msg.style.opacity = 0; done.style.opacity = 0; done.classList.remove('ready'); fx.classList.remove('ready');
  card.className = 'tcard ' + (t.type === 'ability' ? 'abl' : 'pas'); card.querySelector('.ty').textContent = t.type; card.querySelector('.sym').textContent = t.sym; card.querySelector('.tn').textContent = t.name; card.querySelector('.td').textContent = t.desc;
  const stage = $('#openStage');
  setTimeout(() => {
    if (fx.classList.contains('hidden')) return;
    chest.src = ICONS['boxopen_' + tier] || chest.src; chest.classList.remove('shake');
    burst.classList.add('go'); card.classList.add('fly'); card.style.opacity = '';
    for (let i = 0; i < 18; i++) { const s = document.createElement('div'); s.className = 'spark'; const a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 130; s.style.setProperty('--dx', Math.cos(a) * r + 'px'); s.style.setProperty('--dy', (Math.sin(a) * r - 60) + 'px'); s.style.background = i % 3 ? 'var(--yellow)' : '#fff'; stage.appendChild(s); }
    setTimeout(() => { msg.innerHTML = `${t.name}<small>${t.type === 'ability' ? 'Ability trait' : 'Passive trait'} - added to your inventory</small>`; msg.style.opacity = 1; done.style.opacity = 1; done.classList.add('ready'); fx.classList.add('ready'); }, 900);
  }, 950);
}
function finishOpen() { $('#openFx').classList.add('hidden'); $('#openFx').classList.remove('ready'); opening = false; openInventory('traits'); }
$('#openDone').onclick = (e) => { e.stopPropagation(); finishOpen(); };
$('#openFx').addEventListener('click', e => { if (e.currentTarget.classList.contains('ready')) finishOpen(); });   // once the card is revealed, a click anywhere also continues
document.addEventListener('keydown', e => { if (!$('#openFx').classList.contains('hidden') && $('#openFx').classList.contains('ready') && (e.code === 'Space' || e.code === 'Enter')) finishOpen(); });

function groundDustColor() { return S.scene === 'match' ? 0xd9c7a8 : (indoors(P.pos.x, P.pos.z) ? 0xd8c4a0 : 0xf3e4bb); }
/* ---------------- Wind HUD ---------------- */
function updateWindHud() {
  const el = $('#wind'); const show = S.scene === 'lobby' && !indoors(P.pos.x, P.pos.z);
  el.classList.toggle('hidden', !show); if (!show) return;
  const ang = Math.atan2(WIND.x, WIND.z) - camYaw;                       // arrow relative to where the camera looks
  el.querySelector('i').style.transform = 'rotate(' + (-ang * 180 / Math.PI + 180).toFixed(0) + 'deg)';
  const wt = 'WIND ' + WIND.length().toFixed(1); const we = $('#windTxt'); if (we.textContent !== wt) we.textContent = wt;
}
/* ---------------- Emotes + wheel ---------------- */
let wheelOpen = false, wheelSel = -1, wheelWasLocked = false;
function startEmote(id) {
  if (!EMOTES[id] || !P.onGround || P.dive || P.holding) return;
  P.emote = { id, t0: T }; P.rig.emote = id; P.rig.emoteT = 0; P.rig.setPose('idle'); P.rig.base = 'idle';
}
function stopEmote() { if (!P.emote) return; P.emote = null; P.rig.emote = null; P.rig.pitchTarget = 0; }
function wheelSlots() { const out = []; for (let i = 0; i < 8; i++) out.push(me.wheel && me.wheel[i] && EMOTES[me.wheel[i]] ? me.wheel[i] : null); return out; }
function toggleWheel() { wheelOpen ? closeWheel(false) : openWheel(); }
function openWheel() {
  if (uiOpen()) return;
  wheelOpen = true; wheelSel = -1; const w = $('#emoteWheel'); w.classList.remove('hidden');
  w.querySelectorAll('.slot').forEach(e => e.remove());
  const slots = wheelSlots();
  for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + i * Math.PI / 4; const el = document.createElement('div'); el.className = 'slot'; el.style.left = (180 + Math.cos(a) * 130) + 'px'; el.style.top = (180 + Math.sin(a) * 130) + 'px'; el.innerHTML = slots[i] ? `${EMOTES[slots[i]].name}` : `<small>empty</small>`; w.appendChild(el); }
  wheelWasLocked = !!document.pointerLockElement; if (wheelWasLocked) document.exitPointerLock();
}
function closeWheel(play) {
  if (!wheelOpen) return; wheelOpen = false; $('#emoteWheel').classList.add('hidden');
  if (play && wheelSel >= 0) { const id = wheelSlots()[wheelSel]; if (id) startEmote(id); }
  if (wheelWasLocked && shiftLock && !uiOpen()) canvas.requestPointerLock();
}
document.addEventListener('mousemove', e => {
  if (!wheelOpen) return;
  const dx = e.clientX - innerWidth / 2, dy = e.clientY - innerHeight / 2; const dist = Math.hypot(dx, dy);
  wheelSel = dist < 40 ? -1 : ((Math.round((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8;
  $$('#emoteWheel .slot').forEach((el, i) => el.classList.toggle('sel', i === wheelSel));
});
document.addEventListener('mousedown', e => { if (wheelOpen && e.button === 0) { e.preventDefault(); e.stopPropagation(); closeWheel(true); } }, true);
const wheelPick = (x, y) => { const dx = x - innerWidth / 2, dy = y - innerHeight / 2; const dist = Math.hypot(dx, dy); wheelSel = dist < 40 ? -1 : ((Math.round((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8; $$('#emoteWheel .slot').forEach((el, i) => el.classList.toggle('sel', i === wheelSel)); };
let wheelOpenTouch = null;                       // the finger that opened the wheel via the touch button must not also close it when it lifts
document.addEventListener('touchstart', e => { if (!wheelOpen) return; if ([...e.changedTouches].some(t => t.identifier === wheelOpenTouch)) return; e.preventDefault(); wheelPick(e.touches[0].clientX, e.touches[0].clientY); }, { capture: true, passive: false });
document.addEventListener('touchmove', e => { if (!wheelOpen) return; e.preventDefault(); wheelPick(e.touches[0].clientX, e.touches[0].clientY); }, { capture: true, passive: false });
document.addEventListener('touchend', e => { if (!wheelOpen) return; if ([...e.changedTouches].some(t => t.identifier === wheelOpenTouch)) { wheelOpenTouch = null; return; } e.preventDefault(); closeWheel(true); }, { capture: true, passive: false });
document.addEventListener('keydown', e => { if (wheelOpen && (e.code === 'Escape' || e.code === KEYS.menu)) closeWheel(false); }, true);
function equipEmote(id) {                        // put an owned emote into the first free wheel slot (or take it out)
  const wheel = Object.assign({}, me.wheel || {}); const slots = wheelSlots(); const idx = slots.indexOf(id);
  if (idx >= 0) delete wheel[idx]; else { let free = slots.indexOf(null); if (free < 0) { toast('Wheel is full - remove an emote first', 'err'); return; } wheel[free] = id; }
  if (me.guest) { me.wheel = wheel; renderShop(); onInventoryChanged(); return; }
  db.ref('profiles/' + me.id + '/wheel').set(wheel);
}

/* ---------------- Chat (global + party) ---------------- */
let chatTab = 'global', lastChatSend = 0, partyChatUnsub = null;
const chatLog = $('#chatLog'), chatInput = $('#chatInput');
$$('#chat .ctabs button').forEach(b => b.onclick = () => { chatTab = b.dataset.ct; $$('#chat .ctabs button').forEach(x => x.classList.toggle('on', x.dataset.ct === chatTab)); chatInput.placeholder = chatTab === 'party' ? 'Party chat...' : 'Press / to chat...'; renderChat(); });
const chatLogs = { global: [], party: [] };
function chatLine(html, cls = '', which = 'global') {
  const arr = chatLogs[cls === 'party' ? 'party' : which]; arr.push({ html, cls }); while (arr.length > 60) arr.shift();
  if ((cls === 'party' ? 'party' : which) === chatTab) renderChat();
}
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
const CHAT_JOIN_T = Date.now();
let chatSub = false;
function subscribeChat() { if (chatSub) return; chatSub = true; db.ref('chat/global').orderByChild('ts').startAt(snow() - 1000).on('child_added', s => { const m = s.val(); if (m) { chatLine(`<b>${esc(m.n)}:</b> ${esc(m.t)}`); addBubble(m.sid || sidForName(m.n), m.t); } }); }   // fresh chat every join: only messages sent after you arrived
function pruneChat() { try { const cutoff = snow() - 3 * 60 * 1000; db.ref('chat/global').orderByChild('ts').endAt(cutoff).limitToFirst(100).once('value').then(s => s.forEach(c => c.ref.remove())); } catch (e) { } }   // messages nobody can still see get erased
setInterval(pruneChat, 60000);

/* ---------------- Parties ---------------- */
S.party = null; let partyUnsub = null, inviteQueue = [];
function renderParty() {
  const pty = S.party; $('#partyNone').classList.toggle('hidden', !!pty); $('#partyMain').classList.toggle('hidden', !pty);
  $('#partyBadge').textContent = pty ? Object.keys(pty.members || {}).length + ' in party' : '';
  if (!pty) return;
  const list = $('#partyMembers'); list.innerHTML = '';
  for (const sid in (pty.members || {})) { const d = document.createElement('div'); d.className = 'mem'; d.innerHTML = `<span>${esc(pty.members[sid].name)}${sid === SID ? ' (you)' : ''}</span>${sid === pty.leader ? '<span class="lead">LEADER</span>' : ''}`; list.appendChild(d); }
  const on = $('#partyOnline'); on.innerHTML = '';
  db.ref('presence').once('value').then(s => { s.forEach(c => { const v = c.val(); if (!v || c.key === SID || (pty.members || {})[c.key]) return; const b = document.createElement('button'); b.className = 'btn small grey'; b.textContent = v.name; b.onclick = () => inviteToParty(c.key, v.name); on.appendChild(b); }); });
}
function partyCreate() {
  if (!S.online) { toast('Offline', 'err'); return; }
  const pid = 'p' + rnd() + Date.now().toString(36);
  db.ref('parties/' + pid).set({ leader: SID, created: firebase.database.ServerValue.TIMESTAMP, members: { [SID]: { name: me.name, id: me.id } }, pad: null }).then(() => joinPartyLocal(pid));
}
function joinPartyLocal(pid) {
  if (partyUnsub) partyUnsub();
  const ref = db.ref('parties/' + pid);
  const mref = ref.child('members/' + SID); mref.set({ name: me.name, id: me.id }); mref.onDisconnect().remove();
  const cb = ref.on('value', s => {
    const v = s.val();
    if (!v || !v.members || !v.members[v.leader] || !v.members[SID]) { leavePartyLocal(); chatLine('<span class="sys">Party disbanded</span>', 'sys', 'party'); return; }
    const was = S.party; S.party = Object.assign({ pid }, v);
    if (!was) chatLine('<span class="sys">You joined a party</span>', 'sys', 'party');
    renderParty(); for (const [sid, r] of remotes) r.tag.classList.toggle('party', !!(S.party.members && S.party.members[sid]));
    // follow the leader into a pad
    if (v.pad && v.leader !== SID && S.scene === 'lobby' && !S.padId && !S.queue && PADS[v.pad]) { const z = PADS[v.pad].zone; P.pos.set((z.x1 + z.x2) / 2, 0, (z.z1 + z.z2) / 2); P.vel.set(0, 0, 0); }
  });
  const cref = ref.child('chat'); const ccb = cref.orderByChild('ts').startAt(snow() - 1000).on('child_added', s => { const m = s.val(); if (m) { chatLine(`<b>${esc(m.n)}:</b> ${esc(m.t)}`, 'party'); addBubble(m.sid || sidForName(m.n), m.t); } });
  partyUnsub = () => { ref.off('value', cb); cref.off('child_added', ccb); };
}
function leavePartyLocal() { if (partyUnsub) partyUnsub(); partyUnsub = null; S.party = null; renderParty(); for (const r of remotes.values()) r.tag.classList.remove('party'); }
function partyLeave() {
  const pty = S.party; if (!pty) return;
  const ref = db.ref('parties/' + pty.pid);
  if (pty.leader === SID) ref.remove(); else { ref.child('members/' + SID).onDisconnect().cancel(); ref.child('members/' + SID).remove(); }
  leavePartyLocal(); chatLogs.party = []; chatLine('<span class="sys">You left the party</span>', 'sys', 'party');
}
function inviteToParty(sid, name) {
  if (!S.party) return;
  db.ref('invites/' + sid + '/' + S.party.pid).set({ from: me.name, pid: S.party.pid, ts: firebase.database.ServerValue.TIMESTAMP });
  toast('Invited ' + name, 'ok');
}
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
function showInvite() {
  const inv = inviteQueue[0]; const box = $('#inviteBox');
  if (!inv) { box.classList.add('hidden'); return; }
  $('#inviteText').textContent = inv.from + ' invited you to their party'; box.classList.remove('hidden');
}
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
   NETWORK: lobby, pads, queue, matches
   ===================================================================== */
const lobbyRef = () => db.ref('lobby/' + SID);   // on whichever area server I am on right now
let lastSync = 0, lastSyncSig = '', lastChangeT = 0;
function syncSelf() {
  const fast = !P.onGround || P.moving || P.dive; if (!S.online || T - lastSync < (fast ? 0.066 : 0.12)) return;
  const st = myState(); const sig = JSON.stringify(st);
  if (sig !== lastSyncSig) lastChangeT = T;
  else if (T - lastChangeT > 0.45) return;                              // settled: after a few repeat packets, stop writing
  lastSync = T; lastSyncSig = sig;
  if (S.scene === 'lobby') lobbyRef().set(st);
  else if (S.match && !S.match.local) db.ref(`matches/${S.match.id}/players/${SID}`).set(st);
}
/* ---- area servers: the house and the beach are separate Firebase projects. Walking through the door hands
   your position (and the players you see) over to the other one, without a loading screen: write yourself to
   the new server first, then leave the old one, then swap the listeners, and only drop remotes that are not
   on the new server. */
let lobbySubs = [];
function subscribeLobby() {
  lobbySubs.forEach(f => f()); lobbySubs = [];
  const r = db.ref('lobby'); const seen = new Set();
  const on = (ev, cb) => { const h = r.on(ev, cb); lobbySubs.push(() => r.off(ev, h)); };
  on('child_added', s => { seen.add(s.key); if (S.scene === 'lobby') remoteUpsert(s.key, s.val()); });
  on('child_changed', s => { if (S.scene === 'lobby') remoteUpsert(s.key, s.val()); });
  on('child_removed', s => { seen.delete(s.key); if (S.scene === 'lobby') remoteRemove(s.key); });
  r.once('value').then(s => { const here = new Set(); s.forEach(c => here.add(c.key)); for (const sid of Array.from(remotes.keys())) if (!here.has(sid)) remoteRemove(sid); });   // players who stayed on the other server fade from view
}
let areaCooldown = 0;
function areaOf(x, z) { return indoors(x, z) ? 'house' : 'outside'; }
function setArea(next) {
  if (next === AREA || !S.online) return;
  const prev = AREA;
  const oldRef = lobbyRef(); AREA = next; const newRef = lobbyRef();
  newRef.set(myState()); newRef.onDisconnect().remove();                      // appear on the new server first...
  oldRef.onDisconnect().cancel(); oldRef.remove();                            // ...then leave the old one
  subscribeLobby();
  console.log('[area] ' + prev + ' -> ' + next);
}
function updateArea() {
  if (S.scene !== 'lobby' || !S.booted) return;
  const want = areaOf(P.pos.x, P.pos.z); if (want === AREA) return;
  if (T < areaCooldown) return; areaCooldown = T + 1.0;                      // the doorway is short: no flapping
  setArea(want);
}
function onIdentityChangedGame() { if (S.online) { if (S.scene === 'lobby') lobbyRef().set(myState()); if (S.padId) db.ref(`pads/${S.padId}/players/${SID}`).update({ name: me.name, id: me.id }); } }

/* ---- pads ---- */
let padsData = {};
db.ref('pads').on('value', s => {
  padsData = s.val() || {};
  for (const id in PADS) { const n = Object.keys((padsData[id] || {}).players || {}).length; if (n !== PADS[id].count) PADS[id].draw(n); }
  if (S.padId) handleMyPad(padsData[S.padId] || {});
});
function padOwner(pd) { const pl = pd.players || {}; let best = null; for (const sid in pl) if (!best || (pl[sid].t || 0) < (pl[best].t || 0) || ((pl[sid].t || 0) === (pl[best].t || 0) && sid < best)) best = sid; return best; }
function handleMyPad(pd) {
  const pad = PADS[S.padId];
  if (pd.match && pd.match.for && pd.match.for[SID]) { leavePad(false); closePanels(); enterMatch(pd.match.mid, pad); return; }
  if (pd.queued && pd.queued.for && pd.queued.for[SID]) { leavePad(false); closePanels(); pushOut(pad); joinQueue(pad.mode, pd.queued.qid); return; }
  renderQueuePanel(pad, pd);
  const owner = padOwner(pd);
  if (owner === SID && pd.ownerId !== me.id && S.online) db.ref(`pads/${S.padId}/ownerId`).set(me.id);
}
async function joinPad(id) {
  const pad = PADS[id]; S.padId = id;
  if (S.queue) { toast('You are already in a queue', 'err'); pushOut(pad); S.padId = null; return; }
  let pd = {};
  if (S.online) {
    pd = (await db.ref('pads/' + id).once('value')).val() || {};
    const n = Object.keys(pd.players || {}).length;
    if (n >= pad.cap) { toast('That area is full', 'err'); pushOut(pad); S.padId = null; return; }
    if (pd.lock && n > 0 && !(await isFriendOf(pd.ownerId))) { toast('This area is locked to friends only', 'err'); pushOut(pad); S.padId = null; return; }
    if (S.padId !== id) return;
    const ref = db.ref(`pads/${id}/players/${SID}`); ref.set({ name: me.name, id: me.id, t: firebase.database.ServerValue.TIMESTAMP }); ref.onDisconnect().remove();
    if (n === 0) db.ref(`pads/${id}`).update({ ownerId: me.id, lock: false, mode: pad.mode });
  } else { pd = { players: { [SID]: { name: me.name, id: me.id, t: 1 } }, ownerId: me.id, lock: false }; padsData[id] = pd; }
  openPanel('#queuePanel'); renderQueuePanel(pad, pd);
  if (S.party && S.party.leader === SID && S.online) db.ref('parties/' + S.party.pid + '/pad').set(id);
}
function leavePad(push = true) {
  const id = S.padId; if (!id) return; S.padId = null;
  if (S.online) { const ref = db.ref(`pads/${id}/players/${SID}`); ref.onDisconnect().cancel(); ref.remove(); }
  else { if (padsData[id] && padsData[id].players) delete padsData[id].players[SID]; }
  $('#queuePanel').classList.add('hidden');
  if (S.party && S.party.leader === SID && S.online) db.ref('parties/' + S.party.pid + '/pad').set(null);
  if (push) pushOut(PADS[id]);
}
function pushOut(pad) { P.pos.copy(pad.exitPos); P.vel.set(0, 0, 0); }
function checkPads() {
  if (S.scene !== 'lobby') return;
  let inside = null;
  for (const id in PADS) { const z = PADS[id].zone; if (P.pos.x >= z.x1 && P.pos.x <= z.x2 && P.pos.z >= z.z1 && P.pos.z <= z.z2) inside = id; }
  if (inside !== S.padId) { if (S.padId && !inside) leavePad(false); if (inside && !S.padId) joinPad(inside); }
}
function renderQueuePanel(pad, pd) {
  if (!pad) return;
  $('#queueTitle').textContent = 'Queue - ' + pad.label;
  const pl = pd.players || {}; const owner = padOwner(pd);
  const list = $('#teamList'); list.innerHTML = '';
  const sorted = Object.keys(pl).sort((a, b) => (pl[a].t || 0) - (pl[b].t || 0) || (a < b ? -1 : 1));
  for (const sid of sorted) { const nm = pl[sid].name || '?'; const d = document.createElement('div'); d.className = 'mem'; d.innerHTML = `<div class="av">${nm[0].toUpperCase()}</div><span>${nm}${sid === SID ? ' (you)' : ''}</span>${sid === owner ? '<span class="lead">LEADER</span>' : ''}`; list.appendChild(d); }
  for (let i = sorted.length; i < pad.cap; i++) { const d = document.createElement('div'); d.className = 'mem'; d.style.opacity = .35; d.innerHTML = `<div class="av">-</div><span>Empty slot</span>`; list.appendChild(d); }
  const isOwner = owner === SID;
  $('#lockToggle').textContent = pd.lock ? 'ON' : 'OFF'; $('#lockToggle').classList.toggle('on', !!pd.lock); $('#lockToggle').disabled = !isOwner;
  const qb = $('#queueBtn'); qb.disabled = !isOwner; qb.textContent = isOwner ? (pad.practice ? 'START' : 'QUEUE') : 'WAITING FOR LEADER';
  $('#playMode').classList.toggle('hidden', !!pad.practice); $$('#playMode button').forEach(b => b.classList.toggle('on', b.dataset.pm === botPlay)); if (isOwner && !pad.practice) qb.textContent = botPlay === 'bots' ? 'PLAY VS BOTS' : 'QUEUE';
  $('#mapPick').classList.toggle('hidden', !pad.practice); const curMap = pd.map || 'indoor'; $$('#mapPick button').forEach(b => { b.classList.toggle('on', b.dataset.map === curMap); b.disabled = !isOwner; });
}
$('#lockToggle').onclick = () => { if (!S.padId) return; const pd = padsData[S.padId] || {}; if (padOwner(pd) !== SID) return; if (!S.online) { toast('Offline', 'err'); return; } db.ref(`pads/${S.padId}/lock`).set(!pd.lock); };
$$('#mapPick button').forEach(b => b.onclick = () => { if (!S.padId) return; const pd = padsData[S.padId] || {}; if (padOwner(pd) !== SID) return; if (S.online) db.ref(`pads/${S.padId}/map`).set(b.dataset.map); else { pd.map = b.dataset.map; renderQueuePanel(PADS[S.padId], pd); } });
$('#queueX').onclick = () => { leavePad(true); closePanels(); };
$('#queueBtn').onclick = () => { if (!S.padId) return; const pad = PADS[S.padId], pd = padsData[S.padId] || {}; if (padOwner(pd) !== SID) return; if (pad.practice) startPractice(pad, pd); else if (botPlay === 'bots') startBotMatch(pad); else startQueue(pad, pd); };
$$('#playMode button').forEach(b => b.onclick = () => { botPlay = b.dataset.pm; if (S.padId) renderQueuePanel(PADS[S.padId], padsData[S.padId] || {}); });

async function startPractice(pad, pd) {
  const players = {}; for (const sid in (pd.players || {})) players[sid] = { name: pd.players[sid].name, id: pd.players[sid].id };
  if (!S.online) { const map = pd.map || 'indoor'; leavePad(false); closePanels(); enterLocalPractice(map); return; }
  const mid = 'm' + rnd() + Date.now().toString(36);
  await db.ref('matches/' + mid).set({ mode: 'practice', practice: true, map: pd.map || 'indoor', created: firebase.database.ServerValue.TIMESTAMP, teams: { A: players, B: {} }, state: 'practice', score: { A: 0, B: 0 }, msg: '' });
  const forP = {}; for (const sid in players) forP[sid] = true;
  await db.ref(`pads/${pad.id}/match`).set({ mid, for: forP });
  setTimeout(() => db.ref(`pads/${pad.id}/match`).remove(), 3000);
}
let queueUnsub = null, mmTimer = null, queueStart = 0;
async function startQueue(pad, pd) {
  if (!S.online) { toast('Casual play needs an online connection', 'err'); return; }
  const players = {}; for (const sid in (pd.players || {})) players[sid] = { name: pd.players[sid].name, id: pd.players[sid].id };
  const qid = 'q' + rnd() + Date.now().toString(36);
  const qref = db.ref(`queue/${pad.mode}/${qid}`);
  await qref.set({ leader: SID, t: firebase.database.ServerValue.TIMESTAMP, players, mode: pad.mode, lock: !!pd.lock });
  qref.onDisconnect().remove();
  const forP = {}; for (const sid in players) forP[sid] = true;
  await db.ref(`pads/${pad.id}/queued`).set({ qid, for: forP });
  setTimeout(() => db.ref(`pads/${pad.id}/queued`).remove(), 3000);
}
function joinQueue(mode, qid) {
  if (S.queue) return;
  S.queue = { mode, qid }; queueStart = T;
  $('#queueStatus').classList.remove('hidden');
  const qref = db.ref(`queue/${mode}/${qid}`);
  const cb = qref.on('value', s => {
    const q = s.val();
    if (!q) { cancelQueue(false); toast('Queue cancelled'); return; }
    if (q.match) { const m = q.match; cancelQueue(false); enterMatch(m, null); return; }
    if (q.leader !== SID) db.ref(`queue/${mode}/${qid}/players/${SID}`).onDisconnect().remove();
    if (q.leader === SID && !mmTimer) mmTimer = setInterval(() => matchmake(mode, qid), 2000);
  });
  queueUnsub = () => qref.off('value', cb);
  toast('In queue for ' + mode, 'ok');
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
  const size = parseInt(mode, 10) || 2;                                                          // '2v2' -> 2 per team
  const all = (await db.ref('queue/' + mode).once('value')).val() || {};
  const ids = Object.keys(all).filter(k => !all[k].match).sort((a, b) => (all[a].t || 0) - (all[b].t || 0) || (a < b ? -1 : 1));
  if (!ids.includes(qid)) return;
  const count = id => Object.keys(all[id].players || {}).length;
  const fill = (pool) => {                                                                        // greedily combine entries into one team of exactly `size`; friends-locked entries never share a team
    const used = []; let n = 0;
    for (const id of pool) { const c = count(id); if (!c || c > size - n) continue; if (all[id].lock && c !== size) continue; if (used.length && all[id].lock) continue; if (used.some(u => all[u].lock)) continue; used.push(id); n += c; if (n === size) break; }
    return n === size ? used : null;
  };
  const A = fill([qid].concat(ids.filter(id => id !== qid))); if (!A) return;                       // my entry seeds team A (older entries fill it first), or we wait
  const B = fill(ids.filter(id => !A.includes(id))); if (!B) return;
  const mid = 'm' + rnd() + Date.now().toString(36);
  const teamA = {}, teamB = {};
  for (const id of A) for (const sid in (all[id].players || {})) teamA[sid] = all[id].players[sid];
  for (const id of B) for (const sid in (all[id].players || {})) teamB[sid] = all[id].players[sid];
  await db.ref('matches/' + mid).set({ mode, practice: false, created: firebase.database.ServerValue.TIMESTAMP, teams: { A: teamA, B: teamB }, state: 'serve', score: { A: 0, B: 0 }, serve: { team: 'A', sid: Object.keys(teamA)[0] }, serveIdx: { A: 0, B: -1 }, msg: '', serveAt: firebase.database.ServerValue.TIMESTAMP });
  const others = A.concat(B).filter(id => id !== qid); const marked = [];
  for (const id of others) {                                                                       // claim every other entry; if one was grabbed meanwhile, undo and try again next tick
    const res = await db.ref(`queue/${mode}/${id}/match`).transaction(c => c ? undefined : mid);
    if (!res.committed) { for (const m of marked) db.ref(`queue/${mode}/${m}/match`).remove(); db.ref('matches/' + mid).remove(); return; }
    marked.push(id);
  }
  await db.ref(`queue/${mode}/${qid}/match`).set(mid);
  setTimeout(() => { for (const id of A.concat(B)) db.ref(`queue/${mode}/${id}`).remove(); }, 4000);
}
setInterval(() => { if (S.queue) { const s = Math.floor(T - queueStart); $('#queueStatusText').textContent = `IN QUEUE - ${S.queue.mode.toUpperCase()} - ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; } }, 500);

/* =====================================================================
   MATCH
   ===================================================================== */
let matchUnsubs = [];
const mref = p => (S.match && !S.match.local && S.online) ? db.ref(`matches/${S.match.id}` + (p ? '/' + p : '')) : null;
function mwrite(p, v) { const r = mref(p); if (r) r.set(v); if (S.match) applyMatchField(p, v); }
function applyMatchField(p, v) { const M = S.match; if (!M) return; if (p === 'state') onStateChange(v); else if (p === 'score') M.score = v; else if (p === 'serve') M.serve = v; else if (p === 'msg') M.msg = v; else if (p === 'serveIdx') M.serveIdx = v; else if (p === 'serveAt') M.serveAt = v; }
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
function hostBallLanded() {
  const M = S.match, b = matchBall(); if (!M || !b || M.state !== 'rally') return;
  const cd = courtDims(); const inCourt = Math.abs(b.pos.x) <= cd.w / 2 + BALL_R && Math.abs(b.pos.z) <= cd.l / 2 + BALL_R;
  if (inCourt) { const side = b.pos.z < 0 ? 'A' : 'B'; endPoint(opp(side), TEAM_NAME[opp(side)] + ' SCORES'); }
  else { const lastTeam = b.hitter ? teamOf(b.hitter) : (M.serve ? M.serve.team : 'A'); endPoint(opp(lastTeam), 'OUT'); }
}
const WIN_SCORE = 25, SERVE_LIMIT = 12;   // seconds to get the serve away
function matchWon(sc) { const hi = Math.max(sc.A, sc.B), lo = Math.min(sc.A, sc.B); return hi >= WIN_SCORE && hi - lo >= 2; }   // one set to 25, win by 2 (24-24 goes on until someone leads by 2)
function endPoint(winner, msg) {
  const M = S.match, b = matchBall(); if (!M || !b || (M.state !== 'rally' && M.state !== 'serve')) return;
  const score = Object.assign({ A: 0, B: 0 }, M.score); score[winner]++;
  mwrite('score', score); mwrite('msg', msg); mwrite('state', 'point');
  writeBall(b);
  setTimeout(() => {
    if (!S.match || S.match.id !== M.id) return;
    if (matchWon(score)) { mwrite('msg', TEAM_NAME[winner] + ' TEAM WINS'); mwrite('state', 'over'); return; }
    const team = winner; const members = Object.keys(M.teams[team] || {}).filter(s => M.players[s] || s === SID);
    const si = Object.assign({ A: -1, B: -1 }, M.serveIdx);
    let idx = si[team];
    if (!M.serve || M.serve.team !== team || idx < 0 || !members.includes(M.serve.sid)) idx = members.length ? (idx + 1) % members.length : 0;   // side-out: the serve changes hands, so the next player in that team's order serves; otherwise the same server keeps serving
    si[team] = idx; mwrite('serveIdx', si);
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
function resetToSpawn() {                       // back to your starting spot (match start and after every point)
  const M = S.match; if (!M) return;
  const mates = Object.keys(M.teams[P.team] || {}).sort(); const idx = Math.max(0, mates.indexOf(SID));
  P.pos.copy(spawnPos(P.team, idx, mates.length)); P.vel.set(0, 0, 0); P.onGround = true; P.ry = camYaw = P.team === 'A' ? 0 : Math.PI;
  P.holding = false; P.serveMode = false; P.serveAim = null; P.dive = null; P.dash = null; P.glide = null; P.charging = false; P.airUsed = false; P.act = null; P.swingAt = 0; $('#chargeBar').classList.add('hidden');
  if (P.rig) { P.rig.base = 'idle'; P.rig.setPose('idle'); }
}
function spawnPos(team, idx, n) {
  const zs = team === 'A' ? -1 : 1; const cols = Math.min(n, 3); const row = Math.floor(idx / 3); const k = courtDims().l / COURT_L;
  return new V3((idx % cols - (cols - 1) / 2) * 3.0 * k, 0, zs * (5.25 + row * 3.0) * k);
}
async function enterMatch(mid, pad) {
  if (S.match) return;
  let m = null;
  if (S.online) m = (await db.ref('matches/' + mid).once('value')).val();
  if (!m) { toast('Match not found', 'err'); return; }
  beginMatch({ id: mid, mode: m.mode, practice: !!m.practice, map: m.map || 'indoor', teams: m.teams || { A: {}, B: {} }, players: {}, score: m.score || { A: 0, B: 0 }, state: m.state, serve: m.serve || null, serveIdx: m.serveIdx || { A: -1, B: -1 }, msg: m.msg || '', local: false });
}
function enterLocalPractice(map = 'indoor') {
  beginMatch({ id: 'local', mode: 'practice', practice: true, map, teams: { A: { [SID]: { name: me.name } }, B: {} }, players: {}, score: { A: 0, B: 0 }, state: 'practice', serve: null, serveIdx: {}, msg: '', local: true });
}
function setMyRig(variant) {
  const model = me.model || 'boy';
  if (P.rig && P.rig.variant === variant && P.rig.model === model) return;
  const base = P.rig ? P.rig.base : 'idle'; if (P.rig) scene.remove(P.rig.root);
  P.rig = new Rig(variant, model); P.rig.base = base; P.rig.setPose(base); scene.add(P.rig.root);
}
function onCosmeticsChanged() { if (P.rig) setMyRig(P.rig.variant); if (!$('#shopPanel').classList.contains('hidden')) renderShop(); if (!$('#invPanel').classList.contains('hidden')) renderInventory(); }
function beginMatch(M) {
  M.enteredAt = T; M.absentSince = 0;
  S.match = M; S.scene = 'match'; closePanels(); remotesClear();
  if (S.online) { lobbyRef().remove(); db.ref('lobbyBalls/' + SID).remove(); }
  removeBall(SID);
  scene.remove(lobby);
  if (M.map === 'beach') { scene.add(beachCourt); scene.fog = new THREE.Fog(SKY, 60, 160); updateDayNight(true); }
  else { scene.add(court); scene.background = new THREE.Color(0xdfe6ee); scene.fog = null; sunMesh.visible = moonMesh.visible = false; }
  P.team = M.teams.B && M.teams.B[SID] ? 'B' : 'A';
  const mates = Object.keys(M.teams[P.team] || {}).sort(); const idx = Math.max(0, mates.indexOf(SID));
  resetToSpawn(); camPitch = 0.3;
  setMyRig(TEAM_VARIANT[P.team]); P.rig.base = 'idle'; P.rig.setPose('idle');
  removeBall('match'); B = makeBall('match', 'match');
  $('#matchHud').classList.remove('hidden'); $('#modeTxt').textContent = M.practice ? 'PRACTICE' : M.mode.toUpperCase();
  drawScore(M.score.A, M.score.B, M.practice ? 'PRACTICE' : M.mode.toUpperCase());
  if (!M.local && S.online) {
    const r = db.ref('matches/' + M.id);
    const pref = r.child('players/' + SID); pref.set(myState()); pref.onDisconnect().remove();
    const subs = [];
    const on = (path, ev, cb) => { const ref = path ? r.child(path) : r; const h = ref.on(ev, cb); subs.push(() => ref.off(ev, h)); };
    on('players', 'child_added', s => { if (s.key !== SID) { M.players[s.key] = s.val(); remoteUpsert(s.key, s.val()); } });
    on('players', 'child_changed', s => { if (s.key !== SID) { M.players[s.key] = s.val(); remoteUpsert(s.key, s.val()); } });
    on('players', 'child_removed', s => { delete M.players[s.key]; remoteRemove(s.key); hostCheckServer(); });
    on('ball', 'value', s => receiveBall(matchBall(), s.val()));
    on('score', 'value', s => { const v = s.val(); if (v) { M.score = v; drawScore(v.A, v.B, M.mode.toUpperCase()); } });
    on('state', 'value', s => { const v = s.val(); if (v && v !== M.state) onStateChange(v); });
    on('serve', 'value', s => { M.serve = s.val(); });
    on('serveIdx', 'value', s => { M.serveIdx = s.val() || M.serveIdx; });
    on('serveAt', 'value', s => { M.serveAt = s.val() || M.serveAt; });
    on('msg', 'value', s => { M.msg = s.val() || ''; });
    on('mode', 'value', s => { if (!s.exists() && S.match && S.match.id === M.id) { toast('Match ended'); leaveMatch(); } });
    matchUnsubs = subs;
  }
}
function serveLeft() { const M = S.match; if (!M || M.state !== 'serve' || !M.serveAt) return SERVE_LIMIT; return Math.max(0, SERVE_LIMIT - (snow() - M.serveAt) / 1000); }
function autoServe() {                          // casual: when the serve is yours, you are put behind your back line with the ball in hand, ready to toss
  const M = S.match; if (!M || M.practice || M.state !== 'serve' || !M.serve || M.serve.sid !== SID) return;
  const key = M.serveAt || 1; if (P.servedKey === key) return; P.servedKey = key;
  const cd = courtDims(); const zs = P.team === 'A' ? -1 : 1;
  P.pos.set(clamp(P.pos.x, -cd.w / 2 + 1, cd.w / 2 - 1), 0, zs * (cd.l / 2 + 1.6)); P.vel.set(0, 0, 0); P.onGround = true; P.dive = null; P.dash = null; P.ry = camYaw = zs > 0 ? Math.PI : 0;
  P.serving = true; trySpawnBall(true, true);   // ball in hand: walk along the back line, press toss to aim, press again to toss
}
function hostServeClock() {                     // host: 12 s to serve, or the other team gets the point
  const M = S.match; if (!M || M.practice || !isHost() || M.state !== 'serve' || !M.serve || !M.serveAt) return;
  if (serveLeft() > 0) return;
  endPoint(opp(M.serve.team), 'SERVE TIMEOUT');
}
function hostCheckServer() {
  const M = S.match; if (!M || M.practice || !isHost() || M.state !== 'serve' || !M.serve) return;
  if (T - (M.enteredAt || 0) < 15) return;                                                   // everyone is still loading in
  const present = Object.keys(M.players).concat([SID]);
  if (present.includes(M.serve.sid)) { M.absentSince = 0; return; }
  const team = M.serve.team; const members = Object.keys(M.teams[team] || {}).filter(s => present.includes(s));
  if (!members.length) {                                                                     // whole team gone: forfeit after 10 s
    if (!M.absentSince) { M.absentSince = T; return; } if (T - M.absentSince < 10) return;
    mwrite('msg', TEAM_NAME[opp(team)] + ' TEAM WINS (forfeit)'); const sc = Object.assign({}, M.score); sc[opp(team)] = Math.max(WIN_SCORE, sc[team] + 2); mwrite('score', sc); mwrite('state', 'over'); return;
  }
  M.absentSince = 0; mwrite('serve', { team, sid: members[0] });                             // server left: a teammate serves instead
}
function leaveMatch() {
  const M = S.match; if (!M) return;
  BOTS.length = 0;
  matchUnsubs.forEach(f => f()); matchUnsubs = [];
  if (!M.local && S.online) {
    const r = db.ref('matches/' + M.id); const pref = r.child('players/' + SID); pref.onDisconnect().cancel(); pref.remove().then(() => r.child('players').once('value')).then(s => { if (!s.exists()) r.remove(); });
  }
  S.match = null; S.scene = 'lobby'; remotesClear(); removeBall('match'); B = null;
  if (S.online) db.ref('lobby').once('value').then(s => { if (S.scene !== 'lobby') return; s.forEach(c => { remoteUpsert(c.key, c.val()); }); });   // players who are standing still don't send updates, so re-fetch them
  scene.remove(court); scene.remove(beachCourt); scene.add(lobby); scene.background = new THREE.Color(SKY); scene.fog = new THREE.Fog(SKY, 60, 160); updateDayNight(true);
  P.pos.set(0, 0, 7); P.vel.set(0, 0, 0); P.ry = camYaw = Math.PI; P.onGround = true; P.holding = false; P.serveMode = false; P.serving = false; P.servedKey = null; P.dive = null; P.charging = false; setMyRig('white'); P.rig.base = 'idle'; P.rig.setPose('idle');
  $('#chargeBar').classList.add('hidden');
  $('#matchHud').classList.add('hidden'); $('#bigMsg').textContent = '';
  if (S.online) { AREA = areaOf(P.pos.x, P.pos.z); subscribeLobby(); lobbyRef().set(myState()); lobbyRef().onDisconnect().remove(); }
}
$('#leaveBtn').onclick = () => leaveMatch();

function updateMatchHud() {
  const M = S.match, b = matchBall(); if (!M) return;
  const setText = (sel, v) => { const el = $(sel); if (el.textContent !== String(v)) el.textContent = v; };   // touching the DOM every frame forces layout; only write on change
  setText('#scoreA', M.score.A || 0); setText('#scoreB', M.score.B || 0);
  $$('#touches i').forEach((el, i) => { const on = !!b && i < b.touches && b.active; if (el.classList.contains('on') !== on) el.classList.toggle('on', on); });
  setText('#bigMsg', M.msg || '');
  const sh = $('#serveHint');
  let hint = '';
  if (!M.practice && M.state === 'serve' && M.serve) {
    const left = Math.ceil(serveLeft());
    if (M.serve.sid === SID) hint = P.serveAim ? `YOUR SERVE (${left}s) - ${moveKeysLabel()} moves the toss, ${keyName(KEYS.toss)} tosses, then jump and spike` : `YOUR SERVE (${left}s) - ${keyName(KEYS.toss)} to aim your toss. Stay behind the line until you hit it!`;
    else { const p = M.players[M.serve.sid]; hint = `Waiting for ${p ? p.name : 'opponent'} to serve (${left}s)`; }
  }
  if (sh.textContent !== hint) sh.textContent = hint; if (sh.classList.contains('hidden') === !!hint) sh.classList.toggle('hidden', !hint);
  autoServe();
  if (isHost() && M.state === 'serve') { hostCheckServer(); hostServeClock(); }
}

/* =====================================================================
   BOTS: local casual matches against (and alongside) computer players
   ---------------------------------------------------------------------
   A bot match is a local match (no server): the ball, the scoring and the serve clock all run here.
   Bots are simple bodies (position, velocity, jump) driving a Rig, registered in `remotes` so the
   name tags and other systems treat them like players. Each team runs one plan per frame:
     receive  - the bot nearest the predicted landing runs there and sets the ball up to the setter spot
     set      - the setter (2s: whoever did not receive; 3s+: a dedicated setter) puts the ball on a hitter's spot at the antenna (or the middle in 6s)
     attack   - the hitter runs under the set, jumps in time and spikes to one of six spots (or tips), facing where it hits; a bad set becomes a lob (TOO LOW)
     defend   - back to base; once the other side has two touches the nearest bot fronts the attacker at the net and jumps with them to block
   Bots on your team follow the same plan; on defence a teammate flips a coin between blocking and receiving, and when you receive it sets to the antenna nearest you.
   ===================================================================== */
const BOTS = [];
const BOT_NAMES = [['Bob', 'boy'], ['Greg', 'boy'], ['Emily', 'girl'], ['Dave', 'boy'], ['Sarah', 'girl'], ['Karen', 'girl'], ['Steve', 'boy'], ['Linda', 'girl'], ['Kevin', 'boy'], ['Jenny', 'girl'], ['Frank', 'boy'], ['Nancy', 'girl']];
const BOT_SPEED = 6.6, BOT_REACH_G = 1.6, BOT_REACH_A = 1.7;
const sideZ = team => team === 'A' ? -1 : 1;                              // which way is "our side" along z (the net is at z = 0)
let botPlay = 'online';                                                   // the queue panel's ONLINE / BOTS choice
function botTeamOf(id) { const b = BOTS.find(x => x.id === id); return b ? b.team : null; }

function makeBot(id, name, model, team, idx, n) {
  const rig = new Rig(TEAM_VARIANT[team], model); scene.add(rig.root);
  const tag = document.createElement('div'); tag.className = 'tag'; tag.textContent = name; $('#tags').appendChild(tag);
  const bot = { id, name, model, team, idx, n, rig, tag, pos: spawnPos(team, idx, n), vel: new V3(), onGround: true, ry: team === 'A' ? 0 : Math.PI, target: null, face: null, role: 'player', plan: null, jumpAt: 0, blockUntil: 0, lastHitT: -9, serveAt: 0, coin: 0, base: null };
  bot.base = bot.pos.clone(); rig.root.position.copy(bot.pos); rig.root.rotation.y = bot.ry; rig.setPose('idle'); rig.snap();
  remotes.set(id, { rig, tag, name, buf: [], data: { team, name }, speed: 0, stamp: null, gap: 0.09, jit: 0, delay: 0.18, lastArrive: 0, ptx: null, pty: 0, ptz: 0 });   // empty buffer: updateRemotes leaves it to us, projectTags draws the tag
  return bot;
}
function startBotMatch(pad) {
  const size = pad.cap; const map = size === 2 ? 'beach' : 'indoor';
  const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
  const teams = { A: { [SID]: { name: me.name } }, B: {} }; const players = {}; const spec = [];
  for (let i = 1; i < size; i++) { const id = 'bot_a' + i; const [nm, md] = names.pop(); teams.A[id] = { name: nm }; players[id] = { name: nm, team: 'A' }; spec.push([id, nm, md, 'A']); }
  for (let i = 0; i < size; i++) { const id = 'bot_b' + i; const [nm, md] = names.pop(); teams.B[id] = { name: nm }; players[id] = { name: nm, team: 'B' }; spec.push([id, nm, md, 'B']); }
  leavePad(false); closePanels();
  beginMatch({ id: 'bots', mode: size + 'v' + size, practice: false, bots: true, local: true, map, teams, players, score: { A: 0, B: 0 }, state: 'serve', serve: { team: Math.random() < 0.5 ? 'A' : 'B', sid: null }, serveIdx: { A: -1, B: -1 }, msg: '', serveAt: snow() });
  BOTS.length = 0;
  for (const [id, nm, md, team] of spec) { const mates = Object.keys(teams[team]).sort(); BOTS.push(makeBot(id, nm, md, team, mates.indexOf(id), mates.length)); }
  if (size >= 3) for (const team of ['A', 'B']) { const first = BOTS.find(x => x.team === team); if (first) first.role = 'setter'; }   // 3s and up: one bot on each side only sets and blocks
  const M = S.match; const t = M.serve.team; const members = Object.keys(M.teams[t]).sort(); M.serve.sid = members[0]; M.serveIdx[t] = 0;
  botsOnServe(); $('#modeTxt').textContent = M.mode.toUpperCase() + ' vs BOTS';
  toast('Bot match: ' + (size === 2 ? 'beach' : 'indoor') + ' court', 'ok');
}
/* ---- ball prediction (same physics as simBall, without the nets) ---- */
function predictBall(b, opts = {}) {
  const pos = b.pos.clone(), vel = b.vel.clone(), g = BALL_G * b.g; let t = 0; const h = 1 / 60; const wantH = opts.height; let atH = null;
  while (t < 6) {
    vel.y -= g * h; vel.multiplyScalar(1 - 0.015 * h); pos.addScaledVector(vel, h); t += h;
    if (wantH !== undefined && atH === null && vel.y < 0 && pos.y <= wantH) atH = { x: pos.x, z: pos.z, y: pos.y, t };
    if (pos.y <= BALL_R) break;
  }
  return { land: { x: pos.x, z: pos.z, t }, atH };
}
/* ---- one bot's body ---- */
function botStep(bot, dt) {
  const cd = courtDims(); const sz = sideZ(bot.team);
  if (bot.target && bot.onGround) {
    const dx = bot.target.x - bot.pos.x, dz = bot.target.z - bot.pos.z; const d = Math.hypot(dx, dz);
    if (d > 0.12) { const sp = Math.min(BOT_SPEED, d / dt); bot.vel.x = dx / d * sp; bot.vel.z = dz / d * sp; } else { bot.vel.x = bot.vel.z = 0; }
  } else if (bot.onGround) { bot.vel.x = bot.vel.z = 0; }
  bot.vel.y -= G * dt;
  bot.pos.x += bot.vel.x * dt; bot.pos.z += bot.vel.z * dt; bot.pos.y += bot.vel.y * dt;
  const zMin = sz < 0 ? -cd.l / 2 - 2.5 : 0.5, zMax = sz < 0 ? -0.5 : cd.l / 2 + 2.5;                    // never through the net, a little room behind the line to serve
  bot.pos.z = clamp(bot.pos.z, zMin, zMax); bot.pos.x = clamp(bot.pos.x, -cd.w / 2 - 1.5, cd.w / 2 + 1.5);
  if (bot.pos.y <= 0) { if (!bot.onGround) { bot.rig.setPose('land', T + 0.16); bot.rig.impact(-0.17); bot.rig.base = 'idle'; } bot.pos.y = 0; bot.vel.y = 0; bot.onGround = true; bot.blockUntil = 0; }
  // facing: the point it is looking at, else where it runs
  const look = bot.face || (bot.onGround && Math.hypot(bot.vel.x, bot.vel.z) > 0.5 ? new V3(bot.pos.x + bot.vel.x, 0, bot.pos.z + bot.vel.z) : null);
  if (look) { const want = Math.atan2(look.x - bot.pos.x, look.z - bot.pos.z); let d = want - bot.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); bot.ry += d * Math.min(1, dt * 12); }
  const r = bot.rig; r.root.position.copy(bot.pos); r.root.rotation.y = bot.ry; r.moveSpeed = bot.onGround && r.anim === 'idle' ? Math.hypot(bot.vel.x, bot.vel.z) : 0; r.update(dt, T);
}
function botJump(bot) { if (!bot.onGround) return; bot.vel.y = JUMP_V; bot.onGround = false; bot.rig.impact(0.14); bot.rig.base = 'air'; bot.rig.setPose('jumpUp', T + 0.18); }
function botHit(bot, type, vel, g = 1) {
  const b = matchBall(); if (!b) return;
  b.vel.copy(vel); b.g = g; b.seq++; b.t = snow(); b.held = null; b.active = true; b.frozen = false; b.pf = null; b.acc = 0;
  b.prevHitter = b.hitter; b.prevType = b.hitType; b.hitter = bot.id; b.hitType = type; b.fx = 'none'; b.hm = bot.model; b.hitterPos = { x: bot.pos.x, z: bot.pos.z };
  if (type === 'block') { b.touches = 0; b.sideTeam = bot.team; } else { if (b.sideTeam !== bot.team) { b.sideTeam = bot.team; b.touches = 1; } else b.touches++; }
  b.serve = false; b.spin.set(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(vel.length() * 0.4); b.landed = false; b.ds = false;
  if (type === 'spike') sparkle(b.pos, 12, 0xffffff, 1.4, 0.6, 0.35, 0.07, vel.clone().normalize());
  const fwd = new V3(Math.sin(bot.ry), 0, Math.cos(bot.ry));
  if (type === 'bump') { bot.rig.setPose('bump', T + 0.45); setTimeout(() => actionFx('bump', bot.rig, fwd), 60); }
  else if (type === 'set') { bot.rig.setPose('set', T + 0.45); if (!bot.onGround) bot.rig.base = 'airDown'; setTimeout(() => actionFx('set', bot.rig, fwd), 80); }
  else if (type === 'spike' || type === 'tip') { bot.rig.setPose(type === 'tip' ? 'tip' : 'spikeHit', T + 0.4); bot.rig.base = 'airDown'; actionFx('spike', bot.rig, fwd); }
  bot.lastHitT = T; bot.plan = null;
  hostCheckHit();
}
const botReach = (bot, high) => { const b = matchBall(); if (!b || !b.active || b.held || b.frozen) return false; const c = bot.pos.clone().add(new V3(0, high ? 2.0 : 1.05, 0)); const d = b.pos.distanceTo(c); return high ? d < BOT_REACH_A : d < BOT_REACH_G; };
const botMayTouch = bot => { const b = matchBall(); return b && b.hitter !== bot.id && T - bot.lastHitT > 0.35; };
/* ---- spots on the court ---- */
function attackSpots(team) {                    // where hitters wait: the two antennas, plus the middle
  const cd = courtDims(); const sz = sideZ(team); const x = cd.w / 2 - 0.7;
  return { left: new V3(-x, 0, sz * 2.0), right: new V3(x, 0, sz * 2.0), middle: new V3(0.9 * -sz, 0, sz * 1.6) };
}
function setterSpot(team) { const cd = courtDims(); return new V3(1.2 * sideZ(team), 0, sideZ(team) * 2.2); }
function humanOnTeam(team) { return P.team === team; }
/* ---- spike targets: six ways to hit ---- */
function spikeTarget(kind, team, from) {
  const cd = courtDims(); const ez = -sideZ(team); const hx = cd.w / 2 - 0.9, hl = cd.l / 2 - 1.0;
  const dirX = from.x >= 0 ? 1 : -1;                                                                     // "cut" and "straight" depend on which antenna you hit from
  switch (kind) {
    case 'leftCorner': return new V3(-hx, 0, ez * hl);
    case 'rightCorner': return new V3(hx, 0, ez * hl);
    case 'middleLong': return new V3(0, 0, ez * hl);
    case 'cut': return new V3(-dirX * hx, 0, ez * 2.2);                                                  // sharp cross court, just past the net
    case 'straight': return new V3(from.x, 0, ez * (hl - 1.5));
    default: return new V3(from.x * 0.4, 0, ez * 2.0);                                                    // tip
  }
}
function botSpike(bot) {
  const b = matchBall(); const kinds = ['leftCorner', 'rightCorner', 'middleLong', 'cut', 'straight', 'tip']; const kind = kinds[Math.floor(Math.random() * kinds.length)];
  const tg = spikeTarget(kind, bot.team, bot.pos); bot.face = tg.clone();
  const contactY = b.pos.y;
  if (contactY < NET_H - 0.25) {                                                                           // too low: lob it over instead of into the tape
    const over = new V3(tg.x, 0, -sideZ(bot.team) * 4.5); botHit(bot, 'spike', launchTo(b.pos, over, Math.max(b.pos.y + 4.0, NET_H + 3.0)), 1); showBallMsg('TOO LOW', b.pos); return;
  }
  if (kind === 'tip') { botHit(bot, 'tip', launchTo(b.pos, tg, Math.max(b.pos.y + 0.4, NET_H + 0.5)), 1); return; }
  const power = 0.5 + Math.random() * 0.5;                                                                // 50-100%
  const gm = 1.4 + 2.2 * power; const apex = Math.max(b.pos.y + 0.25, NET_H + 0.55);
  botHit(bot, 'spike', launchTo(b.pos, tg, apex, BALL_G * gm), gm);
}
/* ---- serving ---- */
function botsOnServe() {                        // a serve state just began: everyone to base, the serving bot behind its line
  const M = S.match; if (!M || !M.bots) return;
  for (const bot of BOTS) { bot.plan = null; bot.target = bot.base.clone(); bot.face = new V3(bot.pos.x, 0, 0); bot.pos.copy(bot.base); bot.vel.set(0, 0, 0); bot.onGround = true; bot.pos.y = 0; bot.rig.base = 'idle'; bot.rig.setPose('idle'); bot.coin = Math.random(); bot.blockUntil = 0; }
  const s = M.serve && BOTS.find(x => x.id === M.serve.sid);
  if (s) { const cd = courtDims(); s.pos.set(clamp(s.base.x, -cd.w / 2 + 1, cd.w / 2 - 1), 0, sideZ(s.team) * (cd.l / 2 + 1.4)); s.target = null; s.serveAt = T + 1.6 + Math.random() * 0.8; }
}
function botServe(bot) {
  const M = S.match, b = matchBall(); const cd = courtDims(); const ez = -sideZ(bot.team);
  b.active = true; b.frozen = false; b.held = null; b.pos.copy(bot.pos).add(new V3(0, 1.1, 0)).addScaledVector(new V3(0, 0, ez), 0.4); b.hitter = null; b.hitType = null; b.prevHitter = null; b.touches = 0; b.sideTeam = bot.team; b.serve = false; b.tossedBy = null; b.landed = false; b.vel.set(0, 0, 0);
  const tg = new V3((Math.random() - 0.5) * cd.w * 0.7, 0, ez * (cd.l / 4 + Math.random() * cd.l / 4));       // deep-ish, somewhere in their court
  bot.face = tg.clone();
  botHit(bot, 'bump', launchTo(b.pos, tg, Math.max(NET_H + 2.2, 5.6)), 1);                             // a bump serve that clears the net
  mwrite('state', 'rally');
}
/* ---- the plans ---- */
function planTeam(team, bots) {
  const M = S.match, b = matchBall(); if (!b) return;
  const cd = courtDims(); const sz = sideZ(team); const human = humanOnTeam(team);
  const pred = predictBall(b); const incoming = Math.sign(pred.land.z) === sz || (b.pos.z * sz > 0 && b.vel.z * sz >= 0);
  const oursTouches = b.sideTeam === team ? b.touches : 0;
  const mates = bots.slice(); const size = mates.length + (human ? 1 : 0);
  const setter = size >= 3 ? (bots.find(x => x.role === 'setter') || bots[0]) : null;   // 3s+: one bot only sets and blocks
  const spots = attackSpots(team);
  const dist2 = (bot, p) => Math.hypot(bot.pos.x - p.x, bot.pos.z - p.z);
  if (!b.active || M.state !== 'rally') { for (const bot of bots) bot.target = bot.base.clone(); return; }
  if (incoming && oursTouches < 3) {
    /* ---------- we have (or are about to have) the ball ---------- */
    if (oursTouches === 0) {                                                                            // RECEIVE: nearest to the landing (not the setter) runs there and sets it up
      const land = new V3(pred.land.x, 0, pred.land.z);
      const cands = bots.filter(x => x !== setter || bots.length === 1);
      const recv = cands.reduce((a, x) => dist2(x, land) < dist2(a, land) ? x : a, cands[0]);
      for (const bot of bots) {
        if (bot === recv) { bot.target = land.clone().addScaledVector(new V3(0, 0, sz), 0.35); bot.face = new V3(b.pos.x, 0, b.pos.z); bot.plan = 'receive'; }
        else if (bot === setter || (!setter && bots.length > 1)) { bot.target = setterSpot(team); bot.plan = 'setter'; bot.face = new V3(b.pos.x, 0, b.pos.z); }
        else { bot.target = bot.base.clone(); bot.plan = 'wait'; }
      }
      if (botReach(recv, false) && botMayTouch(recv) && (b.vel.y < 1 || b.pos.y < 1.6)) {              // touch 1: up to the setter spot
        const tg = setterSpot(team); recv.face = tg.clone();
        botHit(recv, b.pos.y < 1.0 ? 'bump' : 'set', launchTo(b.pos, tg, Math.max(6.0, b.pos.y + 3.0)), 1);
        recv.plan = 'toAntenna'; recv.target = (recv.pos.x < 0 ? spots.left : spots.right).clone();
      }
    } else if (oursTouches === 1) {                                                                     // SET: the setter goes under the ball and puts it on a hitter
      const st = setter || bots.find(x => x.id !== b.hitter);
      if (!st) {                                                                                          // the only bot just received: the human must set, so it runs to an antenna and waits
        for (const bot of bots) { bot.plan = 'hitter'; bot.target = (bot.pos.x < 0 ? spots.left : spots.right).clone(); bot.face = new V3(b.pos.x, 0, b.pos.z); }
        return;
      }
      const hitters = bots.filter(x => x !== st && x.id !== b.hitter);
      // choose the hitter now (sticky per rally): a bot at an antenna / the middle, or the human if they are up front
      if (!st.plan || !st.plan.startsWith('set:')) {
        let pick = null;
        if (human && b.hitter !== SID && Math.abs(P.pos.z) < cd.l / 2 && Math.abs(P.pos.z) > 0.3 && Math.random() < 0.55) pick = 'human';
        else if (hitters.length) pick = hitters[Math.floor(Math.random() * hitters.length)].id;
        else if (human) pick = 'human';
        st.plan = 'set:' + pick;
      }
      const pick = st.plan.slice(4);
      // hitters spread to different spots; in 6s two antennas, a middle, the rest stay back
      const order = ['left', 'right', 'middle']; let k = 0;
      for (const bot of bots) {
        if (bot === st) continue;
        if (bot.id === b.hitter && bots.length <= 2) { bot.target = (bot.pos.x < 0 ? spots.left : spots.right).clone(); bot.plan = 'hitter'; continue; }
        if (k < 3 && (size <= 3 || k < 3)) { bot.target = spots[order[k++]].clone(); bot.plan = 'hitter'; } else { bot.target = bot.base.clone(); bot.plan = 'wait'; }
      }
      const at = predictBall(b, { height: 2.1 }).atH; const under = at ? new V3(at.x, 0, at.z) : new V3(pred.land.x, 0, pred.land.z);
      st.target = under.clone().addScaledVector(new V3(0, 0, sz), 0.25); st.face = new V3(b.pos.x, 0, b.pos.z);
      const wantJump = at && at.y > 2.2 && dist2(st, under) < 0.8 && b.vel.y < 0 && b.pos.y < 3.4 && b.pos.y > 2.4;
      if (wantJump && st.onGround) botJump(st);
      if (botMayTouch(st) && (botReach(st, !st.onGround) )) {
        let tg; if (pick === 'human') { const l = P.pos.distanceTo(spots.left), r = P.pos.distanceTo(spots.right); tg = (l < r ? spots.left : spots.right).clone(); }
        else { const hb = bots.find(x => x.id === pick); tg = hb ? hb.target.clone() : spots.left.clone(); }
        tg.addScaledVector(new V3(0, 0, sz), 0.4); st.face = tg.clone();
        botHit(st, 'set', launchTo(b.pos, tg, Math.max(5.6, b.pos.y + 2.4)), 1);
        st.plan = 'setter'; st.target = setterSpot(team);
      }
    } else {                                                                                            // ATTACK: whoever is expected to hit runs under the set, jumps in time and swings
      let hitter = null;
      const spikeAt = predictBall(b, { height: 2.95 }).atH;
      const aim = spikeAt ? new V3(spikeAt.x, 0, spikeAt.z) : new V3(pred.land.x, 0, pred.land.z);
      const cands = bots.filter(x => x.id !== b.hitter && x !== setter);
      if (cands.length) hitter = cands.reduce((a, x) => dist2(x, aim) < dist2(a, aim) ? x : a, cands[0]);
      if (!hitter && human) hitter = null;                                                              // the human's ball
      for (const bot of bots) { if (bot !== hitter) { bot.target = bot === setter ? setterSpot(team) : bot.base.clone(); bot.plan = 'wait'; } }
      if (hitter) {
        hitter.plan = 'attack'; hitter.target = aim.clone().addScaledVector(new V3(0, 0, sz), 0.45); hitter.face = new V3(b.pos.x, 0, b.pos.z);
        const tLeft = spikeAt ? spikeAt.t : pred.land.t;
        if (hitter.onGround && spikeAt && tLeft < 0.62 && dist2(hitter, aim) < 1.2) botJump(hitter);
        if (!hitter.onGround && botReach(hitter, true) && botMayTouch(hitter) && b.vel.y < 2) botSpike(hitter);
        else if (hitter.onGround && !spikeAt && botReach(hitter, false) && botMayTouch(hitter) && b.pos.y < 1.7) {   // set never got up: shovel it over
          const over = new V3(0, 0, -sz * 5); botHit(hitter, 'bump', launchTo(b.pos, over, Math.max(NET_H + 2, b.pos.y + 3)), 1);
        }
      }
    }
  } else {
    /* ---------- they have the ball: defend ---------- */
    const theirs = b.sideTeam !== team ? b.touches : 0;
    let blocker = null;
    if (theirs >= 2 && b.pos.z * sz < 0) {                                                              // they have set: front the attacker
      // the attacker: the human on their side if it is not who just hit, else their nearest bot to the ball
      let attackerPos = null;
      if (!human && b.hitter !== SID) attackerPos = P.pos;
      else { const theirBots = BOTS.filter(x => x.team !== team && x.id !== b.hitter); if (theirBots.length) attackerPos = theirBots.reduce((a, x) => x.pos.distanceTo(b.pos) < a.pos.distanceTo(b.pos) ? x : a, theirBots[0]).pos; }
      const netX = predictBall(b, { height: 2.9 }).atH; const fx = netX ? netX.x : (attackerPos ? attackerPos.x : b.pos.x);
      const cands = bots.filter(x => !(human && x.coin < 0.5 && bots.length === 1));                      // a lone teammate flips a coin: block or dig
      if (cands.length) blocker = cands.reduce((a, x) => Math.abs(x.pos.x - fx) < Math.abs(a.pos.x - fx) ? x : a, cands[0]);
      if (blocker) {
        blocker.plan = 'block'; blocker.target = new V3(clamp(fx, -cd.w / 2 + 0.5, cd.w / 2 - 0.5), 0, sz * 0.9); blocker.face = new V3(fx, 0, -sz * 3);
        const attackerUp = (attackerPos === P.pos) ? !P.onGround : BOTS.some(x => x.team !== team && !x.onGround);
        if (attackerUp && blocker.onGround && Math.abs(blocker.pos.z) < 1.6) { botJump(blocker); blocker.blockUntil = T + 1.0; blocker.rig.base = 'block'; blocker.rig.setPose('block'); }
      }
    }
    for (const bot of bots) {
      if (bot === blocker) continue;
      if (bot.plan === 'block' && bot.onGround) bot.plan = 'wait';
      // a lone teammate that chose to dig, or anyone when the ball is coming down on our side: go to the landing spot
      const land = new V3(pred.land.x, 0, pred.land.z);
      if (Math.sign(land.z) === sz && !incoming) { bot.target = land.clone().addScaledVector(new V3(0, 0, sz), 0.4); bot.plan = 'dig'; }
      else { bot.target = bot === setter ? setterSpot(team) : bot.base.clone(); bot.plan = 'wait'; }
      bot.face = new V3(b.pos.x, 0, b.pos.z);
    }
  }
}
function botBlockContacts() {                    // a ball coming over the tape within reach of a jumping blocker goes straight back
  const b = matchBall(); if (!b || !b.active) return;
  for (const bot of BOTS) {
    const sz = sideZ(bot.team);
    if (bot.onGround || T >= bot.blockUntil || b.hitter === bot.id || b.vel.z * sz <= 0 || b.pos.z * sz > 0.6 || b.pos.z * sz < -0.9) continue;
    const hands = bot.pos.clone().add(new V3(0, 2.35, 0)); if (b.pos.distanceTo(hands) > 1.15 || b.pos.y < NET_H - 0.3) continue;
    const tg = new V3(bot.pos.x + (Math.random() - 0.5) * 3, 0, -sz * (2 + Math.random() * 3)); bot.face = tg.clone();
    botHit(bot, 'block', launchTo(b.pos, tg, b.pos.y + 0.6, BALL_G * 1.6), 1.6); bot.blockUntil = 0;
  }
}
function updateBots(dt) {
  const M = S.match; if (!M || !M.bots || !BOTS.length) return;
  if (M.state === 'serve') {
    const s = M.serve && BOTS.find(x => x.id === M.serve.sid);
    if (s && s.serveAt && T >= s.serveAt) { s.serveAt = 0; botServe(s); }
    for (const bot of BOTS) if (bot !== s) bot.target = bot.base.clone();
  } else if (M.state === 'rally') {
    botBlockContacts();
    for (const team of ['A', 'B']) planTeam(team, BOTS.filter(x => x.team === team));
  } else { for (const bot of BOTS) { bot.target = bot.base.clone(); bot.plan = null; } }
  for (const bot of BOTS) botStep(bot, dt);
}

/* =====================================================================
   MAIN LOOP (fixed timestep, keeps simulating while the tab is hidden)
   ===================================================================== */
const FIXED = 1 / 60;
let last = performance.now(), acc = 0;
function simulate(dt) {
  T += dt;
  updatePlayer(dt); P.rig.update(dt, T);
  updateBots(dt);
  updateBalls(dt); updateRemotes(dt); checkPads();
  WATER_T.value = T;                                                          // both maps' sea share one clock
  if (ULTRA) { if (S.scene === 'lobby') updateWind(); }                                  // ultra low: scenery stands still (wind still blows for the ball)
  else if (S.scene === 'lobby') updateAmbient(T, dt);
  else if (S.match) { if (S.match.map === 'beach') updateBeachAmbient(T, dt); else updateCourtAmbient(T, dt); }
  updateDust(dt);
}
let lastFrameAt = 0;                             // when the rAF loop last ran; the worker clock steps the game whenever that stalls
function tick(nowMs, headless = false) {
  let dt = (nowMs - last) / 1000; last = nowMs;
  if (!S.booted) return;
  if (headless || document.hidden) {           // no frame is being drawn (hidden, minimized, covered, or rAF throttled): step the game in fixed slices and keep everything else going
    acc += Math.min(dt, 6); let n = 0; while (acc >= FIXED && n < 400) { simulate(FIXED); acc -= FIXED; n++; }
    updateFx(Math.min(dt, 0.1)); if (S.scene === 'match') updateMatchHud(); updateArea(); syncSelf();   // effects still expire (they used to pile up for as long as the tab was hidden)
    return;
  }
  lastFrameAt = nowMs;
  acc = 0; let rem = Math.min(dt, 0.1); while (rem > 0.0001) { const h = Math.min(rem, 1 / 60); simulate(h); rem -= h; }   // real-time stepping: slow frames sub-step instead of falling behind (which looked like jitter to others)
  updateCamera(Math.max(1e-4, Math.min(dt, 0.1))); projectTags(); projectServeAim(); projectBallMsg(); updateCards(); updateMarks(); projectNpc(); updateAuras(T); updateFx(Math.min(dt, 0.05)); updateWindHud();
  if (S.scene === 'match') updateMatchHud();
  updateArea(); syncSelf();
  renderer.shadowMap.needsUpdate = (frameNo++ % 3) === 0;   // shadows refresh every third frame (cheaper; the sun barely moves between them)
  renderer.render(scene, camera);
}
let frameNo = 0;
function frame(nowMs) { requestAnimationFrame(frame); if (!document.hidden) tick(nowMs); }
try {                                            // hidden tab: browsers throttle page timers to once a second (or worse), so a worker drives the ticks instead - the match keeps running until the tab is closed
  const wk = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50);'], { type: 'text/javascript' })));
  wk.onmessage = () => { const now = performance.now(); if (document.hidden || now - lastFrameAt > 120) tick(now, true); else if (S.booted) syncSelf(); };   // rAF silent for 120 ms (hidden, covered, throttled): the worker steps the game; otherwise it just drives network sends
} catch (e) { setInterval(() => { const now = performance.now(); if (document.hidden || now - lastFrameAt > 120) tick(now, true); }, 100); }
document.addEventListener('visibilitychange', () => { last = performance.now(); lastFrameAt = performance.now(); });   // no catch-up burst when you come back

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
let GFX = 'high';
function applyQuality(q) {                       // high: as designed; medium: smaller shadow map, 1x pixels; low: no shadows, 0.85x pixels, no drifting sand grains; ultra: low + no effects, no animated scenery, classic balls
  GFX = q; const wasUltra = ULTRA; ULTRA = q === 'ultra';
  if (wasUltra !== ULTRA) { for (const b of balls.values()) applySkin(b.mesh, b.skin || 'default'); if (ULTRA) { for (const f of FX_LIST) { scene.remove(f.g); releaseFxLight(f.g); } FX_LIST.length = 0; } }   // re-skin the balls, drop any running effects
  scene.traverse(o => { if (o.isPoints) o.visible = !ULTRA; });                                   // sand grains, motes
  const shadows = q !== 'low' && q !== 'ultra'; const size = q === 'high' ? 1024 : 512;
  if (renderer.shadowMap.enabled !== shadows) { renderer.shadowMap.enabled = shadows; scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); }); }
  if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 1.25 : q === 'medium' ? 1 : q === 'low' ? 0.85 : 0.75)); resize();
  const grains = lobby.getObjectByName('sandGrains'); if (grains) grains.visible = q !== 'low' && q !== 'ultra';
  renderer.shadowMap.needsUpdate = true;
}
function optimizeScenery() {                    // fold static scenery into a handful of meshes (see mergeStatic); things that move keep their own
  for (const n of [NPC, NPC2, NPC3]) if (n && n.root) n.root.userData.noMerge = true;
  for (const id in PADS) PADS[id].group.userData.noMerge = true;
  if (typeof GYM_PANEL_MAT !== 'undefined') GYM_PANEL_MAT.userData.solo = true;
  try { mergeStatic(lobby, AMBIENT, 'lobby'); } catch (e) { console.warn('merge lobby', e); }
  try { mergeStatic(court, typeof COURT_AMBIENT !== 'undefined' ? COURT_AMBIENT : [], 'gym'); } catch (e) { console.warn('merge gym', e); }
  try { mergeStatic(beachCourt, typeof BEACH_AMBIENT !== 'undefined' ? BEACH_AMBIENT : [], 'beach'); } catch (e) { console.warn('merge beach', e); }
}
const setLoad = async (pct, msg) => { $('#loadMsg').textContent = msg; $('#loadBar i').style.width = pct + '%'; $('#loadPct').textContent = pct + '%'; await new Promise(r => { let done = false; const fin = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(fin); setTimeout(fin, 60); }); };   // rAF paints the bar; the timeout keeps boot going in a hidden tab (rAF never fires there)
async function boot(online) {
  if (S.booted) return; S.online = online;
  await setLoad(5, 'Building the beach house...'); buildLobby();
  await setLoad(25, 'Building the courts...'); buildCourt(); buildBeachCourt();
  await setLoad(40, 'Rendering icons...'); renderPoseIcons(); updateDayNight(true);
  { let fov = 70; try { fov = clamp(parseInt(localStorage.getItem('vg_fov') || '70', 10) || 70, 55, 110); } catch (e) { } const apply = v => { FOV_BASE = v; camFovCur = v; camera.fov = v; camera.updateProjectionMatrix(); $('#fovVal').textContent = v; }; apply(fov); $('#fovSel').value = fov; $('#fovSel').oninput = () => { const v = parseInt($('#fovSel').value, 10); apply(v); try { localStorage.setItem('vg_fov', v); } catch (e) { } }; }
  { let sp = 'simple'; try { sp = localStorage.getItem('vg_shaders') === 'full' ? 'full' : 'simple'; } catch (e) { } $('#shSel').value = sp; $('#shNote').textContent = 'Running: ' + (SIMPLE_SHADERS ? 'simple' : 'advanced') + ' shaders. Changing this reloads the game.'; $('#shSel').onchange = () => { const v = $('#shSel').value; try { if (v === 'full') localStorage.setItem('vg_shaders', 'full'); else localStorage.removeItem('vg_shaders'); } catch (e) { } location.reload(); }; }
  { let q = 'high'; try { q = localStorage.getItem('vg_gfx') || 'high'; } catch (e) { } applyQuality(q); $('#gfxSel').value = q; $('#gfxSel').onchange = () => { applyQuality($('#gfxSel').value); try { localStorage.setItem('vg_gfx', $('#gfxSel').value); } catch (e) { } }; }
  $('#todSel').value = TOD; $('#todSel').onchange = () => { TOD = $('#todSel').value; try { localStorage.setItem('vg_tod', TOD); } catch (e) { } updateDayNight(true); };
  LOBBY_COLL = COLLIDERS.filter(c => { let p = c; while (p && p !== lobby) p = p.parent; return p === lobby; }); COURT_COLL = COLLIDERS.filter(c => c.parent === court);   // (lobby list includes the hut, a child of its group)
  setMyRig('white'); await setLoad(55, 'Warming up effects...'); initFxLights(); warmUpFx(P.rig);
  await setLoad(65, 'Optimizing scenery...'); optimizeScenery();
  if (online) { db.ref('lobbyBalls/' + SID).onDisconnect().remove(); await setLoad(75, 'Signing in...'); const ok = await resumeSession(); if (!ok) await becomeGuest(); else onIdentityChanged(); await setLoad(90, 'Joining the lobby...'); writePresence(); AREA = areaOf(P.pos.x, P.pos.z); subscribeLobby(); lobbyRef().set(myState()); lobbyRef().onDisconnect().remove(); }
  else { me.name = 'Guest 1'; applyIdentityUI(); toast('Offline: could not reach the server. Practice mode still works.', 'err', 6000); }
  $('#online .dot').classList.toggle('on', online);
  if (online) { cleanupStale(); pruneChat(); subscribeChat(); db.ref('invites/' + SID).onDisconnect().remove(); }
  await setLoad(100, 'Ready!');
  S.booted = true; last = performance.now(); $('#loading').classList.add('hidden'); updateLockHint(); renderKeys(); applyTouch(touchWanted());
  toast('Welcome, ' + me.name, 'ok', 3000);
}
let bootTimer = setTimeout(() => boot(false), 8000);
db.ref('.info/connected').on('value', s => {
  const v = !!s.val();
  if (v && !S.booted) { clearTimeout(bootTimer); boot(true); }
  else if (S.booted) { S.online = v; $('#online .dot').classList.toggle('on', v); if (v) { writePresence(); if (S.scene === 'lobby') lobbyRef().onDisconnect().remove(); } }
});
requestAnimationFrame(frame);
</script>
</body>
</html>
