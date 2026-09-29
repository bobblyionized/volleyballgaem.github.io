/* =====================================================================
   VOLLEYBALL GAEM  —  core: utils, firebase, identity, keybinds, menu
   ===================================================================== */
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const D = Math.PI / 180;
const TAU = Math.PI * 2;
/* Frame-rate independent smoothing toward a target: the fraction to move this frame, given a rate
   in "e-folds per second". Everything that used `dt * k` now goes through this, so behaviour stops
   drifting with frame rate (the same lerp ran ~2x as fast at 120 Hz as at 60 Hz). */
const smoothT = (rate, dt) => 1 - Math.exp(-rate * dt);
/* Critically damped angular spring (exact solution, so any dt is safe). Unlike a per-frame lerp it
   carries velocity through a pose change, which is what makes limbs ease out and follow through
   instead of arriving at the new pose and stopping dead. */
function springJoint(cur, vel, tg, omega, dt) {
  const e = Math.exp(-omega * dt);
  let x = cur.x - tg.x, tmp = (vel.x + omega * x) * dt; cur.x = tg.x + (x + tmp) * e; vel.x = (vel.x - omega * tmp) * e;
  x = cur.y - tg.y; tmp = (vel.y + omega * x) * dt; cur.y = tg.y + (x + tmp) * e; vel.y = (vel.y - omega * tmp) * e;
  x = cur.z - tg.z; tmp = (vel.z + omega * x) * dt; cur.z = tg.z + (x + tmp) * e; vel.z = (vel.z - omega * tmp) * e;
}
const rnd = () => Math.random().toString(36).slice(2, 10);

function toast(msg, cls = '', ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast ' + cls; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = 0; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, ms);
}

/* compact SHA-256 (public-domain style implementation) */
function sha256(ascii) {
  ascii = unescape(encodeURIComponent(ascii));
  const rr = (v, a) => (v >>> a) | (v << (32 - a));
  const maxWord = 2 ** 32; let i, j, result = '';
  const words = []; const bits = ascii.length * 8;
  const hash = sha256.h = sha256.h || []; const k = sha256.k = sha256.k || []; let pc = k.length; const isComp = {};
  for (let c = 2; pc < 64; c++) if (!isComp[c]) { for (i = 0; i < 313; i += c) isComp[i] = c; hash[pc] = (Math.pow(c, .5) * maxWord) | 0; k[pc++] = (Math.pow(c, 1 / 3) * maxWord) | 0; }
  ascii += '\x80'; while (ascii.length % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii.length; i++) { j = ascii.charCodeAt(i); words[i >> 2] |= j << ((3 - i) % 4) * 8; }
  words[words.length] = (bits / maxWord) | 0; words[words.length] = bits;
  let h = hash.slice(0, 8);
  for (j = 0; j < words.length;) {
    const w = words.slice(j, j += 16); const old = h; h = h.slice(0, 8);
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2], a = h[0], e = h[4];
      const t1 = h[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & h[5]) ^ (~e & h[6])) + k[i] + (w[i] = i < 16 ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
      const t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & h[1]) ^ (a & h[2]) ^ (h[1] & h[2]));
      h = [(t1 + t2) | 0].concat(h); h[4] = (h[4] + t1) | 0;
    }
    for (i = 0; i < 8; i++) h[i] = (h[i] + old[i]) | 0;
  }
  for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { const b = (h[i] >> (j * 8)) & 255; result += (b < 16 ? '0' : '') + b.toString(16); }
  return result;
}

/* ---------------- Firebase ---------------- */
const firebaseConfig = {
  apiKey: "AIzaSyBL6NtFjRH2QXenQwD6UNaEb7oXqxDl74E",
  authDomain: "volleyballgaem.firebaseapp.com",
  databaseURL: "https://volleyballgaem-default-rtdb.firebaseio.com",
  projectId: "volleyballgaem",
  storageBucket: "volleyballgaem.firebasestorage.app",
  messagingSenderId: "538438186546",
  appId: "1:538438186546:web:1f7e61c47e29d4b2b72e2b"
};
/* ---- four Firebase projects, one game ----
   core    (volleyballgaem)   accounts, profiles, friends, parties, invites, chat, presence - everything that must be shared
   house   (volleyballgaems2) positions of players inside the beach house + the queue pads
   outside (volleyballgaems3) positions of players on the beach + the balls out there
   play    (volleyballgaems4) queue matchmaking, practice and casual matches
   db.ref(path) routes by the first path segment, so the rest of the code keeps calling db.ref() as before;
   'lobby' goes to whichever area server the player is currently on (see AREA / setArea in the game part). */
const FB_SERVERS = {
  house: { apiKey: "AIzaSyAmy0QIHbWKcXBYE0-PaiPmELtklU9j-l4", authDomain: "volleyballgaems2.firebaseapp.com", databaseURL: "https://volleyballgaems2-default-rtdb.firebaseio.com", projectId: "volleyballgaems2", storageBucket: "volleyballgaems2.firebasestorage.app", messagingSenderId: "1057362092599", appId: "1:1057362092599:web:8ba896052f9f66dae7d5b2" },
  outside: { apiKey: "AIzaSyDOTq1mGEhNyYL-Ouu9Tiv6PflCiibJfoc", authDomain: "volleyballgaems3.firebaseapp.com", databaseURL: "https://volleyballgaems3-default-rtdb.firebaseio.com", projectId: "volleyballgaems3", storageBucket: "volleyballgaems3.firebasestorage.app", messagingSenderId: "355391959266", appId: "1:355391959266:web:c57a204856b4f8054e2ebb" },
  play: { apiKey: "AIzaSyBGn2qiRbKyHc-92i35YMwzNpKEcqI7ogA", authDomain: "volleyballgaems4.firebaseapp.com", databaseURL: "https://volleyballgaems4-default-rtdb.firebaseio.com", projectId: "volleyballgaems4", storageBucket: "volleyballgaems4.firebasestorage.app", messagingSenderId: "303690989814", appId: "1:303690989814:web:9f7ebb88cccbf58a8c2cd7" },
};
firebase.initializeApp(firebaseConfig);
const DBS = { core: firebase.database() };
for (const name in FB_SERVERS) { try { DBS[name] = firebase.database(firebase.initializeApp(FB_SERVERS[name], name)); } catch (e) { console.warn('server ' + name + ' unavailable, using core', e); DBS[name] = DBS.core; } }
let AREA = 'house';                                   // which area server my lobby position lives on ('house' | 'outside')
const ROUTE = { lobbyBalls: 'outside', pads: 'house', queue: 'play', matches: 'play' };
const dbFor = path => { const top = String(path).split('/')[0]; if (top === 'lobby') return DBS[AREA]; return DBS[ROUTE[top] || 'core']; };
const db = { ref: path => dbFor(path).ref(path), core: DBS.core, servers: DBS };
let serverOffset = 0;
db.ref('.info/serverTimeOffset').on('value', s => serverOffset = s.val() || 0);
const snow = () => Date.now() + serverOffset;

const S = { online: false, scene: 'menu', padId: null, queue: null, match: null, booted: false };
const SID = 's' + rnd() + Date.now().toString(36);   // unique per tab
const me = { sid: SID, id: SID, name: 'Guest', guest: true, dollars: 0, friends: {}, requests: {}, lower: null, skins: {}, skin: 'default', fxs: {}, fx: 'none', model: 'boy', models: {}, emotes: {}, wheel: {}, boxes: {}, traits: {}, loadout: {} };

/* ---------------- Keybinds ---------------- */
/* Every control the game reads goes through KEYS. In 2D: A / D run, W / S aim (spike, block, bump strength,
   jump set) and climb onto / drop off the stairs. Escape always closes the menu on top of whatever it is bound to. */
const KEY_DEFAULTS = {
  moveL: 'KeyA', moveR: 'KeyD',
  block: 'KeyQ', bump: 'KeyQ', dive: 'ControlLeft', jumpSet: 'KeyE',
  groundSet: 'Mouse0', spike: 'Mouse0', toss: 'Mouse0', spawnBall: 'KeyG', serve: 'Digit1', jump: 'Space', emote: 'KeyB',
  chat: 'Slash', menu: 'KeyM'
};
// mirrored to the right of the keyboard, for players who hold the mouse in their left hand
const KEY_LEFTY = {
  moveL: 'ArrowLeft', moveR: 'ArrowRight',
  block: 'KeyP', bump: 'KeyP', dive: 'ControlRight', jumpSet: 'KeyO',
  groundSet: 'Mouse0', spike: 'Mouse0', toss: 'Mouse0', spawnBall: 'KeyL', serve: 'Digit0', jump: 'Space', emote: 'Semicolon',
  chat: 'Slash', menu: 'KeyM'
};
const KEY_LABELS = {
  moveL: 'Run Left', moveR: 'Run Right',
  block: 'Block', bump: 'Bump', dive: 'Dive', jumpSet: 'Jump Set', groundSet: 'Ground Set',
  spike: 'Spike', toss: 'Toss / Serve toss', spawnBall: 'Spawn Ball (practice)', serve: 'Serve (practice)', jump: 'Jump', emote: 'Emote Wheel',
  chat: 'Chat', menu: 'Menu'
};
const KEY_GROUPS = [
  ['Movement', ['moveL', 'moveR', 'jump', 'dive']],
  ['Ball', ['bump', 'groundSet', 'jumpSet', 'block', 'spike', 'toss', 'serve', 'spawnBall']],
  ['Interface', ['menu', 'emote', 'chat']]
];
let KEYS = Object.assign({}, KEY_DEFAULTS);
try { const s = JSON.parse(localStorage.getItem('vg_keys2d') || 'null'); if (s) { for (const k in s) if (!(k in KEY_DEFAULTS)) delete s[k]; KEYS = Object.assign({}, KEY_DEFAULTS, s); } } catch (e) { }
const BOUND = new Set();                     // every code currently in use, so the browser's own shortcut can be suppressed
function keyName(code) {
  if (!code) return '-';
  if (code.startsWith('Mouse')) return 'M' + (parseInt(code.slice(5)) + 1);
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6).toUpperCase();
  const m = {
    ControlLeft: 'CTRL', ControlRight: 'RCTRL', ShiftLeft: 'SHIFT', ShiftRight: 'RSHIFT', AltLeft: 'ALT', AltRight: 'RALT',
    MetaLeft: 'META', MetaRight: 'RMETA', Space: 'SPACE', Tab: 'TAB', Enter: 'ENTER', CapsLock: 'CAPS', Escape: 'ESC',
    Backspace: 'BKSP', Delete: 'DEL', Insert: 'INS', Home: 'HOME', End: 'END', PageUp: 'PGUP', PageDown: 'PGDN',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']',
    Minus: '-', Equal: '=', Backquote: '`'
  };
  return m[code] || code.toUpperCase();
}
const moveKeysLabel = () => keyName(KEYS.moveL) + '/' + keyName(KEYS.moveR);
function applyKeys() {                       // rebuild the lookup set and refresh anything that spells a key out
  BOUND.clear(); for (const a in KEYS) if (KEYS[a]) BOUND.add(KEYS[a]);
  const ci = $('#chatInput'); if (ci) ci.placeholder = `Press ${keyName(KEYS.chat)} to chat...`;
  const ch = $('#chatHint'); if (ch) ch.textContent = `${keyName(KEYS.chat)} to chat`;
  for (const id of ['#menuKey', '#menuKey2']) { const el = $(id); if (el) el.textContent = keyName(KEYS.menu); }
}   // the action cards rebuild themselves: updateCards() keys its signature off KEYS
let rebinding = null;
function renderKeys() {
  const list = $('#kbList'); list.innerHTML = '';
  for (const [title, actions] of KEY_GROUPS) {
    const hd = document.createElement('div'); hd.className = 'kbgrp'; hd.textContent = title; list.appendChild(hd);
    for (const a of actions) {
      const row = document.createElement('div'); row.className = 'kb';
      row.innerHTML = `<span>${KEY_LABELS[a]}</span><span class="key" data-a="${a}">${keyName(KEYS[a])}</span>`;
      row.querySelector('.key').onclick = (e) => {
        $$('.kb .key').forEach(k => { k.classList.remove('listening'); k.textContent = keyName(KEYS[k.dataset.a]); });
        rebinding = a; e.target.classList.add('listening'); e.target.textContent = '...';
        e.stopPropagation();
      };
      list.appendChild(row);
    }
  }
}
function setBind(code) {
  if (!rebinding) return;
  if (code === 'Escape' && rebinding !== 'menu') { rebinding = null; renderKeys(); return; }
  KEYS[rebinding] = code; rebinding = null;
  try { localStorage.setItem('vg_keys2d', JSON.stringify(KEYS)); } catch (e) { }
  applyKeys(); renderKeys();
}
function usePreset(preset, msg) { KEYS = Object.assign({}, preset); try { localStorage.setItem('vg_keys2d', JSON.stringify(KEYS)); } catch (e) { } applyKeys(); renderKeys(); toast(msg); }
$('#kbReset').onclick = () => { try { localStorage.removeItem('vg_keys2d'); } catch (e) { } usePreset(KEY_DEFAULTS, 'Default layout'); };
$('#kbLefty').onclick = () => usePreset(KEY_LEFTY, 'Left-handed layout');
applyKeys();

/* ---------------- The menu ----------------
   The main menu is the home screen: PLAY (queue), INVENTORY, SHOP, QUESTS, FRIENDS & PARTY, SETTINGS.
   In a match, M opens it over the court (and closes it again). */
let menuSec = 'play';
const SECTIONS = ['play', 'inventory', 'shop', 'quests', 'social', 'settings'];
function menuOpen() { return !$('#menu').classList.contains('hidden'); }
const inAMatch = () => S.scene === 'match' && !!S.match;
function openMenu(sec) {
  if (sec) menuSec = sec;
  $('#menu').classList.remove('hidden'); $('#menuChip').classList.add('hidden'); $('#menuClose').classList.toggle('hidden', !inAMatch());
  showSection(menuSec);
}
function closeMenu() { if (!inAMatch()) return; $('#menu').classList.add('hidden'); $('#menuChip').classList.remove('hidden'); rebinding = null; if (typeof onMenuClosed === 'function') onMenuClosed(); }
function showSection(sec) {
  menuSec = sec;
  $$('.mNav button').forEach(b => b.classList.toggle('on', b.dataset.sec === sec));
  for (const s of SECTIONS) $('#sec-' + s).classList.toggle('hidden', s !== sec);
  if (typeof renderSection === 'function') renderSection(sec);
}
$$('.mNav button').forEach(b => b.onclick = () => showSection(b.dataset.sec));
$('#menuClose').onclick = () => closeMenu();
$('#menuChip').onclick = () => menuOpen() ? closeMenu() : openMenu();
function closePanels() { closeMenu(); $('#openFx').classList.add('hidden'); $('#confirmBox').classList.add('hidden'); rebinding = null; }
function uiOpen() { return menuOpen() || !$('#openFx').classList.contains('hidden') || !$('#confirmBox').classList.contains('hidden'); }
function confirmDialog(title, text, okLabel = 'DELETE') {          // yes / no overlay on top of the menu; resolves true only on the red button
  return new Promise(res => {
    const box = $('#confirmBox'); $('#confirmTitle').textContent = title; $('#confirmText').textContent = text; $('#confirmYes').textContent = okLabel;
    box.classList.remove('hidden');
    const done = v => { box.classList.add('hidden'); $('#confirmYes').onclick = $('#confirmNo').onclick = null; res(v); };
    $('#confirmYes').onclick = () => done(true); $('#confirmNo').onclick = () => done(false);
  });
}
let setSec = 'account';
$$('#setNav button').forEach(b => b.onclick = () => { setSec = b.dataset.set; renderSettings(); });
function renderSettings() {
  $$('#setNav button').forEach(b => b.classList.toggle('on', b.dataset.set === setSec));
  for (const s of ['account', 'controls', 'game']) $('#set-' + s).classList.toggle('hidden', s !== setSec);
  if (setSec === 'account') renderAccount(); else if (setSec === 'controls') renderKeys();
}

/* ---------------- Identity / accounts ---------------- */
const presenceRef = db.ref('presence/' + SID);
function applyIdentityUI() {
  $('#mName').textContent = me.name; $('#accGuestName').textContent = me.name;
  $('#mSub').textContent = me.guest ? 'GUEST - LOG IN TO SAVE' : 'VOLLEYBALL GAEM PLAYER';
  $('#mMoney').textContent = me.guest ? '0' : (me.dollars || 0).toLocaleString();
  if (typeof drawAvatar === 'function') drawAvatar();
}
async function pickGuestName() {
  let used = new Set();
  try {
    const snap = await db.ref('presence').once('value');
    snap.forEach(c => { const v = c.val(); if (v && v.guest && c.key !== SID) { const m = /^Guest (\d+)$/.exec(v.name || ''); if (m) used.add(+m[1]); } });
  } catch (e) { }
  let n = 1; while (used.has(n)) n++;
  return 'Guest ' + n;
}
function writePresence() {
  if (!S.online) return;
  presenceRef.set({ name: me.name, guest: me.guest, id: me.id, t: firebase.database.ServerValue.TIMESTAMP });
  presenceRef.onDisconnect().remove();
}
async function becomeGuest() {
  me.guest = true; me.id = SID; me.lower = null; me.dollars = 0; me.friends = {}; me.requests = {}; me.skins = {}; me.skin = 'default'; me.fxs = {}; me.fx = 'none'; me.model = 'boy'; me.models = {}; me.emotes = {}; me.wheel = {}; me.boxes = {}; me.traits = {}; me.loadout = {};
  me.name = await pickGuestName();
  localStorage.removeItem('vg_session');
  applyIdentityUI(); writePresence(); onIdentityChanged();
}
function setAccount(lower, rec, profile) {
  me.guest = false; me.id = rec.id; me.lower = lower; me.name = profile.name; me.dollars = profile.dollars || 0;
  applyIdentityUI(); writePresence(); onIdentityChanged();
}
const validName = n => /^[A-Za-z0-9_]{3,16}$/.test(n);
async function signup(name, pass) {
  if (!validName(name)) throw 'Username must be 3-16 letters, numbers or _';
  if (pass.length < 4) throw 'Password must be at least 4 characters';
  const lower = name.toLowerCase(); const id = 'u' + rnd() + rnd(); const salt = rnd(); const token = rnd() + rnd();
  const res = await db.ref('usernames/' + lower).transaction(cur => { if (cur) return; return { id, salt, hash: sha256(salt + pass), token }; });
  if (!res.committed) throw 'That username is taken';
  await db.ref('profiles/' + id).set({ name, dollars: 0, created: firebase.database.ServerValue.TIMESTAMP });
  localStorage.setItem('vg_session', JSON.stringify({ lower, token }));
  setAccount(lower, res.snapshot.val(), { name, dollars: 0 });
}
async function login(name, pass) {
  const lower = (name || '').toLowerCase();
  const rec = (await db.ref('usernames/' + lower).once('value')).val();
  if (!rec) throw 'No account with that username';
  if (rec.hash !== sha256(rec.salt + pass)) throw 'Wrong password';
  const token = rnd() + rnd(); await db.ref('usernames/' + lower + '/token').set(token); rec.token = token;
  const profile = (await db.ref('profiles/' + rec.id).once('value')).val() || { name, dollars: 0 };
  localStorage.setItem('vg_session', JSON.stringify({ lower, token }));
  setAccount(lower, rec, profile);
}
async function resumeSession() {
  try {
    const s = JSON.parse(localStorage.getItem('vg_session') || 'null'); if (!s) return false;
    const rec = (await db.ref('usernames/' + s.lower).once('value')).val();
    if (!rec || rec.token !== s.token) { localStorage.removeItem('vg_session'); return false; }
    const profile = (await db.ref('profiles/' + rec.id).once('value')).val() || { name: s.lower, dollars: 0 };
    setAccount(s.lower, rec, profile); return true;
  } catch (e) { return false; }
}
async function changePassword(oldP, newP) {
  if (me.guest) throw 'Not logged in';
  if (newP.length < 4) throw 'New password must be at least 4 characters';
  const ref = db.ref('usernames/' + me.lower); const rec = (await ref.once('value')).val();
  if (rec.hash !== sha256(rec.salt + oldP)) throw 'Current password is wrong';
  const salt = rnd(); await ref.update({ salt, hash: sha256(salt + newP) });
}
async function changeUsername(newName, pass) {
  if (me.guest) throw 'Not logged in';
  if (!validName(newName)) throw 'Username must be 3-16 letters, numbers or _';
  const oldRef = db.ref('usernames/' + me.lower); const rec = (await oldRef.once('value')).val();
  if (rec.hash !== sha256(rec.salt + pass)) throw 'Wrong password';
  const dollars = (await db.ref('profiles/' + me.id + '/dollars').once('value')).val() || 0;
  if (dollars < 5000) throw `You need $5,000 (you have $${dollars.toLocaleString()})`;
  const lower = newName.toLowerCase();
  if (lower !== me.lower) {
    const res = await db.ref('usernames/' + lower).transaction(cur => { if (cur) return; return rec; });
    if (!res.committed) throw 'That username is taken';
    await oldRef.remove();
  }
  await db.ref('profiles/' + me.id).update({ name: newName, dollars: dollars - 5000 });
  localStorage.setItem('vg_session', JSON.stringify({ lower, token: rec.token }));
  me.lower = lower; me.name = newName; me.dollars = dollars - 5000;
  applyIdentityUI(); writePresence(); onIdentityChanged();
}
function addDollars(n) {
  if (me.guest || !n) return;
  db.ref('profiles/' + me.id + '/dollars').transaction(c => (c || 0) + n);
}

/* account panel */
let accMode = 'login';
$('#tabLogin').onclick = () => { accMode = 'login'; renderAccount(); };   // (the account form lives in Settings > Account)
$('#tabSignup').onclick = () => { accMode = 'signup'; renderAccount(); };
function renderAccount() {
  $('#accGuest').classList.toggle('hidden', !me.guest);
  $('#accUser2').classList.toggle('hidden', me.guest);
  $('#tabLogin').classList.toggle('on', accMode === 'login'); $('#tabSignup').classList.toggle('on', accMode === 'signup');
  $('#accSubmit').textContent = accMode === 'login' ? 'LOG IN' : 'SIGN UP';
  $('#accName').textContent = me.name; $('#accMoney').textContent = '$' + (me.dollars || 0).toLocaleString();
}
$('#accSubmit').onclick = async () => {
  const u = $('#accUser').value.trim(), p = $('#accPass').value;
  try { if (accMode === 'login') await login(u, p); else await signup(u, p); toast('Welcome, ' + me.name + '!', 'ok'); $('#accPass').value = ''; renderAccount(); }
  catch (e) { toast(typeof e === 'string' ? e : 'Error: ' + (e.message || e), 'err'); }
};
$('#accPass').onkeydown = e => { if (e.key === 'Enter') $('#accSubmit').click(); };
$('#cpBtn').onclick = async () => { try { await changePassword($('#cpOld').value, $('#cpNew').value); $('#cpOld').value = $('#cpNew').value = ''; toast('Password changed', 'ok'); } catch (e) { toast(String(e), 'err'); } };
$('#cuBtn').onclick = async () => { try { await changeUsername($('#cuNew').value.trim(), $('#cuPass').value); $('#cuNew').value = $('#cuPass').value = ''; toast('Username changed to ' + me.name, 'ok'); renderAccount(); } catch (e) { toast(String(e), 'err'); } };
$('#logoutBtn').onclick = async () => { await becomeGuest(); renderAccount(); toast('Logged out. You are now ' + me.name); };

/* ---------------- Friends ---------------- */
let profileUnsub = null, friendsUnsub = null, reqUnsub = null;
const onlineIds = new Map(); // account id -> count of sessions
db.ref('presence').on('value', snap => {
  onlineIds.clear(); let n = 0;
  snap.forEach(c => { const v = c.val(); if (!v) return; n++; onlineIds.set(v.id, (onlineIds.get(v.id) || 0) + 1); });
  $('#onlineCount').textContent = n;
  if (menuOpen() && menuSec === 'social') renderFriends();
});
function onIdentityChanged() {
  if (profileUnsub) profileUnsub(); if (friendsUnsub) friendsUnsub(); if (reqUnsub) reqUnsub();
  profileUnsub = friendsUnsub = reqUnsub = null;
  if (!me.guest) {
    const pr = db.ref('profiles/' + me.id); const cb = pr.on('value', s => { const v = s.val(); if (v) { me.dollars = v.dollars || 0; if (v.name) me.name = v.name; me.skins = v.skins || {}; me.skin = v.skin || 'default'; me.fxs = v.fxs || {}; me.fx = v.fx || 'none'; me.model = v.model || 'boy'; me.models = v.models || {}; me.emotes = v.emotes || {}; me.wheel = v.wheel || {}; me.boxes = v.boxes || {}; me.traits = v.traits || {}; me.loadout = v.loadout || {}; if (typeof onCosmeticsChanged === 'function') onCosmeticsChanged(); applyIdentityUI(); if (menuOpen()) showSection(menuSec); } });
    profileUnsub = () => pr.off('value', cb);
    const fr = db.ref('friends/' + me.id); const cb2 = fr.on('value', s => { me.friends = s.val() || {}; renderFriends(); });
    friendsUnsub = () => fr.off('value', cb2);
    const rq = db.ref('requests/' + me.id); const cb3 = rq.on('value', s => { me.requests = s.val() || {}; renderFriends(); const n = Object.keys(me.requests).length; $('#friendBadge').innerHTML = n ? ` <span class="badge">${n}</span>` : ''; });
    reqUnsub = () => rq.off('value', cb3);
  } else { $('#friendBadge').innerHTML = ''; renderFriends(); }
  if (typeof onIdentityChangedGame === 'function') onIdentityChangedGame();
}
function renderFriends() {
  $('#frGuest').classList.toggle('hidden', !me.guest); $('#frMain').classList.toggle('hidden', me.guest);
  if (me.guest) return;
  const reqs = $('#frReqs'); reqs.innerHTML = '';
  const rk = Object.keys(me.requests); $('#frReqCount').textContent = rk.length ? `(${rk.length})` : '';
  if (!rk.length) reqs.innerHTML = '<small style="opacity:.5">No pending requests</small>';
  for (const from of rk) {
    const d = document.createElement('div'); d.className = 'fr';
    d.innerHTML = `<span>${me.requests[from]}</span><span class="row"><button class="btn small green">Accept</button><button class="btn small red">Decline</button></span>`;
    d.querySelectorAll('button')[0].onclick = () => acceptFriend(from, me.requests[from]);
    d.querySelectorAll('button')[1].onclick = () => db.ref('requests/' + me.id + '/' + from).remove();
    reqs.appendChild(d);
  }
  const list = $('#frList'); list.innerHTML = '';
  const fk = Object.keys(me.friends);
  if (!fk.length) list.innerHTML = '<small style="opacity:.5">No friends yet. Add someone by username!</small>';
  for (const fid of fk) {
    const on = onlineIds.has(fid);
    const d = document.createElement('div'); d.className = 'fr';
    d.innerHTML = `<span><i class="st ${on ? 'on' : ''}"></i>${me.friends[fid]}</span><button class="btn small grey">Remove</button>`;
    d.querySelector('button').onclick = () => { db.ref('friends/' + me.id + '/' + fid).remove(); db.ref('friends/' + fid + '/' + me.id).remove(); };
    list.appendChild(d);
  }
}
async function sendFriendRequest(name) {
  if (me.guest) throw 'Sign in first';
  const lower = (name || '').trim().toLowerCase(); if (!lower) return;
  if (lower === me.lower) throw "That's you!";
  const rec = (await db.ref('usernames/' + lower).once('value')).val(); if (!rec) throw 'No player named ' + name;
  if (me.friends[rec.id]) throw 'Already friends';
  const theirReq = (await db.ref('requests/' + me.id + '/' + rec.id).once('value')).val();
  if (theirReq) { await acceptFriend(rec.id, theirReq); return; }
  await db.ref('requests/' + rec.id + '/' + me.id).set(me.name);
}
async function acceptFriend(fid, fname) {
  const prof = (await db.ref('profiles/' + fid).once('value')).val();
  await db.ref('friends/' + me.id + '/' + fid).set(prof ? prof.name : fname);
  await db.ref('friends/' + fid + '/' + me.id).set(me.name);
  await db.ref('requests/' + me.id + '/' + fid).remove();
  await db.ref('requests/' + fid + '/' + me.id).remove();
  toast('You are now friends with ' + (prof ? prof.name : fname), 'ok');
}
$('#frAddBtn').onclick = async () => { try { await sendFriendRequest($('#frAddName').value); toast('Friend request sent', 'ok'); $('#frAddName').value = ''; } catch (e) { toast(String(e), 'err'); } };
$('#frAddName').onkeydown = e => { if (e.key === 'Enter') $('#frAddBtn').click(); };
async function isFriendOf(ownerId) {
  if (ownerId === me.id) return true;
  if (me.guest) return false;
  return !!(await db.ref('friends/' + ownerId + '/' + me.id).once('value')).val();
}
