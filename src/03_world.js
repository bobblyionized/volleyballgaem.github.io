/* =====================================================================
   3D WORLD: renderer, rig, lobby (beach house), pads, court, ball, icons
   ===================================================================== */
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));   // high-DPI screens render at 1.25x, not 1.5x: ~30% fewer pixels, hard to tell apart
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;          // plain PCF: a quarter of the shadow taps of PCFSoft; the 1k map + radius keeps edges soft enough
renderer.shadowMap.autoUpdate = false;                 // refreshed every third frame from the tick
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;    // filmic roll-off: highlights bloom out softly instead of clipping flat
renderer.toneMappingExposure = 0.85;
/* ---- shader pipeline: FULL (baked env lighting from a shader sky dome, wave shader on the water) or SIMPLE.
   The full path needs half-float render targets for the env bake; on GPUs / drivers without them (most Chromebooks,
   many Mali / Adreno / PowerVR parts, software renderers) the bake comes back broken and every lit surface turns
   white. SIMPLE uses no custom shaders at all: a gradient-textured sky dome, plain lights for ambient, standard
   water - and it is what those machines get automatically. Menu > Shaders overrides the auto choice. */
const SIMPLE_SHADERS = (() => {
  let pref = null; try { pref = localStorage.getItem('vg_shaders'); } catch (e) { }
  return pref !== 'full';                                                 // simple is the default for everyone; Menu > Shaders switches to the advanced pipeline on purpose
})();
const scene = new THREE.Scene();
const SKY = 0x8fd0f5;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 60, 160);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 300);function resize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }
addEventListener('resize', resize); resize();

const hemi = new THREE.HemisphereLight(0xdff2ff, 0xc9b08a, 0.5); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 0.7); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = -18; sun.shadow.camera.right = 18; sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18; sun.shadow.camera.near = 1; sun.shadow.camera.far = 90;   // 36 m box around the player: cheaper pass, sharper shadows
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.05; sun.shadow.radius = 2;   // normalBias keeps the filleted edges free of acne
sun.position.set(14, 26, 10); scene.add(sun); scene.add(sun.target);
const bounce = new THREE.DirectionalLight(0xbcd8ff, 0.2); bounce.castShadow = false; scene.add(bounce);   // cool fill from the shadow side, so shadowed faces stay readable
const SUN_DIR = new THREE.Vector3(0.5, 0.8, -0.3).normalize();
const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff1a8, fog: false })); scene.add(sunMesh);
/* The moon: a cratered disc with a soft halo behind it. It is the visible source of the
   directional light at night, so it is worth more than a flat white ball. */
const moonMesh = new THREE.Group(); scene.add(moonMesh);
{
  const face = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#eef1ff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {                                  // maria and craters
      const r = 6 + Math.random() * 26, cx = Math.random() * w, cy = Math.random() * h;
      g.fillStyle = ['rgba(176,186,222,.55)', 'rgba(198,206,238,.5)', 'rgba(156,167,206,.4)'][i % 3];
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(246,248,255,.45)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r * 0.92, 0, TAU); g.stroke();
    }
  });
  const disc = new THREE.Mesh(new THREE.SphereGeometry(5, 24, 18), new THREE.MeshBasicMaterial({ color: 0xffffff, map: face, fog: false }));
  moonMesh.add(disc);
  const haloTex = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, w * 0.16, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(210,225,255,.85)'); gr.addColorStop(0.35, 'rgba(160,190,255,.28)'); gr.addColorStop(1, 'rgba(120,160,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  halo.position.z = -1; moonMesh.add(halo); moonMesh.userData.halo = halo;
}
function estHours() {   // hours (0-24, fractional) in US Eastern time
  try { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date()); const g = t => +(p.find(x => x.type === t) || {}).value || 0; return (g('hour') % 24) + g('minute') / 60 + g('second') / 3600; }
  catch (e) { const d = new Date(); return d.getUTCHours() - 5 + d.getUTCMinutes() / 60; }
}
/* ---- sky dome ---------------------------------------------------------------
   A shaded gradient (zenith -> horizon -> haze) with a warm halo around the sun, instead of
   a flat clear colour. One draw call, no depth write, parented to nothing and moved onto the
   camera every frame so it never clips. It doubles as the source for the ambient env map below. */
const SKY_U = {
  top: { value: new THREE.Color(0x2f7fd4) }, mid: { value: new THREE.Color(0x8fd0f5) },
  bottom: { value: new THREE.Color(0xdcefff) }, sunCol: { value: new THREE.Color(0xffeec0) },
  sunDir: { value: SUN_DIR }, sunAmt: { value: 1 }
};
const AMB_K = SIMPLE_SHADERS ? 4.5 : 1;   // without the baked env map the hemisphere light has to carry the ambient on its own
const SKY_MAT = new THREE.ShaderMaterial({
  uniforms: SKY_U, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 vW; void main(){ vW = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: [
    'uniform vec3 top, mid, bottom, sunCol, sunDir; uniform float sunAmt; varying vec3 vW;',
    'void main(){',
    '  float h = clamp(vW.y, -1.0, 1.0);',
    '  vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.62)) : mix(mid, bottom, pow(-h, 0.5));',
    '  float d = max(dot(normalize(vW), normalize(sunDir)), 0.0);',
    '  c += sunCol * (pow(d, 7.0) * 0.30 + pow(d, 190.0) * 1.4) * sunAmt;',   // broad halo plus a tight bloom on the disc
    '  c += bottom * pow(1.0 - abs(h), 10.0) * 0.22;',                        // haze band sitting on the horizon
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n')
});
let SKY_TEX = null, skyTexCanvas = null;
function paintSimpleSky() {                      // simple shaders: the dome is a plain gradient texture repainted whenever the palette changes
  if (!skyTexCanvas) { skyTexCanvas = document.createElement('canvas'); skyTexCanvas.width = 4; skyTexCanvas.height = 256; }
  const g = skyTexCanvas.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256);
  const hex = c => '#' + c.getHexString();
  gr.addColorStop(0, hex(SKY_U.top.value)); gr.addColorStop(0.42, hex(SKY_U.mid.value)); gr.addColorStop(0.52, hex(SKY_U.bottom.value)); gr.addColorStop(1, hex(SKY_U.bottom.value));
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  if (!SKY_TEX) { SKY_TEX = new THREE.CanvasTexture(skyTexCanvas); SKY_TEX.encoding = THREE.sRGBEncoding; } else SKY_TEX.needsUpdate = true;
  return SKY_TEX;
}
const sky = new THREE.Mesh(new THREE.SphereGeometry(260, 32, 20), SIMPLE_SHADERS ? new THREE.MeshBasicMaterial({ map: paintSimpleSky(), side: THREE.BackSide, depthWrite: false, fog: false }) : SKY_MAT);
sky.frustumCulled = false; sky.renderOrder = -1000; scene.add(sky);
const SKY_DAY = { top: 0x2f7fd4, mid: 0x8fd0f5, bot: 0xdcefff, sun: 0xffeec0 };
const SKY_DUSK = { top: 0x24417a, mid: 0xf0a06a, bot: 0xffd6a0, sun: 0xff9a4a };
const SKY_NIGHT = { top: 0x0a1233, mid: 0x16225a, bot: 0x2e3d7e, sun: 0xcfdcff };   // a real moonlit night is deep blue, never black
const _skyB = new THREE.Color();
function applySkyPalette(a, b, k) {
  SKY_U.top.value.setHex(a.top).lerp(_skyB.setHex(b.top), k);
  SKY_U.mid.value.setHex(a.mid).lerp(_skyB.setHex(b.mid), k);
  SKY_U.bottom.value.setHex(a.bot).lerp(_skyB.setHex(b.bot), k);
  SKY_U.sunCol.value.setHex(a.sun).lerp(_skyB.setHex(b.sun), k);
}
/* Ambient image-based lighting, baked from the same dome. Every MeshStandardMaterial in the scene
   picks this up through scene.environment, which is what stops shadowed faces reading as dead flat
   grey. Regenerated only when the time of day changes, never per frame. */
/* The bake uses its OWN copy of the sky uniforms, deliberately floored in brightness.
   PMREM packs its output as RGBE, and a near-black night sky lands at the bottom of that
   format's range, where the result comes back unusable — it doesn't merely dim the ambient,
   it drives every MeshStandardMaterial to pure black no matter how much direct light is on
   it. (Verified: night lighting values plus the DAY env texture lights the scene fine.)
   So the dome is lifted into a healthy range before baking and night darkness is carried by
   the lights instead, which is where it belongs anyway. */
let pmrem = null, envRT = null, envDome = null;
const ENV_U = {
  top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, bottom: { value: new THREE.Color() },
  sunCol: { value: new THREE.Color() }, sunDir: { value: SUN_DIR }, sunAmt: { value: 1 }
};
const ENV_MAT = new THREE.ShaderMaterial({ uniforms: ENV_U, side: THREE.BackSide, depthWrite: false, fog: false, vertexShader: SKY_MAT.vertexShader, fragmentShader: SKY_MAT.fragmentShader });
const ENV_LOW = 0.35;                                     // nothing in the bake may sit darker than this
function refreshEnv() {
  if (SIMPLE_SHADERS) { scene.environment = null; return; }
  try {
    if (!pmrem) { pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader(); }
    if (!envDome) { envDome = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 16), ENV_MAT); envDome.frustumCulled = false; }
    let peak = 0;
    for (const k of ['top', 'mid', 'bottom']) { const c = ENV_U[k].value.copy(SKY_U[k].value); peak = Math.max(peak, c.r, c.g, c.b); }
    ENV_U.sunCol.value.copy(SKY_U.sunCol.value); ENV_U.sunAmt.value = SKY_U.sunAmt.value;
    /* It is the DARKEST part of the dome that ruins the bake, not the average, so a dim sky gets
       normalised to peak 1 and then lifted off the floor. A daylight sky already spans a healthy
       range and is left exactly as it is. */
    if (peak > 1e-4 && peak < 0.9) {
      const lift = 1 / peak;
      for (const k of ['top', 'mid', 'bottom']) {
        const c = ENV_U[k].value.multiplyScalar(lift);
        c.setRGB(ENV_LOW + c.r * (1 - ENV_LOW), ENV_LOW + c.g * (1 - ENV_LOW), ENV_LOW + c.b * (1 - ENV_LOW));
      }
    }
    const s = new THREE.Scene(); s.add(envDome);
    const rt = pmrem.fromScene(s, 0, 1, 200);
    if (envRT) envRT.dispose();
    envRT = rt; scene.environment = rt.texture;
  } catch (e) { scene.environment = null; }
}
/* How strongly the baked ambient is applied. Because the bake above is normalised, this is what
   actually carries "how dark is it right now", and it is the one knob to turn for night brightness. */
let ENV_INT = 0.55, envIntApplied = -1;
function applyEnvIntensity(v) {
  if (Math.abs(v - envIntApplied) < 1e-3) return;
  ENV_INT = v; envIntApplied = v;
  const seen = new Set();
  const walk = root => root && root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) if (m.isMeshStandardMaterial && !seen.has(m)) { seen.add(m); m.envMapIntensity = v; }
  });
  walk(scene); walk(typeof court !== 'undefined' ? court : null); walk(typeof beachCourt !== 'undefined' ? beachCourt : null);
}
const DAY_SKY = new THREE.Color(0x8fd0f5), DUSK_SKY = new THREE.Color(0xf3a56b), NIGHT_SKY = new THREE.Color(0x0c1230);
const LIGHT_SCALE = 1.45;   // overall scene shading (balls compensate with emissive so they stay the same brightness)
let isNight = false;
let TOD = 'relative'; try { TOD = localStorage.getItem('vg_tod') || 'relative'; } catch (e) { }
function updateDayNight(force) {
  const h = TOD === 'day' ? 10.5 : TOD === 'night' ? 1 : estHours(); const day = h >= 8 && h < 20; isNight = !day;
  let a, el;
  if (day) { a = (h - 8) / 12 * Math.PI; el = Math.sin(a); }
  else { a = (((h - 20) + 24) % 24) / 12 * Math.PI; el = Math.sin(a); }
  SUN_DIR.set(Math.cos(a) * 0.9, Math.max(0.05, el), -0.35).normalize();   // rises in the east, sets in the west, over the sea side
  bounce.position.set(-SUN_DIR.x * 30, 14, -SUN_DIR.z * 30);                                  // opposite the sun, slightly above
  sunMesh.visible = day; moonMesh.visible = !day; if (typeof applyGymLights === 'function') applyGymLights();
  if (day) {
    sun.intensity = (0.24 + 0.42 * el) * LIGHT_SCALE; sun.color.setHex(el < 0.25 ? 0xffb070 : 0xfff0d0); hemi.intensity = (0.055 + 0.04 * el) * LIGHT_SCALE * AMB_K; hemi.color.setHex(el < 0.25 ? 0xffd0b0 : 0xdff2ff); hemi.groundColor.setHex(0xd8b890);
    bounce.intensity = (0.06 + 0.05 * el) * LIGHT_SCALE * (SIMPLE_SHADERS ? 1.6 : 1); bounce.color.setHex(0xbcd8ff);   // same total light as before, but ~2.2:1 key-to-fill so the new shadows actually read
    applySkyPalette(SKY_DUSK, SKY_DAY, clamp(el / 0.3, 0, 1)); SKY_U.sunAmt.value = 1;
    const horizon = SKY_U.bottom.value;
    if (S.scene === 'lobby' || (S.match && S.match.map === 'beach')) { scene.background = SKY_U.mid.value.clone(); if (scene.fog) scene.fog.color.copy(horizon); }
  } else {
    /* Moonlight. The key light keeps pointing along SUN_DIR, which at night is where the moon
       disc sits, so the moon really is casting the shadows you see. It is far dimmer and much
       bluer than daylight, with a strong cool ambient underneath — night, but legible. */
    sun.intensity = 0.15 * LIGHT_SCALE; sun.color.setHex(0x9db8ff);
    hemi.intensity = 0.05 * LIGHT_SCALE * AMB_K; hemi.color.setHex(0x4a63ad); hemi.groundColor.setHex(0x1c2142);
    bounce.intensity = 0.04 * LIGHT_SCALE; bounce.color.setHex(0x6b85d8);
    applySkyPalette(SKY_NIGHT, SKY_NIGHT, 0); SKY_U.sunAmt.value = 0.9;   // the moon gets its own halo in the dome
    if (S.scene === 'lobby' || (S.match && S.match.map === 'beach')) { scene.background = SKY_U.mid.value.clone(); if (scene.fog) scene.fog.color.copy(SKY_U.bottom.value); }
  }
  if (typeof refreshEnv === 'function') { refreshEnv(); applyEnvIntensity(day ? 0.55 : 0.10); }   // the ambient env map is baked from the dome, so it follows the sky
  if (SIMPLE_SHADERS) paintSimpleSky();
}
setInterval(updateDayNight, 15000);

/* ---- helpers ---- */
const MAT_CACHE = new Map();                          // plain mat(colour) calls share one material per colour: the static merge can then fold every same-coloured prop together (draw calls), and shader programs are shared
const mat = (color, extra = {}) => {
  const plain = !extra || Object.keys(extra).length === 0;
  if (plain && MAT_CACHE.has(color)) return MAT_CACHE.get(color);
  const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.95, metalness: 0, envMapIntensity: ENV_INT }, extra || {}));
  if (plain) MAT_CACHE.set(color, m);
  return m;
};

/* Rounded box. Same six material groups and UV layout as THREE.BoxGeometry (the jersey number, the face
   and every other per-face texture rely on that), but the edges are filleted and the shoulder normals are
   computed analytically so shading flows across the seams instead of breaking at them.
   Grid lines are placed only where the fillet needs them, so a 12 m wall costs the same as a 20 cm limb. */
const BEVEL = 0.06;                                   // fillet radius as a fraction of the smallest side
function roundedBoxGeo(w, h, d, rr, k = 2) {
  const r = Math.min(rr, w * 0.495, h * 0.495, d * 0.495);
  if (!(r > 1e-4)) return new THREE.BoxGeometry(w, h, d);
  const inner = [w / 2 - r, h / 2 - r, d / 2 - r];
  const ax = L => { const lo = -L / 2, hi = L / 2 - r, o = []; for (let i = 0; i <= k; i++) o.push(lo + r * i / k); for (let i = 0; i <= k; i++) o.push(hi + r * i / k); return o; };
  const cx = ax(w), cy = ax(h), cz = ax(d);
  const pos = [], nor = [], uvs = [], idx = [], groups = [], t = [0, 0, 0];
  const plane = (u, v, n, ud, vd, uc, vc, uL, vL, nHalf) => {
    const start = idx.length, base = pos.length / 3, gw = uc.length;
    for (let j = 0; j < vc.length; j++) for (let i = 0; i < gw; i++) {
      t[u] = uc[i] * ud; t[v] = vc[j] * vd; t[n] = nHalf;
      const qx = clamp(t[0], -inner[0], inner[0]), qy = clamp(t[1], -inner[1], inner[1]), qz = clamp(t[2], -inner[2], inner[2]);
      let dx = t[0] - qx, dy = t[1] - qy, dz = t[2] - qz;
      const len = Math.hypot(dx, dy, dz) || 1; dx /= len; dy /= len; dz /= len;
      pos.push(qx + dx * r, qy + dy * r, qz + dz * r); nor.push(dx, dy, dz);
      uvs.push((uc[i] + uL / 2) / uL, 1 - (vc[j] + vL / 2) / vL);
    }
    for (let j = 0; j < vc.length - 1; j++) for (let i = 0; i < gw - 1; i++) {
      const a = base + i + gw * j, b = base + i + gw * (j + 1), c = base + i + 1 + gw * (j + 1), e = base + i + 1 + gw * j;
      idx.push(a, b, e, b, c, e);
    }
    groups.push([start, idx.length - start]);
  };
  plane(2, 1, 0, -1, -1, cz, cy, d, h, w / 2); plane(2, 1, 0, 1, -1, cz, cy, d, h, -w / 2);    // +x, -x
  plane(0, 2, 1, 1, 1, cx, cz, w, d, h / 2); plane(0, 2, 1, 1, -1, cx, cz, w, d, -h / 2);      // +y, -y
  plane(0, 1, 2, 1, -1, cx, cy, w, h, d / 2); plane(0, 1, 2, -1, -1, cx, cy, w, h, -d / 2);    // +z, -z
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx); groups.forEach((gr, i) => g.addGroup(gr[0], gr[1], i));
  return g;
}
const GEO_CACHE = new Map();
function boxGeo(w, h, d, rr) {
  if (rr === undefined && Math.min(w, h, d) < 0.12) { const key = 'p' + w + ',' + h + ',' + d; let g = GEO_CACHE.get(key); if (!g) { g = new THREE.BoxGeometry(w, h, d); GEO_CACHE.set(key, g); } return g; }   // thin trim: plain box (12 tris instead of 108)
  const r = rr === undefined ? Math.min(Math.min(w, h, d) * BEVEL, 0.04) : rr;
  const k = 1;                                            // one chamfer ring everywhere: a third of the triangles of the old two-ring fillet on small parts, same silhouette at play distance
  const key = w + ',' + h + ',' + d + ',' + r.toFixed(4) + ',' + k;
  let g = GEO_CACHE.get(key); if (!g) { g = roundedBoxGeo(w, h, d, r, k); GEO_CACHE.set(key, g); }
  return g;
}
function box(w, h, d, m, x = 0, y = 0, z = 0, parent) { const o = new THREE.Mesh(boxGeo(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; (parent || scene).add(o); return o; }
function cyl(rt, rb, h, m, x = 0, y = 0, z = 0, parent, seg = 24) { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; (parent || scene).add(o); return o; }
/* A blade shaded light on top and dark underneath, baked into a vertex-colour attribute.
   The obvious way to do this is a six-material array on the rounded box � but three.js issues one
   draw call per material group, so that costs SIX draws for one leaf, and a palm has thirty-odd.
   Baking the gradient into vertex colours gets the same look for one draw, and the geometry is
   cached per (size, colour) pair so a whole beach of palms shares a handful of buffers. */
const TWOTONE_CACHE = new Map();
let TWOTONE_MAT = null;
const twoToneMat = () => TWOTONE_MAT || (TWOTONE_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, vertexColors: true, envMapIntensity: 0.55 }));
function twoToneGeo(w, h, d, topHex, botHex) {
  const key = w + ',' + h + ',' + d + ',' + topHex + ',' + botHex;
  let g = TWOTONE_CACHE.get(key); if (g) return g;
  g = boxGeo(w, h, d).clone(); g.clearGroups();
  const n = g.attributes.normal, cnt = n.count, col = new Float32Array(cnt * 3);
  const top = new THREE.Color(topHex), bot = new THREE.Color(botHex), tmp = new THREE.Color();
  for (let i = 0; i < cnt; i++) {
    tmp.copy(bot).lerp(top, clamp(n.getY(i) * 0.5 + 0.5, 0, 1));
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  TWOTONE_CACHE.set(key, g); return g;
}
function leafBlade(w, h, d, topHex, botHex, x, y, z, parent, cast) {
  const o = new THREE.Mesh(twoToneGeo(w, h, d, topHex, botHex), twoToneMat());
  o.position.set(x, y, z); o.castShadow = !!cast; o.receiveShadow = true; parent.add(o); return o;
}
/* Spheres, cached by radius. Used for the joint caps that keep limbs solid when they bend hard. */
const SPH_CACHE = new Map();
function sphGeo(r, seg = 12) { const k = r.toFixed(3) + ',' + seg; let g = SPH_CACHE.get(k); if (!g) { g = new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)); SPH_CACHE.set(k, g); } return g; }
function ball(r, m, x = 0, y = 0, z = 0, parent, seg = 12) { const o = new THREE.Mesh(sphGeo(r, seg), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; (parent || scene).add(o); return o; }
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function fitText(g, text, size, maxW, style = '900') { g.font = `${style} ${size}px Montserrat, Arial`; while (g.measureText(text).width > maxW && size > 8) { size -= 2; g.font = `${style} ${size}px Montserrat, Arial`; } return size; }
function textPlane(w, h, text, opts = {}) {
  const tex = canvasTex(opts.pw || 1024, opts.ph || 256, (g, W, H) => {
    if (opts.bg) { g.fillStyle = opts.bg; g.fillRect(0, 0, W, H); }
    g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, text, opts.size || 150, W * 0.9);
    g.fillStyle = opts.color || '#fff'; g.fillText(text, W / 2, H / 2);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: !opts.bg, side: THREE.DoubleSide }));
}

/* =====================================================================
   RIG  (blocky, Roblox-like, jersey)
   ===================================================================== */
const SKIN = mat(0xf3d1b0), SHOE = mat(0x1a1a1a), HAIR = mat(0xe8cf7a), HAIR_TIP = mat(0x2a5fe0);
const HIP_Y = 0.86, TORSO_H = 0.58, SHOULDER_Y = HIP_Y + TORSO_H - 0.06, HEAD_Y = HIP_Y + TORSO_H;   // human proportions: legs ~half the height
const RIG_SCALE = 0.86;   // ~1.7m tall
const JERSEY = {};
function jerseyTex(variant, face) {
  const dark = variant === 'black'; const base = dark ? '#151515' : '#f5f5f5'; const ink = dark ? '#d9b44a' : '#111'; const trim = dark ? '#7c8f57' : '#d4b45a';
  return canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    if (face === 'front' || face === 'back') {
      g.fillStyle = trim; g.fillRect(0, 0, W, 14); g.fillRect(0, 0, 40, 60); g.fillRect(W - 40, 0, 40, 60);   // collar / shoulders
      g.fillStyle = base; g.beginPath(); g.moveTo(W / 2 - 40, 0); g.lineTo(W / 2 + 40, 0); g.lineTo(W / 2, 34); g.fill();
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = ink;
      g.font = '900 150px Montserrat, Arial'; g.fillText('1', W / 2, H / 2 + 20);
      if (face === 'front') {
        g.font = '800 30px Montserrat, Arial'; g.fillText('vbj', W - 56, 72);
        g.beginPath(); g.arc(52, 74, 20, 0, Math.PI * 2); g.fillStyle = dark ? '#3a4a2a' : '#fff'; g.fill(); g.lineWidth = 3; g.strokeStyle = ink; g.stroke();
        g.beginPath(); g.moveTo(34, 68); g.quadraticCurveTo(52, 60, 70, 68); g.moveTo(40, 88); g.quadraticCurveTo(52, 74, 64, 88); g.stroke();
      }
      g.fillStyle = trim; g.fillRect(0, H - 10, W, 10);
    }
  });
}
let TUX_MATS = null;
function tuxMats() {
  if (TUX_MATS) return TUX_MATS;
  const front = canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#111'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f7f7f7'; g.beginPath(); g.moveTo(W / 2 - 46, 0); g.lineTo(W / 2 + 46, 0); g.lineTo(W / 2 + 22, H); g.lineTo(W / 2 - 22, H); g.fill();   // shirt front
    g.fillStyle = '#1a1a1a'; g.beginPath(); g.moveTo(W / 2 - 46, 0); g.lineTo(W / 2 - 10, 60); g.lineTo(W / 2 - 46, 120); g.fill(); g.beginPath(); g.moveTo(W / 2 + 46, 0); g.lineTo(W / 2 + 10, 60); g.lineTo(W / 2 + 46, 120); g.fill();   // lapels
    g.fillStyle = '#111'; g.beginPath(); g.moveTo(W / 2 - 26, 22); g.lineTo(W / 2 - 4, 32); g.lineTo(W / 2 - 26, 42); g.fill(); g.beginPath(); g.moveTo(W / 2 + 26, 22); g.lineTo(W / 2 + 4, 32); g.lineTo(W / 2 + 26, 42); g.fill(); g.fillRect(W / 2 - 5, 27, 10, 10);   // bow tie
    g.fillStyle = '#222'; for (const y of [90, 130, 170, 210]) { g.beginPath(); g.arc(W / 2, y, 4, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#c9a43a'; g.fillRect(W / 2 - 60, 150, 6, 6);
  });
  const waist = canvasTex(256, 256, (g, W, H) => {                    // the shirt keeps going down the waist, ending in a cummerbund
    g.fillStyle = '#111'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f7f7f7'; g.beginPath(); g.moveTo(W / 2 - 22, 0); g.lineTo(W / 2 + 22, 0); g.lineTo(W / 2 + 18, H); g.lineTo(W / 2 - 18, H); g.fill();
    g.fillStyle = '#1a1a1a'; g.beginPath(); g.moveTo(0, 0); g.lineTo(W / 2 - 22, 0); g.lineTo(W / 2 - 18, H); g.lineTo(0, H); g.fill(); g.beginPath(); g.moveTo(W, 0); g.lineTo(W / 2 + 22, 0); g.lineTo(W / 2 + 18, H); g.lineTo(W, H); g.fill();   // jacket fronts
    g.fillStyle = '#222'; for (const y of [30, 80, 130]) { g.beginPath(); g.arc(W / 2, y, 4, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#0c0c0c'; g.fillRect(0, 170, W, 60); g.fillStyle = '#1e1e1e'; for (const y of [180, 196, 212]) g.fillRect(0, y, W, 4);   // cummerbund
  });
  const black = mat(0x111111), frontM = mat(0xffffff, { map: front }), waistM = mat(0xffffff, { map: waist });
  return TUX_MATS = { torso: [black, black, black, black, frontM, black], waist: [black, black, black, black, waistM, black], sleeve: black, shorts: mat(0x151515), legs: mat(0x151515), hands: mat(0xf3d1b0) };
}
function jerseyMats(variant) {
  if (JERSEY[variant]) return JERSEY[variant];
  const side = mat(variant === 'black' ? 0x151515 : 0xf5f5f5);
  const front = mat(0xffffff, { map: jerseyTex(variant, 'front') }), back = mat(0xffffff, { map: jerseyTex(variant, 'back') });
  const sleeve = mat(variant === 'black' ? 0x151515 : 0xf5f5f5); const shorts = mat(variant === 'black' ? 0x1c1c1c : 0xffffff);
  return JERSEY[variant] = { torso: [side, side, side, side, front, back], sleeve, shorts };
}
/* ---- extra characters: an outfit is a set of materials plus a few accessory boxes; the body and animation are shared ----
   mats(): torso / sleeve / shorts (+ optional waist); skin: face + hands colour; hair: colour or null (bald / covered);
   longSleeves / pants: cover the arms / legs in the outfit colour; hands: glove colour; extras(): props hung on the neck / spine joints */
const LOOK_CACHE = {};
const stripeTex = (a, b, n = 6) => canvasTex(256, 256, (g, W, H) => { for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(0, i * H / n, W, H / n); } });
const MODEL_LOOKS = {
  lifeguard: { skin: 0xd9a878, hair: 0x3b2a1a,
    mats: () => LOOK_CACHE.lifeguard || (LOOK_CACHE.lifeguard = { torso: mat(0xffffff, { map: canvasTex(256, 256, (g, W, H) => { g.fillStyle = '#e5342b'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.fillRect(W / 2 - 14, 60, 28, 90); g.fillRect(W / 2 - 45, 91, 90, 28); g.font = '900 34px Montserrat, Arial'; g.textAlign = 'center'; g.fillText('GUARD', W / 2, 205); }) }), sleeve: mat(0xe5342b), shorts: mat(0xe5342b) }),
    extras: ({ neck, spine, box, mat, cyl }) => { box(0.42, 0.05, 0.3, mat(0xffffff), 0, 0.38, 0.2, neck); box(0.44, 0.06, 0.44, mat(0xffffff), 0, 0.42, 0, neck);   // sun visor
      cyl(0.02, 0.02, 0.3, mat(0x222222), 0, 0.5, 0.17, spine, 5); box(0.07, 0.05, 0.05, mat(0xf5c542), 0, 0.36, 0.18, spine); } },   // whistle on a cord
  surfer: { skin: 0xe6b27f, hair: 0xf2dc8a, longSleeves: true, pants: true,
    mats: () => LOOK_CACHE.surfer || (LOOK_CACHE.surfer = { torso: mat(0xffffff, { map: canvasTex(256, 256, (g, W, H) => { g.fillStyle = '#16181c'; g.fillRect(0, 0, W, H); g.fillStyle = '#20c9b8'; g.fillRect(0, 0, 34, H); g.fillRect(W - 34, 0, 34, H); g.fillStyle = '#ffffff'; g.fillRect(W / 2 - 4, 0, 8, H); }) }), sleeve: mat(0x16181c), shorts: mat(0x16181c) }),
    extras: ({ neck, box, mat }) => { box(0.42, 0.08, 0.05, mat(0x1a1a1a), 0, 0.5, 0.17, neck); box(0.04, 0.03, 0.14, mat(0x1a1a1a), 0.2, 0.5, 0.1, neck); box(0.04, 0.03, 0.14, mat(0x1a1a1a), -0.2, 0.5, 0.1, neck);   // shades pushed up on the head
      box(0.06, 0.28, 0.14, mat(0xf2dc8a), 0.23, 0.2, -0.04, neck); box(0.06, 0.28, 0.14, mat(0xf2dc8a), -0.23, 0.2, -0.04, neck); box(0.36, 0.34, 0.1, mat(0xf2dc8a), 0, 0.14, -0.21, neck); } },   // long surfer hair
  pirate: { skin: 0xd5a57a, hair: null, pants: true,
    mats: () => LOOK_CACHE.pirate || (LOOK_CACHE.pirate = { torso: mat(0xffffff, { map: stripeTex('#f4f4f4', '#b8262b', 8) }), sleeve: mat(0xffffff, { map: stripeTex('#f4f4f4', '#b8262b', 8) }), shorts: mat(0x2b2b33) }),
    extras: ({ neck, spine, box, mat }) => { box(0.4, 0.14, 0.4, mat(0xb8262b), 0, 0.42, 0, neck); box(0.14, 0.1, 0.06, mat(0xb8262b), 0.18, 0.4, -0.2, neck); box(0.08, 0.2, 0.05, mat(0xb8262b), 0.24, 0.32, -0.2, neck);   // bandana with a knotted tail
      box(0.1, 0.1, 0.03, mat(0x111111), 0.08, 0.3, 0.19, neck); box(0.38, 0.03, 0.03, mat(0x111111), 0, 0.34, 0.19, neck);   // eyepatch + strap
      box(0.3, 0.1, 0.06, mat(0x2a1a10), 0, 0.08, 0.17, neck); box(0.34, 0.06, 0.1, mat(0x2a1a10), 0, 0.12, 0.14, neck);   // beard
      box(0.48, 0.07, 0.28, mat(0x5a3a1a), 0, 0.02, 0, spine); box(0.09, 0.09, 0.03, mat(0xf5c542), 0, 0.02, 0.15, spine); } },   // belt + buckle
  robot: { skin: 0x9aa4ad, hair: null, longSleeves: true, pants: true, hands: 0x6e7780, metal: true,
    mats: () => LOOK_CACHE.robot || (LOOK_CACHE.robot = { torso: mat(0xb9c2cb, { metalness: .7, roughness: .35 }), sleeve: mat(0x8f99a3, { metalness: .7, roughness: .4 }), shorts: mat(0x8f99a3, { metalness: .7, roughness: .4 }) }),
    extras: ({ neck, spine, box, mat, cyl, ball }) => { box(0.38, 0.09, 0.04, mat(0x22f3ff, { emissive: 0x22f3ff, emissiveIntensity: 1.2 }), 0, 0.3, 0.19, neck);   // glowing visor over the eyes
      cyl(0.02, 0.02, 0.22, mat(0x6e7780), 0, 0.55, 0, neck, 6); ball(0.045, mat(0xff3b3b, { emissive: 0xff3b3b, emissiveIntensity: 1 }), 0, 0.67, 0, neck, 8);   // antenna
      box(0.3, 0.16, 0.05, mat(0x3a4148), 0, 0.42, 0.16, spine); for (const x of [-0.08, 0, 0.08]) box(0.04, 0.04, 0.02, mat([0x22f3ff, 0xf5c542, 0xff3b3b][(x + 0.08) / 0.08 | 0], { emissive: [0x22f3ff, 0xf5c542, 0xff3b3b][(x + 0.08) / 0.08 | 0], emissiveIntensity: .9 }), x, 0.42, 0.19, spine);   // chest panel with lights
      box(0.44, 0.1, 0.32, mat(0x6e7780, { metalness: .7, roughness: .4 }), 0, 0.02, 0, spine); } },   // waist plate
  astronaut: { skin: 0xf3d1b0, hair: 0x5a3b22, longSleeves: true, pants: true, hands: 0xf2f2f2,
    mats: () => LOOK_CACHE.astronaut || (LOOK_CACHE.astronaut = { torso: mat(0xffffff, { map: canvasTex(256, 256, (g, W, H) => { g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, W, H); g.fillStyle = '#ff7a1a'; g.fillRect(0, 96, W, 18); g.fillStyle = '#1f3b8a'; g.fillRect(W / 2 - 60, 30, 46, 30); g.fillStyle = '#c9c9c9'; g.fillRect(W / 2 + 14, 30, 46, 30); }) }), sleeve: mat(0xf2f2f2), shorts: mat(0xf2f2f2) }),
    extras: ({ neck, spine, box, mat }) => { const glass = new THREE.MeshStandardMaterial({ color: 0xffc24a, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.6 });
      const helm = box(0.5, 0.52, 0.5, mat(0xf2f2f2), 0, 0.24, -0.02, neck); helm.material = glass;   // gold-tinted bubble helmet
      box(0.52, 0.06, 0.52, mat(0xf2f2f2), 0, -0.01, -0.02, neck); box(0.52, 0.08, 0.52, mat(0xf2f2f2), 0, 0.5, -0.02, neck);   // neck ring + top
      box(0.42, 0.44, 0.18, mat(0xe6e6e6), 0, 0.3, -0.24, spine); box(0.1, 0.16, 0.06, mat(0xff7a1a), 0.12, 0.42, -0.34, spine); box(0.1, 0.16, 0.06, mat(0xff7a1a), -0.12, 0.42, -0.34, spine); } },   // life-support pack
};
const POSES = {
  idle:        { shL: [0, 0, 3], shR: [0, 0, -3], elL: [-6, 0, 0], elR: [-6, 0, 0], hipL: [0, 0, 0], hipR: [0, 0, 0], knL: [0, 0, 0], knR: [0, 0, 0], spine: [0, 0, 0], neck: [0, 0, 0] },
  jumpUp:      { shL: [-150, 0, 18], shR: [-150, 0, -18], elL: [-40, 0, 0], elR: [-40, 0, 0], hipL: [-10, 0, 0], hipR: [-10, 0, 0], knL: [4, 0, 0], knR: [4, 0, 0], spine: [-6, 0, 0], neck: [-12, 0, 0] },   // take-off: both arms thrown up, legs driven straight
  air:         { shL: [-120, 0, 24], shR: [-168, 0, -28], elL: [-22, 0, 0], elR: [-72, 0, 0], hipL: [34, 0, 0], hipR: [34, 0, 0], knL: [98, 0, 0], knR: [98, 0, 0], spine: [-12, -12, 0], neck: [-6, 8, 0] },   // spike-ready: right arm up with the elbow folded back behind the head, left arm reaching, legs swept back
  airDown:     { shL: [-16, 0, 10], shR: [-22, 0, -8], elL: [-28, 0, 0], elR: [-28, 0, 0], hipL: [12, 0, 0], hipR: [12, 0, 0], knL: [32, 0, 0], knR: [32, 0, 0], spine: [6, 0, 0], neck: [4, 0, 0] },   // falling after the air action is spent: arms down
  land:        { shL: [-38, 0, 14], shR: [-38, 0, -14], elL: [-30, 0, 0], elR: [-30, 0, 0], hipL: [-34, 0, 0], hipR: [-34, 0, 0], knL: [64, 0, 0], knR: [64, 0, 0], spine: [18, 0, 0], neck: [-8, 0, 0] },   // landing crouch
  bump:        { shL: [-60, 0, 3], shR: [-60, 0, -3], elL: [0, 0, 0], elR: [0, 0, 0], hipL: [-28, 0, 0], hipR: [-28, 0, 0], knL: [40, 0, 0], knR: [40, 0, 0], spine: [20, 0, 0], neck: [-12, 0, 0] },
  set:         { shL: [-118, 0, 5], shR: [-118, 0, -5], elL: [-60, 0, 0], elR: [-60, 0, 0], hipL: [-8, 0, 0], hipR: [-8, 0, 0], knL: [14, 0, 0], knR: [14, 0, 0], spine: [-2, 0, 0], neck: [-18, 0, 0] },
  block:       { shL: [-172, 0, 12], shR: [-172, 0, -12], elL: [0, 0, 0], elR: [0, 0, 0], hipL: [-8, 0, 0], hipR: [-8, 0, 0], knL: [16, 0, 0], knR: [16, 0, 0], spine: [-3, 0, 0], neck: [-8, 0, 0] },
  spikeCharge: { shL: [-146, 0, 22], shR: [-178, 0, -26], elL: [-12, 0, 0], elR: [-55, 0, 0], hipL: [42, 0, 0], hipR: [42, 0, 0], knL: [104, 0, 0], knR: [104, 0, 0], spine: [-18, -16, 0], neck: [-14, 6, 0] },   // wind-up: hitting hand drawn further back but still above the shoulder, back arched
  spikeHit:    { shL: [-26, 0, 12], shR: [-52, 0, 20], elL: [-34, 0, 0], elR: [-16, 0, 0], hipL: [-46, 0, 0], hipR: [-46, 0, 0], knL: [22, 0, 0], knR: [22, 0, 0], spine: [26, -6, 0], neck: [12, 0, 0] },   // the swing: hitting arm whipped down and across, torso crunching over it
  tip:         { shL: [-65, 0, 18], shR: [-160, 0, -6], elL: [-25, 0, 0], elR: [-12, 0, 0], hipL: [-18, 0, 0], hipR: [-18, 0, 0], knL: [36, 0, 0], knR: [36, 0, 0], spine: [-3, 0, 0], neck: [-12, 0, 0] },
  dive:        { shL: [-100, 0, 8], shR: [-100, 0, -8], elL: [0, 0, 0], elR: [0, 0, 0], hipL: [6, 0, 0], hipR: [6, 0, 0], knL: [8, 0, 0], knR: [8, 0, 0], spine: [0, 0, 0], neck: [-25, 0, 0] },
  diveL:       { shL: [-20, 0, 95], shR: [-30, 0, 35], elL: [0, 0, 0], elR: [-20, 0, 0], hipL: [-10, 0, 20], hipR: [-25, 0, 5], knL: [20, 0, 0], knR: [45, 0, 0], spine: [0, 0, 12], neck: [0, 0, 20] },
  diveR:       { shL: [-30, 0, -35], shR: [-20, 0, -95], elL: [-20, 0, 0], elR: [0, 0, 0], hipL: [-25, 0, -5], hipR: [-10, 0, -20], knL: [45, 0, 0], knR: [20, 0, 0], spine: [0, 0, -12], neck: [0, 0, -20] },
  diveB:       { shL: [-150, 0, 20], shR: [-150, 0, -20], elL: [-10, 0, 0], elR: [-10, 0, 0], hipL: [-35, 0, 0], hipR: [-35, 0, 0], knL: [55, 0, 0], knR: [55, 0, 0], spine: [-10, 0, 0], neck: [-20, 0, 0] },
  hold:        { shL: [-75, 0, 5], shR: [0, 0, -3], elL: [-12, 0, 0], elR: [-6, 0, 0], hipL: [0, 0, 0], hipR: [0, 0, 0], knL: [0, 0, 0], knR: [0, 0, 0], spine: [0, 0, 0], neck: [0, 0, 0] },
  sit:         { shL: [-28, 0, 12], shR: [-28, 0, -12], elL: [-58, 0, 0], elR: [-58, 0, 0], hipL: [-76, 0, 6], hipR: [-76, 0, -6], knL: [76, 0, 0], knR: [76, 0, 0], spine: [-6, 0, 0], neck: [4, 0, 0] },   // couch sit: thighs forward, shins hanging, hands in the lap
  dash:        { shL: [38, 0, 14], shR: [38, 0, -14], elL: [-24, 0, 0], elR: [-24, 0, 0], hipL: [-38, 0, 0], hipR: [26, 0, 0], knL: [30, 0, 0], knR: [52, 0, 0], spine: [24, 0, 0], neck: [-14, 0, 0] },   // dash: leaning hard into it, arms swept back
  toss:        { shL: [-160, 0, 8], shR: [-15, 0, -5], elL: [0, 0, 0], elR: [-6, 0, 0], hipL: [0, 0, 0], hipR: [0, 0, 0], knL: [0, 0, 0], knR: [0, 0, 0], spine: [-4, 0, 0], neck: [-16, 0, 0] },
};
const POSE_SNAP = { jumpUp: 22, land: 20, spikeCharge: 26, spikeHit: 32 };   // how hard each pose snaps in; everything else uses the default blend
const faceTex = (skinHex, girl) => canvasTex(128, 128, (g, W, H) => {
  g.fillStyle = skinHex; g.fillRect(0, 0, W, H);
  if (girl) { g.strokeStyle = '#222'; g.lineWidth = 3; g.lineCap = 'round'; for (const cx of [42, 86]) for (const o of [-8, 0, 8]) { g.beginPath(); g.moveTo(cx + o, 44); g.lineTo(cx + o * 1.4, 36); g.stroke(); } g.fillStyle = 'rgba(255,120,150,.35)'; g.beginPath(); g.ellipse(30, 74, 8, 5, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(98, 74, 8, 5, 0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#222';
  g.beginPath(); g.ellipse(42, 56, 6, 9, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(86, 56, 6, 9, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#4c8ce6'; g.beginPath(); g.ellipse(42, 58, 3.5, 5, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(86, 58, 3.5, 5, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#222'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(50, 86); g.quadraticCurveTo(64, 96, 78, 86); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.moveTo(32, 40); g.lineTo(52, 44); g.moveTo(96, 40); g.lineTo(76, 44); g.stroke();
});
const FACE_TEX = faceTex('#f3d1b0'), FACE_TEX_DARK = faceTex('#6b4a30'), FACE_TEX_GIRL = faceTex('#f3d1b0', true);
const HAIR_BOW = mat(0xff5aa0);
/* ---- emote animations (looping joint overrides) ---- */
function emotePose(id, t, k, tg) {
  const s = Math.sin(t * 10), c = Math.cos(t * 10);
  if (id === 'wave') { if (k === 'shR') tg.set(-160 * D, 0, (-25 + s * 20) * D); if (k === 'elR') tg.set((-20 + c * 15) * D, 0, 0); if (k === 'neck') tg.set(0, -10 * D, 0); }
  else if (id === 'clap') { const o = 0.5 + 0.5 * Math.sin(t * 9); /* 0 = hands apart, 1 = hands together */ if (k === 'shL') tg.set(-72 * D, 0, -(6 + o * 36) * D); if (k === 'shR') tg.set(-72 * D, 0, (6 + o * 36) * D); if (k === 'elL' || k === 'elR') tg.set(-35 * D, 0, 0); if (k === 'neck') tg.set(6 * D, 0, 0); }
  else if (id === 'worm') { const w = Math.sin(t * 6), w2 = Math.sin(t * 6 - 1.2); if (k === 'shL') tg.set((-140 + w * 45) * D, 0, 20 * D); if (k === 'shR') tg.set((-140 - w * 45) * D, 0, -20 * D); if (k === 'elL' || k === 'elR') tg.set((-15 - Math.abs(w) * 40) * D, 0, 0); if (k === 'spine') tg.set(w * 45 * D, 0, 0); if (k === 'hipL' || k === 'hipR') tg.set((20 - w2 * 45) * D, 0, 0); if (k === 'knL' || k === 'knR') tg.set((25 + w2 * 35) * D, 0, 0); if (k === 'neck') tg.set((-40 + w * 30) * D, 0, 0); }
}
function emoteBody(id, t) {
  if (id === 'worm') return { yaw: 0, bob: Math.sin(t * 6) * 0.22, pitch: 1.15 + Math.sin(t * 6 + 0.6) * 0.25 };
  if (id === 'clap') return { yaw: 0, bob: Math.abs(Math.sin(t * 8)) * 0.02, pitch: 0 };
  return { yaw: 0, bob: 0, pitch: 0 };
}
class Rig {
  constructor(variant = 'white', model = 'boy') {
    this.model = model; const girl = model === 'girl';
    this.root = new THREE.Group(); this.root.scale.setScalar(RIG_SCALE);
    this.tilt = new THREE.Group(); this.tilt.position.y = HIP_Y; this.root.add(this.tilt);
    this.body = new THREE.Group(); this.body.position.y = -HIP_Y; this.tilt.add(this.body);
    this.variant = variant; const J = this.j = {};
    const big = variant === 'bigdealer' || model === 'bigdealer', wd = variant === 'wdealer'; const dealer = variant === 'dealer' || big || model === 'dealer'; const tux = model === 'tux';
    const look = MODEL_LOOKS[model] || null;
    const jm = look ? look.mats() : wd ? { torso: mat(0xe0559a), sleeve: mat(0xe0559a), shorts: mat(0x2a2a2a) } : big ? { torso: mat(0xb3242a), sleeve: mat(0xb3242a), shorts: mat(0x1a1a1a) } : dealer ? { torso: mat(0x111111), sleeve: mat(0x111111), shorts: mat(0x1a1a1a) } : tux ? tuxMats() : jerseyMats(variant);
    const joint = (n, parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); J[n] = g; return g; };
    const spine = joint('spine', this.body, 0, HIP_Y, 0);
    const sideM = Array.isArray(jm.torso) ? jm.torso[0] : jm.torso;
    box(girl ? 0.4 : 0.46, 0.3, 0.26, jm.waist || sideM, 0, 0.14, 0, spine);                       // waist / lower torso (the tux shirt continues down it)
    this.torso = box(girl ? 0.52 : 0.6, 0.34, girl ? 0.27 : 0.3, jm.torso, 0, TORSO_H - 0.17, 0, spine);   // chest (jersey front/back)
    const skinM = look ? mat(look.skin, look.metal ? { metalness: .6, roughness: .4 } : {}) : dealer ? mat(0x6b4a30) : SKIN;
    cyl(0.08, 0.09, 0.1, skinM, 0, TORSO_H + 0.03, 0, spine, 12);                                    // neck
    const neck = joint('neck', spine, 0, TORSO_H + 0.04, 0);
    const skinFace = mat(0xffffff, { map: look ? faceTex('#' + look.skin.toString(16).padStart(6, '0'), girl) : dealer ? FACE_TEX_DARK : (girl ? FACE_TEX_GIRL : FACE_TEX) });
    const head = new THREE.Mesh(boxGeo(0.36, 0.4, 0.36, 0.025), [skinM, skinM, skinM, skinM, skinFace, skinM]); head.position.y = 0.24; head.castShadow = true; neck.add(head);
    if (dealer) {                                                             // Lil Man Dealer: black cap, shades, hoodie, gold chain
      box(0.4, 0.13, 0.4, mat(0x111111), 0, 0.43, 0, neck); box(0.38, 0.04, 0.2, mat(0x111111), 0, 0.39, 0.27, neck);
      box(0.38, 0.08, 0.05, mat(0x050505), 0, 0.29, 0.19, neck);
      box(big ? 0.34 : 0.28, big ? 0.07 : 0.05, 0.05, mat(0xf5c542), 0, 0.5, 0.15, spine); if (big) box(0.1, 0.1, 0.03, mat(0xf5c542), 0, 0.43, 0.17, spine);   // chain (+ a medallion on the big man)
      box(0.56, 0.14, 0.32, big ? mat(0xb3242a) : mat(0x111111), 0, 0.56, -0.02, spine);          // hood
      if (big) { box(0.3, 0.1, 0.06, mat(0x2a1a10), 0, 0.08, 0.17, neck); box(0.34, 0.06, 0.1, mat(0x2a1a10), 0, 0.12, 0.14, neck); }   // beard
      this.torso.material = jm.torso;
    } else if (look && look.hair === null) {                                  // outfit covers or removes the hair (bandana, helmet ring, chrome dome)
    } else {
    // hair: simple blond cap + bangs, blue tips on the sides (head stays visible)
    const hairM = look ? mat(look.hair) : tux ? mat(0x111111) : HAIR, tipM = look ? mat(look.hair) : tux ? mat(0x111111) : HAIR_TIP;
    box(0.4, 0.12, 0.4, hairM, 0, 0.43, 0, neck);
    box(0.4, 0.1, 0.06, hairM, 0, 0.39, 0.19, neck);
    box(0.06, 0.16, 0.2, tipM, 0.21, 0.32, -0.06, neck); box(0.06, 0.16, 0.2, tipM, -0.21, 0.32, -0.06, neck);
    if (girl) {                                                               // long hair down the back, side strands, bow
      box(0.38, 0.55, 0.12, HAIR, 0, 0.06, -0.22, neck); box(0.26, 0.2, 0.1, HAIR_TIP, 0, -0.26, -0.22, neck);
      box(0.08, 0.42, 0.16, HAIR, 0.22, 0.14, -0.04, neck); box(0.08, 0.42, 0.16, HAIR, -0.22, 0.14, -0.04, neck);
      box(0.08, 0.12, 0.16, HAIR_TIP, 0.22, -0.11, -0.04, neck); box(0.08, 0.12, 0.16, HAIR_TIP, -0.22, -0.11, -0.04, neck);
      box(0.14, 0.1, 0.06, HAIR_BOW, 0.15, 0.47, 0.05, neck); box(0.05, 0.14, 0.06, HAIR_BOW, 0.15, 0.47, 0.05, neck);
    }
    if (wd) { box(0.38, 0.08, 0.05, mat(0x050505), 0, 0.29, 0.19, neck); box(0.28, 0.05, 0.05, mat(0xf5c542), 0, 0.5, 0.15, spine); box(0.56, 0.14, 0.32, mat(0xe0559a), 0, 0.56, -0.02, spine); }   // Lil Woman Dealer: shades, chain, pink hood
    }
    if (look && look.extras) look.extras({ neck, spine, box, mat, cyl, ball, girl });
    /* Limbs. Every hinge gets a sphere cap in the same material as the segment below it: boxes alone tear
       open a wedge of empty space the moment a knee passes ~40 degrees, and this rig routinely folds them
       past 100. The caps cost one cached sphere geometry each and close the silhouette at every angle. */
    const armM = look ? (look.longSleeves ? jm.sleeve : skinM) : dealer || tux || wd ? jm.sleeve : SKIN;
    const legM = look ? (look.pants ? jm.shorts : skinM) : dealer || tux ? jm.shorts : SKIN;
    const handM = look && look.hands ? mat(look.hands) : skinM;
    const soleM = mat(0xe8e4dc);
    for (const [n, sx] of [['L', 1], ['R', -1]]) {
      const sh = joint('sh' + n, spine, sx * (girl ? 0.32 : 0.36), SHOULDER_Y - HIP_Y, 0);
      ball(0.098, jm.sleeve, 0, -0.02, 0, sh, 12);                                                   // deltoid: keeps the armpit closed when the arm goes overhead
      box(0.19, 0.13, 0.19, jm.sleeve, 0, -0.03, 0, sh);                                            // shoulder / sleeve cap
      box(0.17, 0.32, 0.17, jm.sleeve, 0, -0.17, 0, sh);                                            // upper arm
      const el = joint('el' + n, sh, 0, -0.33, 0);
      ball(0.082, armM, 0, 0, 0, el, 10);                                                            // elbow
      box(0.15, 0.3, 0.15, armM, 0, -0.15, 0, el);                                                   // forearm
      ball(0.068, armM, 0, -0.29, 0, el, 10);                                                        // wrist
      this['hand' + n] = box(0.13, 0.13, 0.09, handM, 0, -0.355, 0.01, el);                          // hand
      const hip = joint('hip' + n, this.body, sx * (girl ? 0.14 : 0.13), HIP_Y, 0);
      ball(0.118, jm.shorts, 0, -0.03, 0, hip, 12);                                                  // hip
      box(0.23, 0.44, 0.23, jm.shorts, 0, -0.22, 0, hip);                                            // thigh
      const kn = joint('kn' + n, hip, 0, -0.44, 0);
      ball(0.102, legM, 0, 0, 0, kn, 12);                                                            // knee
      box(0.19, 0.42, 0.19, legM, 0, -0.21, 0, kn);                                                  // shin
      ball(0.085, legM, 0, -0.39, 0, kn, 10);                                                        // ankle
      const ft = joint('ft' + n, kn, 0, -0.44, 0);                                                   // no pose names it, so it sits flat unless the gait drives it
      box(0.21, 0.1, 0.33, SHOE, 0, -0.01, 0.06, ft);                                                // shoe
      box(0.215, 0.035, 0.335, soleM, 0, -0.057, 0.062, ft);                                         // sole
      box(0.16, 0.045, 0.05, SHOE, 0, 0.045, 0.12, ft);                                              // tongue
    }
    this.cur = {}; this.target = {}; this.vel = {};
    for (const k in J) { this.cur[k] = new THREE.Vector3(); this.target[k] = new THREE.Vector3(); this.vel[k] = new THREE.Vector3(); }
    this.anim = 'idle'; this.animUntil = 0; this.base = 'idle'; this.runPhase = 0; this.moveSpeed = 0; this.runBlend = 0;
    this.tiltX = 0; this.tiltZ = 0; this.pitch = 0; this.pitchTarget = 0; this.roll = 0; this.rollTarget = 0; this.emote = null; this.emoteT = 0; this.emoteYaw = 0; this.emoteBob = 0;
    /* secondary motion */
    this.baseScale = new THREE.Vector3(RIG_SCALE, RIG_SCALE, RIG_SCALE); if (model === 'bigdealer') { this.baseScale.set(RIG_SCALE * 1.12, RIG_SCALE * 1.06, RIG_SCALE * 1.12); this.root.scale.copy(this.baseScale); }   // the big man is a little taller and a lot broader (looks only)
    this.squash = 0; this.squashV = 0;                 // spring: negative = compressed on landing, positive = stretched off a jump
    this.locoBob = 0; this.locoRoll = 0; this.locoYaw = 0;
    this.lean = 0; this.leanTarget = 0;                // banking into a turn
    this.prevYaw = 0; this.idleSeed = Math.random() * 100; this.idleAmt = 0;
    this.setPose('idle');
    this.foldParts();
  }
  /* Merge every mesh that stays rigid with its joint into one mesh per joint and material: a rig drops from
     ~56 draw calls to ~20 and still animates exactly the same. The hands and torso stay separate (the game
     reads the hands' world positions and swaps the torso material). */
  foldParts() {
    if (typeof mergeStatic !== 'function') return;
    this.handL.userData.noMerge = true; this.handR.userData.noMerge = true; this.torso.userData.noMerge = true;
    const names = Object.keys(POSES); let k = 0; const rig = this;
    const saveAnim = this.anim, saveUntil = this.animUntil; this.snap();
    try { mergeStatic(this.root, [{ update() { rig.setPose(names[k++ % names.length]); rig.snap(); } }], 'rig', true); } catch (e) { console.warn('rig fold', e); }
    this.anim = saveAnim; this.animUntil = saveUntil; this.setPose(saveAnim); this.snap();
  }
  setScale(x, y = x, z = x) { this.baseScale.set(x, y, z); this.root.scale.copy(this.baseScale); }
  /* A vertical impulse into the squash spring. Negative compresses (landing), positive stretches (take-off). */
  impact(amount) { this.squashV += amount; }
  setPose(name, until = 0) { this.anim = POSES[name] ? name : 'idle'; this.animUntil = until; }
  snap() {
    for (const k in this.j) { const p = (POSES[this.anim] || POSES.idle)[k] || [0, 0, 0]; this.cur[k].set(p[0] * D, p[1] * D, p[2] * D); this.vel[k].set(0, 0, 0); this.j[k].rotation.set(this.cur[k].x, this.cur[k].y, this.cur[k].z); }
    this.pitch = this.pitchTarget; this.roll = this.rollTarget; this.squash = this.squashV = 0; this.applyTilt();
  }
  applyTilt() {
    this.tilt.rotation.x = this.tiltZ * 0.5 + this.pitch;
    this.tilt.rotation.z = this.tiltX * 0.45 + this.roll + this.locoRoll + this.lean;   // lean toward the tilt side (+ dive roll, gait sway, turn bank)
    this.tilt.rotation.y = this.emoteYaw;
    const drop = Math.max(Math.sin(Math.abs(this.pitch)), Math.sin(Math.abs(this.roll)));
    this.tilt.position.y = HIP_Y - drop * HIP_Y * 0.7 + this.emoteBob + this.locoBob;   // dives: body drops toward the floor
  }
  update(dt, t) {
    dt = Math.min(dt, 1 / 30);                                   // the springs below are explicit; a long frame must not blow them up
    if (this.animUntil && t > this.animUntil) { this.anim = this.base; this.animUntil = 0; }
    const pose = POSES[this.anim] || POSES.idle;
    const loco = this.anim === 'idle' && !this.emote;
    const spd = this.moveSpeed;

    /* ---- gait -------------------------------------------------------------------
       runBlend eases between a walk and a full run. The phase advances by DISTANCE
       COVERED (speed * dt / stride) rather than by time, so the planted foot keeps pace
       with the ground at every speed instead of skating across it. */
    const rbT = loco ? clamp((spd - 0.5) / 3.6, 0, 1) : 0;
    this.runBlend = lerp(this.runBlend, rbT, 1 - Math.exp(-dt * 10));
    const rbl = this.runBlend, moving = loco && spd > 0.3;
    if (moving) this.runPhase = (this.runPhase + (spd * dt / lerp(1.25, 3.15, rbl)) * TAU) % TAU;
    const ph = this.runPhase, s = Math.sin(ph);
    const gate = moving ? clamp(spd / 1.2, 0, 1) : 0;             // fades the whole cycle out around a standstill
    const HIP_SW = lerp(26, 60, rbl) * D * gate, KNEE = lerp(32, 88, rbl) * D * gate;
    const ARM = lerp(20, 56, rbl) * D * gate, LEANF = lerp(3, 13, rbl) * D * gate;
    const TWIST = lerp(3, 13, rbl) * D * gate;

    /* ---- idle -------------------------------------------------------------------
       A standing player runs a real loop, not just a breath: weight rocks from one foot to
       the other over about seven seconds, the hips and shoulders counter-rotate through the
       shift, the unweighted knee softens, and the head drifts around with an occasional
       longer glance (two slow sines beating against each other, so the look-arounds land at
       irregular intervals instead of on a metronome). Breathing runs under all of it, and
       keeps running in any resting pose — sitting NPCs included. */
    const sd = this.idleSeed;
    const atRest = this.anim === this.base && !this.emote;
    const breath = Math.sin(t * 1.5 + sd) * (atRest ? 1 : 0);
    const idleAmt = (1 - gate) * (this.anim === 'idle' && !this.emote ? 1 : 0);
    this.idleAmt = lerp(this.idleAmt, idleAmt, 1 - Math.exp(-dt * 5));
    const ia = this.idleAmt;
    const swayPh = t * 0.9 + sd;
    const shift = Math.sin(swayPh) * ia;                       // -1 on the left foot, +1 on the right
    const shift2 = Math.sin(swayPh * 2 + 0.7) * ia;            // second harmonic, keeps the rock from being a pure sine
    const glance = Math.sin(t * 0.41 + sd) * Math.sin(t * 0.13 + sd * 1.7) * ia;
    const nod = Math.sin(t * 0.27 + sd * 2.3) * ia;

    const stiff = loco ? lerp(17, 34, rbl) : (POSE_SNAP[this.anim] || 14);   // a slow filter would eat the run cycle's amplitude
    for (const k in this.j) {
      const p = pose[k] || [0, 0, 0]; const tg = this.target[k]; tg.set(p[0] * D, p[1] * D, p[2] * D);
      if (ia > 0.002) switch (k) {                              // the idle loop, faded out as soon as you start moving
        case 'hipL': tg.x += (-1.5 + shift * 2.2) * D * ia; tg.z += shift * 2.0 * D; break;
        case 'hipR': tg.x += (-1.5 - shift * 2.2) * D * ia; tg.z += shift * 2.0 * D; break;
        case 'knL': tg.x += (5 + Math.max(0, shift) * 9) * D * ia; break;     // the leg you are not standing on softens
        case 'knR': tg.x += (5 + Math.max(0, -shift) * 9) * D * ia; break;
        case 'shL': tg.x += (breath * 1.4 - shift * 1.6) * D; tg.z += (shift * 3.4 + Math.abs(breath) * 1.2) * D; break;
        case 'shR': tg.x += (breath * 1.4 + shift * 1.6) * D; tg.z += (shift * 3.4 - Math.abs(breath) * 1.2) * D; break;
        case 'elL': tg.x += (-4 - Math.abs(breath) * 3 - Math.max(0, shift) * 4) * D * ia; break;
        case 'elR': tg.x += (-4 - Math.abs(breath) * 3 - Math.max(0, -shift) * 4) * D * ia; break;
        case 'spine': tg.x += (breath * 1.8 + shift2 * 0.6) * D; tg.y += -shift * 4.5 * D; tg.z += shift * 3.2 * D; break;
        case 'neck': tg.x += (-breath * 0.9 + nod * 3.5) * D; tg.y += (shift * 5 + glance * 26) * D; tg.z += -shift * 1.6 * D; break;
      }
      if (loco) switch (k) {
        case 'hipL': tg.x += -s * HIP_SW; break;
        case 'hipR': tg.x += s * HIP_SW; break;
        case 'knL': tg.x += Math.pow(Math.max(0, Math.sin(ph - 0.45)), 1.25) * KNEE + 5 * D * gate; break;
        case 'knR': tg.x += Math.pow(Math.max(0, -Math.sin(ph + 0.45)), 1.25) * KNEE + 5 * D * gate; break;
        case 'shL': tg.x += s * ARM; tg.z += shift * 1.6 * D; break;
        case 'shR': tg.x += -s * ARM; tg.z += shift * 1.6 * D; break;
        case 'elL': tg.x += -(10 + Math.max(0, s) * 46) * D * gate - Math.abs(breath) * 2 * D; break;
        case 'elR': tg.x += -(10 + Math.max(0, -s) * 46) * D * gate - Math.abs(breath) * 2 * D; break;
        case 'ftL': tg.x += (Math.max(0, -s) * 22 - Math.max(0, s) * 8) * D * gate; break;                      // toes point down through push-off, lift for the heel strike
        case 'ftR': tg.x += (Math.max(0, s) * 22 - Math.max(0, -s) * 8) * D * gate; break;
        case 'spine': tg.x += LEANF + breath * 1.5 * D; tg.y += -s * TWIST; tg.z += shift * 2.4 * D; break;     // shoulders counter-rotate against the hips
        case 'neck': tg.x += -LEANF * 0.7 - breath * 0.7 * D; tg.y += s * TWIST * 0.5 + shift * 4 * D; break;   // head stays level and looks where the body is going
      }
      if (this.emote) emotePose(this.emote, this.emoteT, k, tg);
      springJoint(this.cur[k], this.vel[k], tg, stiff, dt);
      const cu = this.cur[k]; this.j[k].rotation.set(cu.x, cu.y, cu.z);
    }

    /* ---- body-level secondary motion ---- */
    const bobAmp = lerp(0.02, 0.08, rbl) * gate;
    this.locoBob = (0.35 - (0.5 - 0.5 * Math.cos(2 * ph))) * bobAmp   // two dips per stride, one per foot-strike
      + breath * 0.012 - Math.abs(shift) * 0.014;                     // idle: chest rises on the breath, body settles at the ends of the rock
    this.locoRoll = -s * lerp(1.5, 4.5, rbl) * D * gate + shift * 1.8 * D;

    let dy = this.root.rotation.y - this.prevYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.prevYaw = this.root.rotation.y;
    this.leanTarget = clamp(dy / Math.max(dt, 1e-4) * 0.05, -0.32, 0.32) * clamp(spd / 3, 0, 1);   // bank into a turn
    this.lean = lerp(this.lean, this.leanTarget, 1 - Math.exp(-dt * 9));

    // squash & stretch: an under-damped spring, so a landing compresses and rebounds once rather than popping back
    const W = 30, ZT = 0.42;
    this.squashV += (-W * W * this.squash - 2 * ZT * W * this.squashV) * dt;
    this.squash = clamp(this.squash + this.squashV * dt, -0.3, 0.24);
    const sq = this.squash, bs = this.baseScale;
    this.root.scale.set(bs.x * (1 - sq * 0.45), bs.y * (1 + sq), bs.z * (1 - sq * 0.45));

    if (this.emote) { this.emoteT += dt; const e = emoteBody(this.emote, this.emoteT); this.emoteYaw = e.yaw; this.emoteBob = e.bob; this.pitchTarget = e.pitch; } else { this.emoteYaw = 0; this.emoteBob = 0; }
    this.pitch = lerp(this.pitch, this.pitchTarget, 1 - Math.exp(-dt * 12)); this.roll = lerp(this.roll, this.rollTarget, 1 - Math.exp(-dt * 12));
    this.applyTilt();
  }
  handPos(side, out) { return this['hand' + side].getWorldPosition(out || new THREE.Vector3()); }
}

/* ---- trait boxes (chests) ---- */
const CHEST_TIERS = { 4: { body: 0x7a1218, band: 0xff4a55, glow: 0xffb0b8 }, 1: { body: 0x8b5a2b, band: 0xcd7f32, glow: 0xffd9a0 }, 2: { body: 0x55636f, band: 0xd0d6dd, glow: 0xd8f0ff }, 3: { body: 0x7a4a10, band: 0xf5c542, glow: 0xfff0a0 } };
function makeChest(tier, open) {
  const c = CHEST_TIERS[tier] || CHEST_TIERS[1]; const g = new THREE.Group();
  const bodyM = mat(c.body), bandM = mat(c.band, { emissive: c.band, emissiveIntensity: tier === 3 ? 0.3 : 0.1 });
  box(1.0, 0.5, 0.64, bodyM, 0, 0.25, 0, g);
  for (const x of [-0.3, 0.3]) box(0.12, 0.52, 0.66, bandM, x, 0.25, 0, g);
  const lid = new THREE.Group(); lid.position.set(0, 0.5, -0.32); g.add(lid);
  box(1.04, 0.22, 0.66, bodyM, 0, 0.11, 0.32, lid);
  for (const x of [-0.3, 0.3]) box(0.12, 0.24, 0.68, bandM, x, 0.11, 0.32, lid);
  box(0.16, 0.14, 0.05, bandM, 0, 0.06, 0.66, lid);                                              // latch
  if (open) { lid.rotation.x = -1.9; const gl = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.55), new THREE.MeshBasicMaterial({ color: c.glow })); gl.position.set(0, 0.49, 0); g.add(gl); }
  g.userData.lid = lid; return g;
}

/* ---- pose icons for the action cards (rendered once) ---- */
const ICONS = {};
function renderPoseIcons() {
  const r2 = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); r2.setSize(160, 160); r2.outputEncoding = THREE.sRGBEncoding;
  r2.toneMapping = THREE.ACESFilmicToneMapping; r2.toneMappingExposure = 0.95;   // card icons match the world's grade
  const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.1)); const dl = new THREE.DirectionalLight(0xffffff, .7); dl.position.set(2, 4, 3); sc.add(dl);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 20); cam.position.set(1.6, 1.5, 2.9); cam.lookAt(0, 0.85, 0);
  const rig = new Rig('white'); sc.add(rig.root);
  const specs = { bump: {}, set: {}, dive: { pitch: 1.25 }, block: {}, spikeCharge: {}, spikeHit: {}, hold: {}, toss: {}, tip: {}, dash: { pitch: 0.3 } };
  rig.rollTarget = 0;
  for (const name in specs) {
    rig.setPose(name); rig.pitchTarget = specs[name].pitch || 0; rig.pitch = rig.pitchTarget;
    rig.root.position.y = name === 'dive' ? 0.15 : 0; rig.snap();
    r2.render(sc, cam); ICONS[name] = r2.domElement.toDataURL('image/png');
  }
  rig.root.visible = false;
  for (const id of Object.keys(SKINS)) { const bm = makeBallMesh(id); bm.mesh.position.set(0, 0.85, 0); bm.mesh.scale.setScalar(2.2); sc.add(bm.mesh); r2.render(sc, cam); ICONS['skin_' + id] = r2.domElement.toDataURL('image/png'); sc.remove(bm.mesh); }
  ICONS.ball = ICONS.skin_default;
  for (const eid of Object.keys(EMOTES)) { const er = new Rig('white'); er.emote = eid; er.emoteT = eid === 'wave' ? 0.4 : 0.25; er.setPose('idle'); er.update(1, 0); er.snap(); er.update(0.5, 0); sc.add(er.root); r2.render(sc, cam); ICONS['emote_' + eid] = r2.domElement.toDataURL('image/png'); sc.remove(er.root); }
  for (const mid of Object.keys(MODELS)) { const mr = new Rig('white', mid); mr.setPose('idle'); mr.snap(); sc.add(mr.root); r2.render(sc, cam); ICONS['model_' + mid] = r2.domElement.toDataURL('image/png'); sc.remove(mr.root); }
  for (const t of [1, 2, 3, 4]) for (const op of [false, true]) { const ch = makeChest(t, op); ch.position.set(0, 0.42, 0); ch.scale.setScalar(1.2); ch.rotation.y = 0.4; sc.add(ch); r2.render(sc, cam); ICONS[(op ? 'boxopen_' : 'box_') + t] = r2.domElement.toDataURL('image/png'); sc.remove(ch); }
  for (const fid of Object.keys(FXS)) { const g = fxPreview(fid); if (g) sc.add(g); r2.render(sc, cam); ICONS['fx_' + fid] = r2.domElement.toDataURL('image/png'); if (g) sc.remove(g); }
  r2.dispose();
}

/* =====================================================================
   PADS (teleport areas)
   ===================================================================== */
const PADS = {};
function makePad(id, label, cap, x, z, yaw, mode, practice) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
  const redM = mat(0xe23b3b), darkM = mat(0x7a1f1f);
  box(0.8, 3.4, 0.8, redM, 2.6, 1.7, 0, g); box(0.8, 3.4, 0.8, redM, -2.6, 1.7, 0, g);
  box(6.0, 0.7, 0.8, darkM, 0, 3.75, 0, g);
  const tex = canvasTex(1024, 820, () => { });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 4.7), new THREE.MeshBasicMaterial({ map: tex })); panel.position.set(0, 2.5, -0.2); g.add(panel);
  box(6.0, 5.6, 0.4, mat(0x5a1a1a), 0, 2.7, -0.5, g);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(2.3, 24), new THREE.MeshBasicMaterial({ color: 0xe23b3b, transparent: true, opacity: .3 })); glow.rotation.x = -Math.PI / 2; glow.position.set(0, 0.02, 2.2); g.add(glow);
  /* Dressing only � the pad's zone, exit point and label are untouched. A lit frame around the board,
     a pulsing ring on the floor and three chevrons bobbing over the spot you have to stand on. */
  {
    const lit = new THREE.MeshBasicMaterial({ color: 0xffd36e });
    for (const [fw, fh, fx, fy] of [[5.6, 0.16, 0, 2.5 + 2.45], [5.6, 0.16, 0, 2.5 - 2.45], [0.16, 5.06, -2.72, 2.5], [0.16, 5.06, 2.72, 2.5]]) box(fw, fh, 0.12, lit, fx, fy, -0.12, g).castShadow = false;
    box(5.2, 0.5, 0.5, mat(0x3a1010), 0, 4.3, -0.1, g).castShadow = false;
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.85, 2.25, 36), new THREE.MeshBasicMaterial({ color: 0xffd36e, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.03, 2.2); g.add(ring);
    const chev = [];
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.34, 4), new THREE.MeshBasicMaterial({ color: 0xffd36e, transparent: true, opacity: 0.85 }));
      c.rotation.x = Math.PI; c.rotation.y = Math.PI / 4; c.position.set(0, 1.5 + i * 0.46, 2.2); g.add(c); chev.push(c);
    }
    AMBIENT.push({ update(t) {
      const k = 0.4 + Math.sin(t * 2.4) * 0.2;
      ring.material.opacity = k + 0.2; ring.scale.setScalar(1 + Math.sin(t * 2.4) * 0.035);
      glow.material.opacity = 0.22 + k * 0.2;
      for (let i = 0; i < 3; i++) { const f = (t * 1.5 + i * 0.33) % 1; chev[i].position.y = 2.6 - f * 1.3; chev[i].material.opacity = Math.sin(f * Math.PI) * 0.85; }
    } });
  }
  scene.add(g);
  const pad = { id, label, cap, mode, practice, group: g, tex, count: 0, x, z, yaw, panel };
  const fx = Math.sin(yaw), fz = Math.cos(yaw); const cx = x + fx * 2.2, cz = z + fz * 2.2;
  pad.zone = { x1: cx - 2.3, x2: cx + 2.3, z1: cz - 2.3, z2: cz + 2.3 };
  pad.exitPos = new THREE.Vector3(x + fx * 6.2, 0, z + fz * 6.2);
  pad.draw = (count) => {
    pad.count = count;
    const c = tex.image, gg = c.getContext('2d'), W = c.width, H = c.height;
    gg.fillStyle = '#c92f2f'; gg.fillRect(0, 0, W, H); gg.fillStyle = '#e04141'; gg.fillRect(60, 60, W - 120, H - 120);
    gg.textAlign = 'center'; gg.textBaseline = 'middle'; gg.fillStyle = '#fff';
    fitText(gg, label, label.length > 5 ? 150 : 250, W * 0.8); gg.fillText(label, W / 2, H / 2 - 60);
    gg.font = '900 82px Montserrat, Arial'; gg.fillText(`(${count}/${cap} PLAYERS)`, W / 2, H / 2 + 150);
    tex.needsUpdate = true;
  };
  pad.draw(0);
  PADS[id] = pad; return pad;
}

/* =====================================================================
   LOBBY — low-poly beach house
   ===================================================================== */
const lobby = new THREE.Group();
/* ---- ocean -------------------------------------------------------------------
   A MeshStandardMaterial rather than a hand-written shader, so the sea still takes the sun,
   the fog and the sky env map; onBeforeCompile only adds the waves. Two long swells actually
   displace the mesh, and two short ones perturb the normal only — ripples finer than the mesh
   spacing would just alias if they moved vertices, but they read perfectly as shading. */
const WATER_T = { value: 0 };
const WAVE_GLSL = [
  'uniform float uTime;',
  'void vgWave(vec2 p, float t, out float h, out vec2 d){',
  '  h = 0.0; d = vec2(0.0);',
  '  vec2 k1 = vec2(0.21, 0.13); float a1 = 0.14;',
  '  float f1 = dot(p, k1) + t * 0.85; h += sin(f1) * a1; d += cos(f1) * a1 * k1;',
  '  vec2 k2 = vec2(-0.29, 0.24); float a2 = 0.08;',
  '  float f2 = dot(p, k2) + t * 1.25; h += sin(f2) * a2; d += cos(f2) * a2 * k2;',
  '}',
  'vec2 vgRipple(vec2 p, float t){',                                   // normal-only detail, finer than the mesh
  '  vec2 k3 = vec2(0.95, -0.72); float a3 = 0.030;',
  '  float f3 = dot(p, k3) + t * 2.3;',
  '  vec2 k4 = vec2(1.45, 1.15); float a4 = 0.017;',
  '  float f4 = dot(p, k4) + t * 3.1;',
  '  return cos(f3) * a3 * k3 + cos(f4) * a4 * k4;',
  '}'
].join('\n');
/* `shore` describes where the beach is, as the plane ax*worldX + az*worldZ + off = 0, with the value
   growing as you head out to sea. The lobby's sea runs off -Z from z = -44; the beach court's runs off
   +X from x = 50. One material, two coefficients. */
function makeWaterMaterial(shore) {
  if (SIMPLE_SHADERS) return new THREE.MeshStandardMaterial({ color: 0x2b93c8, roughness: 0.55, metalness: 0.0 });   // simple shaders: flat water, no wave program
  const m = new THREE.MeshStandardMaterial({ color: 0x1d7cb4, roughness: 0.26, metalness: 0.05, envMapIntensity: 0.75 });
  const uShore = { value: new THREE.Vector3(shore[0], shore[1], shore[2]) };
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = WATER_T; sh.uniforms.uShore = uShore;
    sh.vertexShader = WAVE_GLSL + '\nuniform vec3 uShore;\nvarying vec3 vgWP;\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', [
        'vec3 _wp = (modelMatrix * vec4(position, 1.0)).xyz;',
        'float _off = uShore.x * _wp.x + uShore.y * _wp.z + uShore.z;',
        'float _amp = smoothstep(0.0, 34.0, _off);',              // swells flatten out as they reach the beach, so the sea never cuts through the sand
        'float _h; vec2 _d; vgWave(position.xy, uTime, _h, _d); _d += vgRipple(position.xy, uTime);',
        '_h *= _amp; _d *= mix(0.35, 1.0, _amp);',
        'vec3 objectNormal = normalize(vec3(-_d.x, -_d.y, 1.0));'].join('\n'))
      // the same falloff lifts the water body offshore, so the troughs clear the sand plane underneath
      // while the waterline itself still meets the beach flush
      .replace('#include <begin_vertex>', ['vec3 transformed = vec3(position);', 'transformed.z += _h + _amp * 0.26;'].join('\n'))
      .replace('#include <project_vertex>', '#include <project_vertex>\nvgWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform vec3 uShore;\nvarying vec3 vgWP;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', ['#include <color_fragment>',
        'float shoal = 1.0 - smoothstep(0.0, 44.0, uShore.x * vgWP.x + uShore.y * vgWP.z + uShore.z);',   // shallows near the beach go turquoise
        'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.68, 0.70), shoal * 0.8);'].join('\n'));
  };
  m.customProgramCacheKey = () => 'vgwater';
  return m;
}
/* ---- palms and umbrellas, shared by the lobby beach and the beach court map ----
   `ambient` is the list whose update() runs in whichever scene the prop belongs to. */
let PALM_M = null;
function palmMats() {
  if (PALM_M) return PALM_M;
  const leaf = [{ top: 0x57bd63, bot: 0x2b7439 }, { top: 0x49aa57, bot: 0x246631 }, { top: 0x6bcd79, bot: 0x327e40 }];
  for (const l of leaf) l.ribM = mat(l.bot);
  return PALM_M = { trunk: mat(0xb08355), bead: mat(0xa0744a), ring: mat(0x8a6039), coco: mat(0x6b4a2a), boot: mat(0x8f6a43), leaf };
}
/* Palm. The trunk is a chain of tapering segments that each add a little bend, so it curves rather than
   standing as one straight post, and every joint carries a slightly wider bead — that beaded silhouette is
   what makes a stylised palm read as a palm from a distance. Fronds are chains of shortening blades that
   droop further toward the tip, each two-toned via the six material slots the rounded box already exposes:
   bright on top, deep green underneath, so the crown has depth instead of being one flat green mass.
   Frond tips don't cast shadows — the shape on the sand comes from the inner blades, and dropping the rest
   halves what the shadow pass has to draw. */
function makePalm(parent, ambient, x, z, h = 5) {
  const M = palmMats();
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = Math.random() * TAU; parent.add(g);
  const segs = 7, bend = 0.035 + Math.random() * 0.04;
  let node = g;
  for (let i = 0; i < segs; i++) {
    const sh = h / segs, t0 = i / segs, t1 = (i + 1) / segs;
    const seg = new THREE.Group(); seg.position.y = i ? sh : 0; seg.rotation.z = bend; node.add(seg); node = seg;
    cyl(lerp(0.30, 0.16, t1), lerp(0.30, 0.16, t0), sh * 1.06, M.trunk, 0, sh / 2, 0, seg, 6);
    const br = lerp(0.335, 0.185, t0);
    cyl(br, br * 0.94, 0.13, M.bead, 0, 0.05, 0, seg, 6).castShadow = i < 3;                  // the bead at each joint

  }
  const crown = new THREE.Group(); crown.position.y = h / segs; node.add(crown);
  cyl(0.24, 0.18, 0.3, M.boot, 0, 0.08, 0, crown, 9);
  for (const [cx, cz] of [[0.19, 0.1], [-0.15, 0.17], [0.03, -0.2], [-0.19, -0.08]]) ball(0.115, M.coco, cx, -0.03, cz, crown, 8).castShadow = false;
  const fronds = [];
  const frond = (i, n, tilt, scale, seed, blades) => {
    const fr = new THREE.Group(); fr.rotation.y = -(i / n * TAU + seed); fr.rotation.z = tilt; crown.add(fr);
    const lm = M.leaf[i % 3];
    let cur = fr;
    for (let k = 0; k < blades; k++) {
      const sub = new THREE.Group(); sub.position.x = (k ? 0.86 : 0.26) * scale; sub.rotation.z = -(0.13 + k * 0.07); cur.add(sub); cur = sub;
      const bw = (k ? 0.95 : 0.46) * scale, bd = lerp(0.98, 0.3, k / Math.max(1, blades - 1)) * scale;
      leafBlade(bw, 0.06, bd, lm.top, lm.bot, bw / 2 - 0.03, 0, 0, sub, k < 2);
      if (!k) box(bw, 0.075, 0.07, lm.ribM, bw / 2 - 0.03, 0, 0, sub).castShadow = false;     // centre rib, only where it actually reads
    }
    fronds.push(fr);
  };
  for (let i = 0; i < 8; i++) frond(i, 8, -0.15 - Math.random() * 0.1, 1, Math.random() * 0.2, 2);         // outer ring, the long drooping ones
  for (let i = 0; i < 4; i++) frond(i, 4, 0.46 + Math.random() * 0.14, 0.62, 0.32 + Math.random() * 0.2, 2);  // shorter inner ring angled up, so the crown reads full rather than spidery
  ambient.push({ ph: Math.random() * 6, update(t) {
    const k = 0.4 + WIND.length() * 0.35;
    crown.rotation.z = (Math.sin(t * 1.1 + this.ph) * 0.06 - WIND.x * 0.03) * k;
    crown.rotation.x = (Math.cos(t * 0.9 + this.ph) * 0.05 + WIND.z * 0.03) * k;
    // (fronds no longer flutter individually: that kept ~60 separate draw calls per palm alive; the crown sway carries the motion and the whole crown now merges into a few meshes)
  } });
}
/* Eight cone sectors alternating colour instead of one plain cone: panelled canopy and a scalloped rim
   for the cost of eight tiny meshes. */
function makeUmbrella(parent, x, z, color) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = Math.random() * TAU; parent.add(g);
  cyl(0.042, 0.052, 2.45, mat(0xeeece4), 0, 1.22, 0, g, 8);
  const ca = new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.55 });
  const cb = new THREE.MeshStandardMaterial({ color: 0xfbf7ec, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.55 });
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Mesh(new THREE.ConeGeometry(1.52, 0.56, 3, 1, true, i / 8 * TAU, TAU / 8), i % 2 ? ca : cb);
    s.position.y = 2.42; s.castShadow = true; g.add(s);
  }
  cyl(0.09, 0.09, 0.1, mat(0xe3ddd0), 0, 2.74, 0, g, 8); ball(0.085, mat(0xe3ddd0), 0, 2.82, 0, g, 8);   // hub + finial
}
/* Wind-ripple relief for the sand. At ~15 m per tile the ripples catch the low sun and give the beach a
   direction, which a flat speckled texture never does however fine it is. */
let SAND_BUMP = null;
const sandBumpTex = () => SAND_BUMP || (SAND_BUMP = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 20; i++) { g.strokeStyle = i % 2 ? '#bdbdbd' : '#5e5e5e'; g.lineWidth = 3 + Math.random() * 5; g.beginPath(); g.moveTo(0, i * 13); for (let x = 0; x <= w; x += 8) g.lineTo(x, i * 13 + Math.sin(x / 27 + i * 0.8) * 6); g.stroke(); }
  for (let i = 0; i < 1800; i++) { g.fillStyle = i % 2 ? '#9c9c9c' : '#6c6c6c'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
}, [26, 26]));
const WALK = []; let INDOOR_COUNT = 0;
const AMBIENT = [];   // little animated things that make the world feel alive
const WIND = new THREE.Vector3();   // m/s, horizontal; identical on every client (derived from server time)
function updateWind() {
  const t = snow() / 1000;
  const ang = t * 0.011 + Math.sin(t * 0.037) * 1.2 + Math.sin(t * 0.0071) * 2.0;
  const str = 1.2 + 1.6 * (0.5 + 0.5 * Math.sin(t * 0.021)) + 0.6 * Math.sin(t * 0.09) + 0.35 * Math.sin(t * 0.6);
  WIND.set(Math.cos(ang) * str, 0, Math.sin(ang) * str);
}
let NPC = null; const NPC_POS = new THREE.Vector3(0, 0.5, 12.2);
let NPC3 = null; const NPC3_POS = new THREE.Vector3(-60, 0.3, -61.2);   // Lil Woman Dealer, in the hut at the end of the pier
let NPC2 = null; const F2 = 5.5, F2H = 6; const STAIRWELL = { x1: 7.4, x2: 12.8, z1: -12.8, z2: -10.4 }; /* exactly the stairs' width, from the wall to the top step */ const NPC2_POS = new THREE.Vector3(0, F2, 4.3);   // Big Man Dealer, sitting on the couch upstairs (second floor at y = 5.5)
const COLLIDERS = [];   // walls the camera must not pass through

/* =====================================================================
   DETAIL KIT
   Textures and small prop builders for the dressing pass below. Everything in here is
   decoration only: nothing registers a collider, a walkable region, a pad or a hitbox.
   Detail goes into TEXTURES wherever it can — a slatted wall costs one box with a slat
   map, where one box per slat would cost forty.
   ===================================================================== */
let DTX = null;
function detailTex() {
  if (DTX) return DTX;
  const grain = (g, w, h, a, dark, light, len) => { g.globalAlpha = a; for (let i = 0; i < 240; i++) { g.fillStyle = i % 2 ? dark : light; g.fillRect(Math.random() * w, Math.random() * h, 1, len); } g.globalAlpha = 1; };
  DTX = {
    // vertical timber battens — wainscot, feature walls, counter fronts
    slat: canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#c8a679'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 16; i++) { const x = i * 16; g.fillStyle = i % 2 ? '#cfae82' : '#c09e72'; g.fillRect(x, 0, 14, h); g.fillStyle = 'rgba(60,38,14,.30)'; g.fillRect(x + 14, 0, 2, h); }
      grain(g, w, h, 0.12, '#8a6a45', '#e8cfa8', 26);
    }),
    // horizontal decking — the veranda and the pier
    plank: canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#c19a68'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) { const y = i * 32; g.fillStyle = ['#c69f6d', '#bb9463', '#cba473', '#b58d5d'][i % 4]; g.fillRect(0, y, w, 30); g.fillStyle = 'rgba(50,32,12,.28)'; g.fillRect(0, y + 30, w, 2); }
      g.globalAlpha = 0.1; for (let i = 0; i < 260; i++) { g.fillStyle = i % 2 ? '#7d5c38' : '#ecd3ab'; g.fillRect(Math.random() * w, Math.random() * h, 18 + Math.random() * 40, 1); } g.globalAlpha = 1;
    }),
    // woven seagrass rug
    rug: canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#e6d6b6'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 32; i++) for (let j = 0; j < 32; j++) { g.fillStyle = (i + j) % 2 ? '#ded0ae' : '#eaddc0'; g.fillRect(i * 8, j * 8, 8, 8); }
      g.strokeStyle = '#c2a86f'; g.lineWidth = 7; g.strokeRect(16, 16, w - 32, h - 32);
      g.strokeStyle = '#9fbfa6'; g.lineWidth = 4; g.strokeRect(34, 34, w - 68, h - 68);
    }),
    // rough plaster for the render band at the base of the building
    stone: canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#cfc6b4'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) { g.fillStyle = ['#c6bca8', '#d8d0bf', '#bcb2a0', '#e0d9ca'][i % 4]; const s = 14 + Math.random() * 26; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, s, s * 0.66, Math.random() * 3, 0, TAU); g.fill(); }
      grain(g, w, h, 0.1, '#8f8878', '#f2ece0', 4);
    }),
    // striped canvas for awnings and deck chairs
    stripe: canvasTex(128, 128, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f6f2e6' : '#e0594f'; g.fillRect(i * 16, 0, 16, h); } }),
    // pennant bunting, drawn with alpha so one strip covers a whole run
    bunting: canvasTex(512, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#6b5334'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, 12); g.lineTo(w, 12); g.stroke();
      const cols = ['#e5484d', '#f5c542', '#3ecf5a', '#3b8ff0', '#ff8bc4', '#ff9d3b'];
      for (let i = 0; i < 16; i++) { const x = i * 32 + 4; g.fillStyle = cols[i % 6]; g.beginPath(); g.moveTo(x, 12); g.lineTo(x + 24, 12); g.lineTo(x + 12, 74); g.closePath(); g.fill(); }
    })
  };
  return DTX;
}
/* A framed picture: canvas art with a slight emissive lift so it still reads in a dim room. */
function makePoster(parent, x, y, z, ry, w, h, draw, frameHex = 0x6b4f32) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g);
  const t = canvasTex(512, Math.max(64, Math.round(512 * h / w)), draw);
  const art = box(w, h, 0.04, mat(0xffffff, { map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.22 }), 0, 0, 0.05, g);
  art.castShadow = false;
  box(w + 0.16, h + 0.16, 0.07, mat(frameHex), 0, 0, 0, g).castShadow = false;
  return g;
}
/* Potted tropical plant: pot, rim, soil and a fan of stemmed leaves, each leaf two-toned
   (lighter on top, darker underneath) using the six material slots the rounded box already has. */
const PLANT_LEAF = [{ top: 0x5cc16a, bot: 0x2f7b3e }, { top: 0x4bb05c, bot: 0x276a34 }, { top: 0x6fce7d, bot: 0x358846 }];
function makePlantPot(parent, x, y, z, s = 1, potHex = 0xc9764f, ambient = null) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(s); g.rotation.y = Math.random() * TAU; parent.add(g);
  const potM = mat(potHex), rimM = mat(potHex, { color: potHex }), soilM = mat(0x4a3626), stemM = mat(0x54803c);
  cyl(0.34, 0.25, 0.54, potM, 0, 0.27, 0, g, 12);
  cyl(0.385, 0.365, 0.11, rimM, 0, 0.55, 0, g, 12);
  cyl(0.32, 0.32, 0.05, soilM, 0, 0.57, 0, g, 10).castShadow = false;
  const leaves = [];
  for (let i = 0; i < 6; i++) {
    const lg = new THREE.Group(); lg.position.set(0, 0.58, 0); lg.rotation.y = i / 6 * TAU + Math.random() * 0.4; lg.rotation.z = 0.2 + Math.random() * 0.42; g.add(lg);
    const L = 0.5 + Math.random() * 0.34;
    cyl(0.022, 0.032, L, stemM, 0, L / 2, 0, lg, 6).castShadow = false;
    const blade = new THREE.Group(); blade.position.y = L; blade.rotation.z = -0.4; lg.add(blade);
    const lm = PLANT_LEAF[i % 3];
    leafBlade(0.44, 0.035, 0.3, lm.top, lm.bot, 0.2, 0, 0, blade, false);
    leafBlade(0.3, 0.03, 0.19, lm.top, lm.bot, 0.52, 0.012, 0, blade, false);
    leaves.push(lg);
  }
  if (ambient) ambient.push({ ph: Math.random() * 6, update(t) { g.rotation.x = Math.sin(t * 1.3 + this.ph) * 0.03; g.rotation.z = Math.cos(t * 1.1 + this.ph) * 0.03; } });   // the whole plant breathes (per-leaf sway kept 18 draw calls per plant alive)
  return g;
}
function makeBench(parent, x, y, z, ry, len = 2.2) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g);
  const wm = mat(0xc79a68), fm = mat(0x6e5033);
  for (let i = 0; i < 3; i++) box(len, 0.07, 0.15, wm, 0, 0.46, -0.19 + i * 0.19, g);
  for (let i = 0; i < 3; i++) box(len, 0.13, 0.07, wm, 0, 0.72 + i * 0.17, -0.28, g);
  for (const s of [-1, 1]) { box(0.09, 0.46, 0.09, fm, s * (len / 2 - 0.16), 0.23, 0.16, g); box(0.09, 1.1, 0.09, fm, s * (len / 2 - 0.16), 0.55, -0.28, g); }
  return g;
}
function makeShelf(parent, x, y, z, ry, w = 1.8, h = 2.1) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g);
  const fm = mat(0x9a7247), bm = mat(0xd8c4a2);
  box(w, h, 0.06, bm, 0, h / 2, -0.19, g).castShadow = false;
  for (const s of [-1, 1]) box(0.09, h, 0.42, fm, s * (w / 2 - 0.045), h / 2, 0, g);
  const cols = [0xe5484d, 0xf5c542, 0x3ecf5a, 0x3b8ff0, 0xff8bc4, 0xffffff];
  for (let i = 0; i < 4; i++) {
    const sy = 0.34 + i * (h - 0.5) / 3;
    box(w - 0.1, 0.07, 0.42, fm, 0, sy, 0, g);
    for (let k = 0; k < 2; k++) {                                           // something on every shelf: boxes, balls, folded towels
      const ox = -w / 2 + 0.42 + k * (w - 0.84), c = cols[(i * 2 + k) % 6];
      if ((i + k) % 3 === 0) ball(0.14, mat(c), ox, sy + 0.18, 0, g, 10).castShadow = false;
      else if ((i + k) % 3 === 1) box(0.32, 0.26, 0.28, mat(c), ox, sy + 0.17, 0, g).castShadow = false;
      else for (let f = 0; f < 2; f++) box(0.36, 0.08, 0.3, mat(f % 2 ? 0xffffff : c), ox, sy + 0.08 + f * 0.09, 0, g).castShadow = false;
    }
  }
  return g;
}
/* Tiled materials, quantised so a whole building's worth of cladding shares a handful of textures
   instead of cloning one per panel. */
const TILE_CACHE = new Map();
function tiledMat(kind, rx, ry) {
  const q = v => Math.max(0.5, Math.round(v * 2) / 2);
  rx = q(rx); ry = q(ry);
  const key = kind + rx + '_' + ry;
  let m = TILE_CACHE.get(key);
  if (!m) {
    const t = detailTex()[kind].clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
    m = mat(0xffffff, { map: t }); TILE_CACHE.set(key, m);
  }
  return m;
}
const slatMat = len => tiledMat('slat', len / 2.4, 1);                 // ~15 cm battens
const plankMat = (w, d) => tiledMat('plank', w / 3.2, d / 3.2);
function makeCrate(parent, x, y, z, s = 1, hex = 0xc08a4e) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(s); g.rotation.y = Math.random() * TAU; parent.add(g);
  const m = mat(hex), t = mat(0x8a5f34);
  box(0.9, 0.7, 0.7, m, 0, 0.35, 0, g);
  for (const yy of [0.12, 0.58]) { box(0.94, 0.09, 0.74, t, 0, yy, 0, g).castShadow = false; }
  return g;
}
function buildLobby() {
  const wallM = mat(0xf7f1e3), trimM = mat(0xe9dcc3), ceilM = mat(0xfaf6ee);
  const woodM = mat(0xffffff, { map: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#c9a97c'; g.fillRect(0, 0, w, h); for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#c4a377' : '#cfae82'; g.fillRect(0, i * 43, w, 41); } }, [10, 10]) });
  const darkWood = mat(0x9c6f45);
  const sandM = mat(0xffffff, { bumpMap: sandBumpTex(), bumpScale: 0.18, map: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#f0dfae'; g.fillRect(0, 0, w, h); for (let i = 0; i < 2600; i++) { g.fillStyle = ['#e6d29c', '#f7e8bd', '#dcc68f', '#fff3cf'][i % 4]; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); } for (let i = 0; i < 26; i++) { g.strokeStyle = 'rgba(0,0,0,.05)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, i * 10 + Math.random() * 6); for (let x = 0; x <= w; x += 12) g.lineTo(x, i * 10 + Math.sin(x / 20 + i) * 3); g.stroke(); } }, [80, 80]) }), waterM = makeWaterMaterial([0, -1, -44]), leafM = mat(0x4fae5b), trunkM = mat(0xa9764f), glassM = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.25, roughness: 0.1 });
  const floor = (x, z, w, d, m) => { const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m); f.rotation.x = -Math.PI / 2; f.position.set(x, 0, z); f.receiveShadow = true; lobby.add(f); return f; };
  const wall = (x, z, w, d, h = 5, y = 0, m = wallM) => { const b = box(w, h, d, m, x, y + h / 2, z, lobby); COLLIDERS.push(b); return b; };
  const ceil = (x, z, w, d, h) => { const c = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilM); c.rotation.x = Math.PI / 2; c.position.set(x, h, z); lobby.add(c); };
  const fasciaM = mat(0xd6c4a0), railM = mat(0xb08b5e);
  /* A fascia band standing slightly proud of each roof slab: the eaves line is what makes the building
     read as architecture instead of a stack of white boxes, and it costs four thin boxes per roof. */
  const fascia = (x, y, z, w, d, h = 0.62) => {
    for (const [ox, oz, fw, fd] of [[0, -d / 2, w + 0.1, 0.18], [0, d / 2, w + 0.1, 0.18], [-w / 2, 0, 0.18, d + 0.1], [w / 2, 0, 0.18, d + 0.1]]) {
      const b = box(fw, h, fd, fasciaM, x + ox, y, z + oz, lobby); b.castShadow = false; b.receiveShadow = false;
    }
  };
  const roof = (x, z, w, d) => { const r = box(w, 0.5, d, trimM, x, 5.2, z, lobby); r.castShadow = false; r.receiveShadow = false; fascia(x, 5.18, z, w, d); };   // roof slabs don't block the sun
  /* Head, sill, jambs and a transom around a glass pane. `horiz` = the pane runs along X. */
  const paneFrame = (cx, cy, cz, w, h, horiz, mull = 1) => {
    const t = 0.1, d = 0.16;
    const put = (bw, bh, bd, ox, oy, oz) => { const b = box(bw, bh, bd, railM, cx + ox, cy + oy, cz + oz, lobby); b.castShadow = false; return b; };
    put(horiz ? w : d, t, horiz ? d : w, 0, h / 2, 0); put(horiz ? w : d, t, horiz ? d : w, 0, -h / 2, 0);
    for (const s of [-1, 1]) put(horiz ? t : d, h, horiz ? d : t, horiz ? s * w / 2 : 0, 0, horiz ? 0 : s * w / 2);
    for (let i = 1; i <= mull; i++) put(horiz ? w : d * 0.85, t * 0.65, horiz ? d * 0.85 : w, 0, -h / 2 + h * i / (mull + 1), 0);
  };
  // outside: sand, sea, palms
  floor(0, 0, 400, 400, sandM).position.y = -0.05;
  /* the sea is subdivided so the long swells have vertices to move; 170 x 74 cells is ~2.4 m across,
     fine enough for a 25 m wavelength and still one cheap draw */
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 170, 85, 37), waterM);
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.015, -122); lobby.add(sea);
  const foamTex = canvasTex(256, 256, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 6; for (let i = 0; i < 4; i++) { g.beginPath(); for (let x = 0; x <= w; x += 8) g.lineTo(x, i * 64 + 20 + Math.sin(x / 18 + i) * 8); g.stroke(); } }, [24, 8]);
  const waves = new THREE.Mesh(new THREE.PlaneGeometry(400, 130), new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: .45, depthWrite: false })); waves.rotation.x = -Math.PI / 2; waves.position.set(0, 0.0, -105); lobby.add(waves);
  const shore = new THREE.Mesh(new THREE.PlaneGeometry(400, 3), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .5, depthWrite: false })); shore.rotation.x = -Math.PI / 2; shore.position.set(0, 0.01, -40); lobby.add(shore);
  AMBIENT.push({ update(t) { foamTex.offset.y = t * 0.02; foamTex.offset.x = Math.sin(t * 0.3) * 0.02; shore.position.z = -40 + Math.sin(t * 0.8) * 1.2; shore.material.opacity = 0.35 + Math.sin(t * 0.8) * 0.2; } });
  /* Headlands out past the swim line. They sit deep enough into the fog to be near-silhouettes, which is
     the point: the sea gets a far edge instead of ending in a flat band of haze. */
  const landM = mat(0x7e9c86), landM2 = mat(0x6b8a76);
  for (const [ix, iz, iw, ih, n] of [[-96, -128, 44, 10, 4], [-26, -142, 58, 13, 5], [62, -126, 38, 8, 3], [124, -146, 66, 15, 5]]) {
    const isle = new THREE.Group(); isle.position.set(ix, 0, iz); isle.rotation.y = Math.random() * TAU; lobby.add(isle);
    for (let k = 0; k < n; k++) {
      const r = iw * (0.28 + Math.random() * 0.22), hh = ih * (0.55 + Math.random() * 0.7);
      const c = new THREE.Mesh(new THREE.ConeGeometry(r, hh, 6), k % 2 ? landM : landM2);
      c.position.set((k - (n - 1) / 2) * iw * 0.34, hh / 2 - 1.2, (Math.random() - 0.5) * 10);
      c.castShadow = c.receiveShadow = false; isle.add(c);
    }
  }
  // drifting clouds
  const cloudM = mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: .35 });
  for (let i = 0; i < 9; i++) { const c = new THREE.Group(); const cx = -140 + Math.random() * 280, cz = -160 + Math.random() * 140, cy = 34 + Math.random() * 14; c.position.set(cx, cy, cz); for (let k = 0; k < 4; k++) box(6 + Math.random() * 8, 2.5 + Math.random() * 2, 5 + Math.random() * 4, cloudM, (k - 1.5) * 5 + Math.random() * 2, Math.random() * 1.5, Math.random() * 2, c); lobby.add(c); AMBIENT.push({ update(t, dt) { c.position.x += dt * (0.6 + WIND.x * 0.5); c.position.z += dt * WIND.z * 0.5; if (c.position.x > 160) c.position.x = -160; if (c.position.x < -160) c.position.x = 160; if (c.position.z > 20) c.position.z = -160; if (c.position.z < -160) c.position.z = 20; } }); }
  // seagulls circling over the water
  for (let i = 0; i < 5; i++) { const gull = new THREE.Group(); const wL = box(0.9, 0.05, 0.25, mat(0xf4f4f4), -0.45, 0, 0, gull), wR = box(0.9, 0.05, 0.25, mat(0xf4f4f4), 0.45, 0, 0, gull); box(0.35, 0.12, 0.6, mat(0xdddddd), 0, 0, 0, gull); lobby.add(gull); const cx = -60 + Math.random() * 120, cz = -50 - Math.random() * 40, rad = 10 + Math.random() * 14, h = 9 + Math.random() * 6, ph = Math.random() * 6, spd = 0.25 + Math.random() * 0.2; AMBIENT.push({ update(t) { const a = t * spd + ph; gull.position.set(cx + Math.cos(a) * rad, h + Math.sin(t * 1.3 + ph) * 0.8, cz + Math.sin(a) * rad); gull.rotation.y = -a + Math.PI / 2; const f = Math.sin(t * 9 + ph) * 0.5; wL.rotation.z = f; wR.rotation.z = -f; } }); }
  const palm = (x, z, h = 5) => makePalm(lobby, AMBIENT, x, z, h);
  palm(-16, -16, 6); palm(6, -17, 5); palm(20, -15.5, 6.5); palm(-48, -6, 5); palm(40, 12, 6); palm(-50, 20, 5.5); palm(45, 22, 6);
  for (const [x, z] of [[-6, -16], [14, -16.5], [-24, -15.5], [30, -16]]) { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6), mat(0xc9c2b4)); r.position.set(x, 0.25, z); r.castShadow = true; lobby.add(r); }
  // --- center room 26x26 ---
  floor(0, 0, 26, 26, woodM);
  const HOLE = STAIRWELL;                                                                       // stairwell in the north-east corner
  const around = (x1, x2, z1, z2, fn) => { fn(x1, HOLE.x1, z1, z2); fn(HOLE.x2, x2, z1, z2); if (HOLE.z1 > z1) fn(HOLE.x1, HOLE.x2, z1, HOLE.z1); fn(HOLE.x1, HOLE.x2, HOLE.z2, z2); };   // rects that tile (x1..x2, z1..z2) minus the hole
  around(-13, 13, -13, 13, (a, b, c, d) => { if (b > a && d > c) ceil((a + b) / 2, (c + d) / 2, b - a, d - c, 5); });

  wall(0, 13, 26, 0.4);                                                                  // south wall
  // north wall = window wall with a door in the middle out to the beach
  wall(-7.75, -13, 10.5, 0.4, 1.0); wall(7.75, -13, 10.5, 0.4, 1.0); wall(0, -13, 26, 0.4, 0.8, 4.2);
  for (const x of [-13, -6.5, -2.5, 2.5, 6.5, 13]) box(0.4, 5, 0.4, wallM, x, 2.5, -13, lobby);
  for (const [x, w] of [[-9.75, 6.1], [-4.5, 3.6], [4.5, 3.6], [9.75, 6.1]]) { const gl = box(w, 3.2, 0.06, glassM, x, 2.6, -13, lobby); gl.castShadow = false; paneFrame(x, 2.6, -13, w, 3.2, true); }
  box(5.4, 0.3, 0.5, darkWood, 0, 4.05, -13, lobby);                                    // door lintel
  for (const sx of [-1, 1]) { wall(sx * 13, -7.75, 0.4, 10.5); wall(sx * 13, 7.75, 0.4, 10.5); wall(sx * 13, 0, 0.4, 5, 1.6, 3.4); }
  for (const sx of [-1, 1]) { floor(sx * 14, 0, 2.6, 5, woodM); ceil(sx * 14, 0, 2.6, 5, 3.4); wall(sx * 14, -2.5, 2.6, 0.4, 3.4); wall(sx * 14, 2.5, 2.6, 0.4, 3.4); }
  // --- casual room (west) 26x22 ---
  floor(-28, 0, 26, 22, woodM); ceil(-28, 0, 26, 22, 5); roof(-28, 0, 30, 26);
  wall(-41, 0, 0.4, 22); wall(-28, 11, 26, 0.4);
  wall(-28, -11, 26, 0.4, 1.0); wall(-28, -11, 26, 0.4, 0.8, 4.2); for (const x of [-41, -34.5, -28, -21.5, -15]) box(0.4, 5, 0.4, wallM, x, 2.5, -11, lobby);
  for (const x of [-37.75, -31.25, -24.75, -18.25]) { const gl = box(6.1, 3.2, 0.06, glassM, x, 2.6, -11, lobby); gl.castShadow = false; paneFrame(x, 2.6, -11, 6.1, 3.2, true); }
  wall(-15, -6.75, 0.4, 8.5); wall(-15, 6.75, 0.4, 8.5); wall(-15, 0, 0.4, 5, 1.6, 3.4);
  // --- practice room (east) 18x18 ---
  floor(24, 0, 18, 18, woodM); ceil(24, 0, 18, 18, 5); roof(24, 0, 22, 22);
  wall(33, 0, 0.4, 18); wall(24, 9, 18, 0.4);
  wall(24, -9, 18, 0.4, 1.0); wall(24, -9, 18, 0.4, 0.8, 4.2); for (const x of [15, 21, 27, 33]) box(0.4, 5, 0.4, wallM, x, 2.5, -9, lobby);
  for (const x of [18, 24, 30]) { const gl = box(5.6, 3.2, 0.06, glassM, x, 2.6, -9, lobby); gl.castShadow = false; paneFrame(x, 2.6, -9, 5.6, 3.2, true); }
  wall(15, -5.75, 0.4, 6.5); wall(15, 5.75, 0.4, 6.5); wall(15, 0, 0.4, 5, 1.6, 3.4);
  WALK.push({ x1: -12.5, x2: 12.5, z1: -12.5, z2: 12.5, open: true }, { x1: -16, x2: -11, z1: -2.1, z2: 2.1 }, { x1: -40.5, x2: -15.5, z1: -10.5, z2: 10.5 }, { x1: 11, x2: 16, z1: -2.1, z2: 2.1 }, { x1: 15.5, x2: 32.5, z1: -8.5, z2: 8.5 });
  WALK.push({ x1: -12.5, x2: 12.5, z1: -10.6, z2: 12.5, y: F2 }, { x1: -12.5, x2: 7.4, z1: -12.5, z2: -10.6, y: F2 }, { x1: 12.3, x2: 12.5, z1: -12.75, z2: -10.4, y: F2 });   // second floor (minus the stairwell; overlaps the top of the stairs) + the top landing strip (same wall margin as the room)
  WALK.push({ x1: 2.4, x2: 12.4, z1: -12.75, z2: -10.4, ramp: 'x', h0: 0, h1: F2, open: true });               // the staircase (open: you can step off its side or drop onto it)
  BLOCKED.push({ x1: 2.4, x2: 12.4, z1: -12.75, z2: -10.4, under: WALK[WALK.length - 1] });                      // nobody walks underneath the treads
  INDOOR_COUNT = WALK.length;
  // outside: the door, the beach in front, and around the house (water starts at z = -40); the south strip leaves room for the staircase
  WALK.push({ x1: -2.1, x2: 2.1, z1: -14.5, z2: -12 }, { x1: -95, x2: 95, z1: -39.2, z2: -13.6 }, { x1: -95, x2: -41.6, z1: -39.2, z2: 45 }, { x1: 33.6, x2: 95, z1: -39.2, z2: 45 });
  WALK.push({ x1: -95, x2: 95, z1: 13.6, z2: 45 });
  WALK.push({ x1: -61.1, x2: -58.9, z1: -57.6, z2: -39.2, y: 0.3 }, { x1: -60.75, x2: -59.25, z1: -58.2, z2: -57.4, y: 0.3 }, { x1: -62.6, x2: -57.4, z1: -63.1, z2: -58.2, y: 0.3 });   // pier, hut doorway, hut floor
  // beach courts (long axis along X, net across Z)
  const lineM = mat(0xffffff);
  for (const cx of [-34, 0, 34]) {
    const cz = -27.5, hx = COURT_L / 2, hz = COURT_W / 2;
    BEACH_COURTS.push({ cx, cz, hx, hz }); BEACH_NETS.push({ cx, cz, nx: 1, nz: 0, half: NET_HALF });
    for (const [x, z, w, d] of [[cx, cz - hz, hx * 2, 0.12], [cx, cz + hz, hx * 2, 0.12], [cx - hx, cz, 0.12, hz * 2], [cx + hx, cz, 0.12, hz * 2], [cx, cz, 0.12, hz * 2], [cx - hx / 3, cz, 0.12, hz * 2], [cx + hx / 3, cz, 0.12, hz * 2]]) { const l = box(w, 0.03, d, lineM, x, 0.0, z, lobby); l.castShadow = false; }   // incl. attack lines
    buildNet(lobby, cx, cz, Math.PI / 2, NET_HALF, COURT_W / 2);
  }
  // beach life: umbrellas, towels, chairs, boat, pier
  const umbrella = (x, z, color) => makeUmbrella(lobby, x, z, color);
  umbrella(-16, -20, 0xe5484d); umbrella(18, -18, 0x3b8ff0); umbrella(-52, -36, 0xf5c542); umbrella(54, -36, 0x3ecf5a); umbrella(-70, -20, 0xe5484d);
  const towel = (x, z, ry, color) => { const t = box(1.0, 0.04, 2.0, mat(color), x, 0.0, z, lobby); t.rotation.y = ry; t.castShadow = false; };
  towel(-14.5, -18.5, 0.3, 0xffd0d0); towel(19.5, -16.5, -0.2, 0xd0e4ff); towel(-50.5, -37.5, 0.5, 0xfff2b0); towel(52.5, -37.5, 0.1, 0xd4ffd9); towel(-68.5, -18.5, -0.4, 0xffd0d0);
  const bchair = (x, z, ry) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; const m = mat(0xf0f0f0); box(0.6, 0.06, 1.4, m, 0, 0.35, 0, g); const bk = box(0.6, 0.06, 0.8, m, 0, 0.7, -0.9, g); bk.rotation.x = -0.9; for (const [lx, lz] of [[-0.25, -0.5], [0.25, -0.5], [-0.25, 0.5], [0.25, 0.5]]) box(0.05, 0.35, 0.05, m, lx, 0.17, lz, g); lobby.add(g); };
  bchair(-19, -21, 0.4); bchair(21, -19, -0.3); bchair(-55, -38, 0.2); bchair(57, -38, -0.5);
  for (const [x, z] of [[-60, -16], [-24, -18], [12, -19], [44, -17], [70, -26], [-80, -30], [80, -33], [-58, -19], [24, -17]]) palm(x, z, 5 + (Math.abs(x) % 3));
  const boat = box(2.2, 0.8, 5, mat(0xf4f4f4), 40, 0.35, -48, lobby); boat.rotation.y = 0.3; box(1.6, 0.3, 4, mat(0x3b8ff0), 40, 0.75, -48, lobby).rotation.y = 0.3;
  for (let i = 0; i < 8; i++) box(2.4, 0.15, 1.9, darkWood, -60, 0.25, -40.5 - i * 2, lobby);
  for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) cyl(0.12, 0.12, 1.2, darkWood, -60 + sx * 1.1, 0.0, -40 - i * 2, lobby, 6);
  const ball1 = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), mat(0xffd000)); ball1.position.set(-20, 0.3, -19); ball1.castShadow = true; lobby.add(ball1);
  // shells, pebbles and dune grass scattered over the beach
  const shellM = mat(0xfff1e0), pebbleM = mat(0xbfb6a6), grassM = mat(0xb9c46a);
  const inCourt = (x, z) => BEACH_COURTS.some(c => Math.abs(x - c.cx) < c.hx + 1.5 && Math.abs(z - c.cz) < c.hz + 1.5);
  for (let i = 0; i < 90; i++) { const x = -90 + Math.random() * 180, z = -39 + Math.random() * 25; if (inCourt(x, z) || (Math.abs(x) < 14 && z > -14)) continue; const r = Math.random(); if (r < 0.4) { const sh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), shellM); sh.position.set(x, 0.0, z); sh.rotation.y = Math.random() * 6; sh.scale.set(1, 0.6, 1.2); lobby.add(sh); } else if (r < 0.7) { const p = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12 + Math.random() * 0.12), pebbleM); p.position.set(x, 0.08, z); lobby.add(p); } else { const tuft = new THREE.Group(); tuft.position.set(x, 0, z); for (let k = 0; k < 5; k++) { const b = box(0.05, 0.6 + Math.random() * 0.5, 0.05, grassM, (Math.random() - .5) * 0.3, 0.3, (Math.random() - .5) * 0.3, tuft); b.rotation.z = (Math.random() - .5) * 0.5; b.rotation.x = (Math.random() - .5) * 0.5; } lobby.add(tuft); AMBIENT.push({ ph: Math.random() * 6, update(t) { const k = 0.5 + WIND.length() * 0.25; tuft.rotation.x = Math.sin(t * 2.3 + this.ph) * 0.12 * k + WIND.z * 0.04; tuft.rotation.z = -Math.cos(t * 2.1 + this.ph) * 0.1 * k - WIND.x * 0.04; } }); } }
  // wind-blown sand grains around the player
  const N = 700; const pts = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pts[i * 3] = (Math.random() - .5) * 60; pts[i * 3 + 1] = Math.pow(Math.random(), 1.6) * 9; pts[i * 3 + 2] = (Math.random() - .5) * 60; }
  const pgeo = new THREE.BufferGeometry(); pgeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const sand = new THREE.Points(pgeo, new THREE.PointsMaterial({ color: 0xfff2cc, size: 0.07, transparent: true, opacity: 0.75, depthWrite: false })); sand.name = 'sandGrains'; lobby.add(sand);
  AMBIENT.push({ update(t, dt) {
    if (!sand.visible) return;
    const cx = P.pos.x, cz = P.pos.z; const arr = pgeo.attributes.position.array; const w = WIND;
    for (let i = 0; i < N; i++) {
      let x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
      x += (w.x * (1.2 + y * 0.25) + Math.sin(t * 3 + i) * 0.6) * dt; z += (w.z * (1.2 + y * 0.25) + Math.cos(t * 2.7 + i * 1.3) * 0.6) * dt; y += (Math.sin(t * 1.5 + i) * 0.5 - 0.15) * dt;
      if (x < cx - 30) x += 60; if (x > cx + 30) x -= 60; if (z < cz - 30) z += 60; if (z > cz + 30) z -= 60; if (y < 0.03) y = Math.pow(Math.random(), 1.6) * 9; if (y > 9.5) y = 0.05;
      arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
    }
    pgeo.attributes.position.needsUpdate = true; sand.material.opacity = 0.45 + Math.min(0.4, WIND.length() * 0.12);
  } });
  // flags on the pier and the beach net posts
  const flagTex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#e5484d'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(0, h / 3, w, h / 3); });
  const flag = (x, z, h) => { cyl(0.05, 0.05, h, mat(0xdddddd), x, h / 2, z, lobby, 5); const f = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7, 8, 1), new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide })); f.position.set(x + 0.6, h - 0.4, z); lobby.add(f); const pos = f.geometry.attributes.position; const base = pos.array.slice(); AMBIENT.push({ update(t) { const k = 0.5 + WIND.length() * 0.3; f.rotation.y = -Math.atan2(WIND.z, WIND.x); for (let i = 0; i < pos.count; i++) { const bx = base[i * 3]; pos.setZ(i, Math.sin(t * (4 + WIND.length() * 2) + bx * 3) * 0.12 * (bx + 0.6) * k); } pos.needsUpdate = true; } }); };
  // beach umbrellas sway a little, boat bobs
  AMBIENT.push({ update(t) { boat.position.y = 0.35 + Math.sin(t * 1.4) * 0.12; boat.rotation.x = Math.sin(t * 1.1) * 0.05; } });
  /* festoon lights strung under the beach-facing eaves: a catenary line with bulbs hung off it.
     They dull down in daylight and glow at night, which is most of what sells "evening at the beach". */
  const FEST_MAT = new THREE.MeshBasicMaterial({ color: 0xffe8bc });
  const festoon = (x0, x1, z, y, n, sagK = 0.5) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, fx = lerp(x0, x1, t), fy = y - Math.sin(t * Math.PI) * sagK;
      pts.push(new THREE.Vector3(fx, fy, z));
      if (i && i < n) { const b = new THREE.Mesh(sphGeo(0.085, 8), FEST_MAT); b.position.set(fx, fy - 0.14, z); lobby.add(b); }
    }
    lobby.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x2f2a22 })));
  };
  festoon(-40.5, -15.5, -11.35, 4.85, 12); festoon(-12.6, 12.6, -13.35, 4.85, 12); festoon(15.5, 32.5, -9.35, 4.85, 8);
  AMBIENT.push({ update() { FEST_MAT.color.setHex(isNight ? 0xffe8bc : 0xe6dcc6); } });
  // signs (wood boards)
  const sign = (text, x, z, ry) => { const b = box(5.2, 1.1, 0.12, darkWood, x, 4.2, z, lobby); b.rotation.y = ry; const t = textPlane(4.8, 0.9, text, { size: 120, color: '#fff9ee' }); t.position.set(0, 0, 0.07); b.add(t); const t2 = t.clone(); t2.position.z = -0.07; t2.rotation.y = Math.PI; b.add(t2); };
  sign('CASUAL PLAY', -12.7, 0, Math.PI / 2); sign('PRACTICE MODE', 12.7, 0, -Math.PI / 2);
  const title = textPlane(9, 1.4, 'VOLLEYBALL GAEM', { size: 130, color: '#2b2b2b' }); title.position.set(0, 4.15, 12.75); title.rotation.y = Math.PI; lobby.add(title);   // sits above the slat wall behind the front desk
  // furniture (simple)
  /* Couch: frame, three seat cushions, three back cushions and a couple of accent throw pillows.
     Splitting the slab into cushions with visible gaps is what stops it reading as a beige box. */
  const ACCENT = [0xe5484d, 0xf5c542, 0x3ecf5a, 0x3b8ff0, 0xff8bc4];
  const couch = (x, z, ry, color, y = 0) => {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; lobby.add(g);
    const m = mat(color), cushM = mat(color, { color }), legM = mat(0x7a5a38);
    const shade = new THREE.Color(color).offsetHSL(0, 0.03, 0.07).getHex();
    const softM = mat(shade);
    box(2.6, 0.32, 1.0, m, 0, 0.3, 0, g);                                            // base frame
    box(2.6, 0.62, 0.24, m, 0, 0.75, -0.4, g);                                       // back frame
    box(0.26, 0.46, 1.0, m, 1.2, 0.69, 0, g); box(0.26, 0.46, 1.0, m, -1.2, 0.69, 0, g);   // arms
    for (let i = 0; i < 3; i++) box(0.72, 0.2, 0.86, softM, -0.78 + i * 0.78, 0.56, 0.04, g);          // seat cushions
    for (let i = 0; i < 3; i++) box(0.72, 0.5, 0.18, softM, -0.78 + i * 0.78, 0.88, -0.34, g);         // back cushions
    for (const [px, hue] of [[-0.85, 0], [0.85, 1]]) { const p = box(0.4, 0.4, 0.14, mat(ACCENT[(Math.abs(Math.round(x + z)) + hue) % 5]), px, 0.78, -0.2, g); p.rotation.z = 0.3 - hue * 0.6; }
    for (const [lx, lz] of [[-1.15, 0.4], [1.15, 0.4], [-1.15, -0.4], [1.15, -0.4]]) cyl(0.055, 0.07, 0.28, legM, lx, 0.14, lz, g, 6);
  };
  couch(0, 4.5, Math.PI, 0x7fb7d6); couch(-4.5, 0, Math.PI / 2, 0xe8b86d); couch(4.5, 0, -Math.PI / 2, 0xe8b86d);
  box(1.8, 0.1, 1.0, darkWood, 0, 0.45, 0.6, lobby); for (const [lx, lz] of [[-0.8, 0.2], [0.8, 0.2], [-0.8, 1.0], [0.8, 1.0]]) box(0.1, 0.45, 0.1, darkWood, lx, 0.22, lz, lobby);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(3.6, 8), mat(0xe3d3b4)); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.01, 1.2); rug.receiveShadow = true; lobby.add(rug);
  box(4, 1.0, 1.0, darkWood, 0, 0.5, 11, lobby); box(4.4, 0.1, 1.3, mat(0xf5ead6), 0, 1.05, 11, lobby);          // front counter
  const counterBlock = box(4.8, 4, 2.6, wallM, 0, 2, 11.8, lobby); counterBlock.visible = false; COLLIDERS.push(counterBlock);   // invisible camera blocker: the camera never goes behind the counter
  box(1.2, 0.5, 0.8, darkWood, 0, 0.25, 12.2, lobby);                                                        // step behind the counter
  // --- second floor: a tall glass lounge on top of the centre room, reached by a staircase inside along the north wall ---
  around(-13.2, 13.2, -13.2, 13.2, (a, b, c, d) => { if (b > a && d > c) { const s = box(b - a, 0.3, d - c, woodM, (a + b) / 2, F2 - 0.15, (c + d) / 2, lobby); COLLIDERS.push(s); } });   // its floor (top at F2), minus the stairwell
  ceil(0, 0, 26, 26, F2 + F2H); const roof2 = box(30, 0.5, 30, trimM, 0, F2 + F2H + 0.25, 0, lobby); roof2.castShadow = roof2.receiveShadow = false; fascia(0, F2 + F2H + 0.23, 0, 30, 30);
  const glassWall = (cx, cz, along, len, y) => {                                                              // low wall + posts + tall glass + top beam, along x or z
    const horiz = along === 'x'; const w = horiz ? len : 0.4, d = horiz ? 0.4 : len; const gh = F2H - 1.8;
    wall(cx, cz, w, d, 1.0, y); wall(cx, cz, w, d, 0.8, y + F2H - 0.8);
    const n = Math.round(len / 6.5); const seg = len / n;
    for (let i = 0; i <= n; i++) { const o = -len / 2 + i * seg; box(0.4, F2H, 0.4, wallM, horiz ? cx + o : cx, y + F2H / 2, horiz ? cz : cz + o, lobby); }
    for (let i = 0; i < n; i++) { const o = -len / 2 + (i + 0.5) * seg; const gl = box(horiz ? seg - 0.4 : 0.06, gh, horiz ? 0.06 : seg - 0.4, glassM, horiz ? cx + o : cx, y + 1.0 + gh / 2, horiz ? cz : cz + o, lobby); gl.castShadow = false; paneFrame(horiz ? cx + o : cx, y + 1.0 + gh / 2, horiz ? cz : cz + o, seg - 0.4, gh, horiz, 2); }
    const cap = box(horiz ? len + 0.4 : 0.56, 0.14, horiz ? 0.56 : len + 0.4, railM, cx, y + 1.06, cz, lobby); cap.castShadow = false;   // handrail cap along the balcony wall
  };
  glassWall(0, -13, 'x', 26, F2); glassWall(-13, 0, 'z', 26, F2); glassWall(13, 0, 'z', 26, F2);
  wall(0, 13, 26, 0.4, F2H, F2);                                                                              // solid back wall
  // indoor staircase: along the north wall, x 2.4 (bottom) -> 12.4 (top), z -12.4..-10
  const stairRise = F2, stairRun = 10, steps = 18, sx0 = 2.4, sz = -11.6;                               // treads span z -12.8..-10.4, flush with the wall
  for (let i = 0; i < steps; i++) { const t = (i + 1) / steps; box(stairRun / steps + 0.02, 0.3, 2.4, darkWood, sx0 + (i + 0.5) * stairRun / steps, t * stairRise - 0.15, sz, lobby); }
  const under = box(stairRun, 0.35, 2.4, trimM, sx0 + stairRun / 2, stairRise / 2 - 0.4, sz, lobby); under.rotation.z = Math.atan2(stairRise, stairRun); under.castShadow = false;   // stringer
  box(0.4, 0.3, 2.4, darkWood, 12.6, F2 - 0.15, sz, lobby);                                                   // top step meets the wall
  // upstairs furniture
  couch(0, 4.5, Math.PI, 0x7fb7d6, F2); couch(-5.5, -1, Math.PI / 2, 0xe8b86d, F2); couch(5.5, -1, -Math.PI / 2, 0xe8b86d, F2);
  box(1.8, 0.1, 1.0, darkWood, 0, F2 + 0.45, 0.6, lobby); for (const [lx, lz] of [[-0.8, 0.2], [0.8, 0.2], [-0.8, 1.0], [0.8, 1.0]]) box(0.1, 0.45, 0.1, darkWood, lx, F2 + 0.22, lz, lobby);
  const rug2 = new THREE.Mesh(new THREE.CircleGeometry(3.6, 8), mat(0xd9c9e8)); rug2.rotation.x = -Math.PI / 2; rug2.position.set(0, F2 + 0.01, 1.2); rug2.receiveShadow = true; lobby.add(rug2);
  const plant2 = (x, z) => makePlantPot(lobby, x, F2, z, 1.25, 0xc98a5b, AMBIENT);
  plant2(-11.5, 11.5); plant2(-11.5, -11); plant2(11.5, 11.5); plant2(6, 11.5);
  const sign2 = box(4.2, 0.9, 0.12, darkWood, 0, F2 + 3.6, 12.75, lobby); const st2 = textPlane(3.9, 0.75, 'TRAIT LOUNGE', { size: 120, color: '#fff9ee' }); st2.position.set(0, 0, -0.07); st2.rotation.y = Math.PI; sign2.add(st2);
  for (const [lx, lz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) { const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe9c4 })); bulb.position.set(lx, F2 + F2H - 0.4, lz); lobby.add(bulb); cyl(0.02, 0.02, 0.3, darkWood, lx, F2 + F2H - 0.15, lz, lobby, 5); }
  // --- the hut on the water: a thatched chill-out room at the end of the pier, home of Lil Woman Dealer (emotes) ---
  const thatchM = mat(0xc9a961), hutM = mat(0xf2d9b1), HUT = { x: -60, z: -60.5, y: 0.3 };
  {
    const g = new THREE.Group(); g.position.set(HUT.x, 0, HUT.z); lobby.add(g);
    for (const [px, pz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6], [0, -2.6], [0, 2.6]]) cyl(0.14, 0.14, 2.2, darkWood, px, -0.8, pz, g, 6);   // stilts in the water
    const fl = box(6, 0.3, 6, woodM, 0, HUT.y - 0.15, 0, g); COLLIDERS.push(fl);
    const wallH = 3.0, wy = HUT.y + wallH / 2;
    for (const b of [box(6, wallH, 0.3, hutM, 0, wy, -2.85, g), box(0.3, wallH, 6, hutM, -2.85, wy, 0, g), box(0.3, wallH, 6, hutM, 2.85, wy, 0, g), box(2.2, wallH, 0.3, hutM, -1.9, wy, 2.85, g), box(2.2, wallH, 0.3, hutM, 1.9, wy, 2.85, g), box(1.6, 0.7, 0.3, hutM, 0, HUT.y + wallH - 0.35, 2.85, g)]) COLLIDERS.push(b);   // walls, doorway on the pier side
    const rf = new THREE.Mesh(new THREE.ConeGeometry(5.4, 2.2, 4), thatchM); rf.position.y = HUT.y + wallH + 1.1; rf.rotation.y = Math.PI / 4; rf.castShadow = true; g.add(rf);
    box(6.6, 0.14, 6.6, thatchM, 0, HUT.y + wallH + 0.02, 0, g);                                              // eave
    for (const [wx, wz, ry] of [[-2.85, 0, Math.PI / 2], [2.85, 0, Math.PI / 2], [0, -2.85, 0]]) { const win = box(1.4, 0.9, 0.08, glassM, wx, HUT.y + 1.7, wz, g); win.rotation.y = ry; win.castShadow = false; }
    const rug3 = new THREE.Mesh(new THREE.CircleGeometry(2.0, 8), mat(0xf4c2c2)); rug3.rotation.x = -Math.PI / 2; rug3.position.set(0, HUT.y + 0.01, 0.2); g.add(rug3);
    const cushion = (cx, cz, col) => box(0.7, 0.25, 0.7, mat(col), cx, HUT.y + 0.125, cz, g);
    cushion(-1.9, 1.4, 0xffb3c6); cushion(1.9, 1.4, 0xb3e0ff); cushion(-1.9, -0.6, 0xfff0a0); cushion(1.9, -0.6, 0xc8f5c8);
    box(1.4, 0.08, 0.8, darkWood, 0, HUT.y + 0.45, -1.4, g); for (const [lx, lz] of [[-0.6, -1.7], [0.6, -1.7], [-0.6, -1.1], [0.6, -1.1]]) box(0.08, 0.45, 0.08, darkWood, lx, HUT.y + 0.22, lz, g);   // low table
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe0a8 })); lantern.position.set(0, HUT.y + 2.5, 0); g.add(lantern); cyl(0.02, 0.02, 0.5, darkWood, 0, HUT.y + 2.85, 0, g, 5);
    const flagpole = cyl(0.05, 0.05, 2.0, mat(0xdddddd), 2.9, HUT.y + wallH + 2.0, 2.9, g, 5);
    // the pier reaches the hut
    for (let i = 8; i < 10; i++) box(2.4, 0.15, 1.9, darkWood, -60, 0.25, -40.5 - i * 2, lobby);
  }
  NPC3 = new Rig('wdealer', 'girl'); NPC3.root.position.set(NPC3_POS.x, NPC3_POS.y, NPC3_POS.z); NPC3.root.rotation.y = 0; NPC3.setPose('idle'); NPC3.snap(); lobby.add(NPC3.root);
  AMBIENT.push({ update(t, dt) { NPC3.update(dt, t); NPC3.j.neck.rotation.y = Math.sin(t * 0.5) * 0.25; } });
  NPC = new Rig('dealer'); NPC.root.position.set(0, 0.5, 12.2); NPC.root.rotation.y = Math.PI; NPC.snap(); lobby.add(NPC.root);
  AMBIENT.push({ update(t, dt) { NPC.update(dt, t); } });   // the dealer breathes and shifts his weight like everyone else
  NPC2 = new Rig('bigdealer'); NPC2.setScale(RIG_SCALE * 1.2 * 1.12, RIG_SCALE * 1.2, RIG_SCALE * 1.2 * 1.12);   // a big man: taller and broader
  NPC2.root.position.set(NPC2_POS.x, F2 - 0.22, NPC2_POS.z); NPC2.root.rotation.y = Math.PI; NPC2.setPose('sit'); NPC2.base = 'sit'; NPC2.snap(); lobby.add(NPC2.root);
  AMBIENT.push({ update(t, dt) { NPC2.update(dt, t); NPC2.j.neck.rotation.y += Math.sin(t * 0.6) * 0.3; } });   // the sit pose keeps breathing; the extra term is him looking around the lounge
  const plant = (x, z) => makePlantPot(lobby, x, 0, z, 1.3, 0xc98a5b, AMBIENT);
  plant(-11.5, 11.5); plant(11.5, 11.5); plant(-11.5, -4.5); plant(11.5, 4.5); plant(-39.5, 9.5); plant(-17, 9.5); plant(17, 7.5); plant(31.5, 7.5);
  const board = box(0.12, 2.4, 0.6, mat(0xf07a5a), 12.4, 1.25, 9.5, lobby); board.rotation.z = -0.15;                 // surfboard
  const board2 = box(0.12, 2.4, 0.6, mat(0x6fd0c8), -12.4, 1.25, 9.5, lobby); board2.rotation.z = 0.15;
  for (const [x, z] of [[-30, 7], [-22, 7]]) { box(1.2, 0.08, 1.2, darkWood, x, 0.7, z, lobby); cyl(0.05, 0.05, 0.7, darkWood, x, 0.35, z, lobby, 6); for (const [dx, dz] of [[0, 0.9], [0, -0.9], [0.9, 0], [-0.9, 0]]) box(0.45, 0.45, 0.45, mat(0xf2d8a8), x + dx, 0.225, z + dz, lobby); }
  const fan = (x, z) => { cyl(0.1, 0.1, 0.5, darkWood, x, 4.75, z, lobby, 6); const hub = new THREE.Group(); hub.position.set(x, 4.5, z); lobby.add(hub); for (let i = 0; i < 4; i++) { const b = box(1.4, 0.04, 0.3, darkWood, Math.cos(i * Math.PI / 2) * 0.7, 0, -Math.sin(i * Math.PI / 2) * 0.7, hub); b.rotation.y = i * Math.PI / 2; } AMBIENT.push({ update(t, dt) { hub.rotation.y += dt * 2.2; } }); };
  fan(0, 0); fan(-28, 0); fan(24, 0);
  // warm lamps to give the rooms some life
  const lamp = (x, z, y = 4.3, color = 0xffd9a8, inten = 0.7, dist = 20) => { const l = new THREE.PointLight(color, inten, dist, 1.4); l.position.set(x, y, z); lobby.add(l); const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff1cc })); bulb.position.set(x, y, z); lobby.add(bulb); const shade = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.4, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xf1d9b0, side: THREE.DoubleSide })); shade.position.set(x, y + 0.25, z); lobby.add(shade); cyl(0.03, 0.03, 5 - y - 0.4, darkWood, x, (5 + y + 0.4) / 2, z, lobby, 4);     /* After dark the lamps pull in: same brightness, shorter reach and a warmer colour, so the room
       breaks into pools of light with dark corners between them instead of being evenly flooded. */
    AMBIENT.push({ ph: Math.random() * 6, update(t) {
      l.intensity = inten * (isNight ? 1.12 : 1) * (0.92 + Math.sin(t * 2.1 + this.ph) * 0.05 + Math.sin(t * 7.3 + this.ph) * 0.03);
      l.distance = dist * (isNight ? 0.62 : 1);
      l.color.setHex(isNight ? 0xffc383 : color);
    } });
  };
  lamp(-6, 0, 4.3, 0xffd9a8, 0.9, 24); lamp(6, 0, 4.3, 0xffd9a8, 0.9, 24); lamp(0, 10.5, 3.6, 0xffe2b8, 0.9, 14);   // fewer, wider pools of light: point lights cost every pixel on screen
  lamp(-34, 0, 4.3, 0xffd9a8, 0.9, 24); lamp(-22, 0, 4.3, 0xffd9a8, 0.9, 24); lamp(24, 0, 4.3, 0xffd9a8, 0.9, 24);
  for (const [x, z] of [[-12.6, -8], [-12.6, 8], [12.6, -8], [12.6, 8]]) { box(0.3, 0.5, 0.18, mat(0xfff0d0, { emissive: 0xffe0a0, emissiveIntensity: .8 }), x + (x < 0 ? 0.1 : -0.1), 2.6, z, lobby); }
  dressLobby({ wallM, trimM, ceilM, woodM, darkWood, glassM, leafM, railM, fasciaM });
  scene.add(lobby);
  makePad('c2v2', '2v2', 2, -38.5, -7, Math.PI / 2, '2v2', false);
  makePad('c3v3', '3v3', 3, -38.5, 0, Math.PI / 2, '3v3', false);
  makePad('c6v6', '6v6', 6, -38.5, 7, Math.PI / 2, '6v6', false);
  makePad('practice', 'Practice Mode', 6, 30.5, 0, -Math.PI / 2, 'practice', true);
  for (const id in PADS) lobby.add(PADS[id].group);
}
/* =====================================================================
   LOBBY DRESSING — the detail pass
   Cladding, trim, rafters, signage, awnings, planting, furniture and the small animated
   props that make the place feel inhabited. Decoration ONLY: nothing in here registers a
   collider, a walkable region, a blocked footprint, a pad or a hitbox, so none of it can
   change where a player can stand or what a ball can hit.
   ===================================================================== */
function dressLobby(M) {
  const T = detailTex();
  const put = (w, h, d, m, x, y, z, cast) => { const b = box(w, h, d, m, x, y, z, lobby); b.castShadow = !!cast; b.receiveShadow = true; return b; };
  const trimM = mat(0xa8845a), postM = mat(0xe4d7bd), ropeM = mat(0x9c8256);
  const stoneM = tiledMat('stone', 6, 1);
  const CREAM = mat(0xf2e9d6);

  /* ---------- base render band -------------------------------------------------
     A plinth around the foot of each block. It reads as a real footing and, more
     usefully, stops the white walls from meeting the sand in a dead straight seam. */
  const plinth = (x, z, w, d) => { const b = put(w, 0.58, d, stoneM, x, 0.29, z, false); b.receiveShadow = true; };
  plinth(0, 13.25, 26.6, 0.5); plinth(-6.5, -13.25, 13.2, 0.5); plinth(6.5, -13.25, 13.2, 0.5);      // centre block, north face split around the doorway
  plinth(-28, 11.25, 26.6, 0.5); plinth(-28, -11.25, 26.6, 0.5); plinth(-41.25, 0, 0.5, 22.6);       // west wing
  plinth(24, 9.25, 18.6, 0.5); plinth(24, -9.25, 18.6, 0.5); plinth(33.25, 0, 0.5, 18.6);            // east wing

  /* ---------- slat cladding on the blank elevations ---------------------------- */
  const clad = (x, z, len, horiz, y = 1.6, h = 1.9) => {
    const b = box(horiz ? len : 0.14, h, horiz ? 0.14 : len, slatMat(len), x, y, z, lobby); b.castShadow = false;
    box(horiz ? len + 0.1 : 0.24, 0.16, horiz ? 0.24 : len + 0.1, trimM, x, y + h / 2 + 0.06, z, lobby).castShadow = false;   // cap rail
    box(horiz ? len + 0.1 : 0.24, 0.14, horiz ? 0.24 : len + 0.1, trimM, x, y - h / 2 - 0.05, z, lobby).castShadow = false;   // skirt
  };
  clad(0, 13.32, 26, true); clad(-28, 11.32, 26, true); clad(24, 9.32, 18, true);
  clad(-41.32, 0, 22, false); clad(33.32, 0, 18, false);
  clad(-6.5, -13.32, 10.4, true, 0.78, 0.34); clad(6.5, -13.32, 10.4, true, 0.78, 0.34);              // the low wall under the north windows

  /* ---------- rafter tails under the eaves ------------------------------------- */
  const rafters = (x0, x1, z, y, along) => {
    const n = Math.max(2, Math.round(Math.abs(x1 - x0) / 2.8));
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = lerp(x0, x1, t);
      const b = box(along === 'x' ? 0.15 : 0.8, 0.2, along === 'x' ? 0.8 : 0.15, trimM, along === 'x' ? p : x0, y, along === 'x' ? z : p, lobby);
      b.castShadow = false;
    }
  };
  rafters(-42, -14, -13.5, 4.88, 'x'); rafters(-42, -14, 13.5, 4.88, 'x');
  rafters(14, 34, -11.5, 4.88, 'x'); rafters(14, 34, 11.5, 4.88, 'x');
  rafters(-14.5, 14.5, -15.4, F2 + F2H - 0.12, 'x'); rafters(-14.5, 14.5, 15.4, F2 + F2H - 0.12, 'x');
  rafters(-14.5, 14.5, -15.4, F2 + F2H - 0.12, 'z'); rafters(-14.5, 14.5, 15.4, F2 + F2H - 0.12, 'z');

  /* ---------- corner posts ------------------------------------------------------ */
  for (const [cx, cz, top] of [[-13.3, 13.3, 5.2], [13.3, 13.3, 5.2], [-41.3, 11.3, 5.2], [-41.3, -11.3, 5.2], [33.3, 9.3, 5.2], [33.3, -9.3, 5.2]]) {
    box(0.52, top, 0.52, postM, cx, top / 2, cz, lobby).castShadow = false;
    box(0.68, 0.26, 0.68, trimM, cx, 0.13, cz, lobby).castShadow = false;
    box(0.68, 0.22, 0.68, trimM, cx, top - 0.11, cz, lobby).castShadow = false;
  }

  /* ---------- awnings over the wing windows ------------------------------------ */
  const awnStripe = mat(0xffffff, { map: T.stripe, side: THREE.DoubleSide });
  const awning = (x, z, w) => {
    const g = new THREE.Group(); g.position.set(x, 4.34, z - 0.28); lobby.add(g);
    const can = box(w, 0.1, 1.55, awnStripe, 0, 0, -0.6, g); can.rotation.x = -0.42; can.castShadow = true;
    box(w + 0.14, 0.16, 0.2, trimM, 0, 0.14, 0.04, g).castShadow = false;
    for (const s of [-1, 1]) { const br = box(0.08, 0.75, 0.08, trimM, s * (w / 2 - 0.2), -0.25, -0.42, g); br.rotation.x = 0.5; br.castShadow = false; }
  };
  for (const x of [-37.75, -31.25, -24.75, -18.25]) awning(x, -11, 5.9);
  for (const x of [18, 24, 30]) awning(x, -9, 5.4);

  /* ---------- veranda: a flush plank apron at the front door -------------------- */
  const deck = box(17, 0.05, 6.4, plankMat(17, 6.4), 0, 0.015, -16.6, lobby); deck.castShadow = false; deck.receiveShadow = true;
  for (const [dx, dz, dw, dd] of [[0, -19.85, 17.3, 0.34], [-8.65, -16.6, 0.34, 6.7], [8.65, -16.6, 0.34, 6.7]]) box(dw, 0.14, dd, trimM, dx, 0.05, dz, lobby).castShadow = false;

  /* ---------- the lit sign over the door ---------------------------------------- */
  {
    const g = new THREE.Group(); g.position.set(0, 4.62, -13.55); lobby.add(g);
    const tex = canvasTex(1024, 192, (c, w, h) => {
      c.fillStyle = '#12324a'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#0d2639'; c.fillRect(8, 8, w - 16, h - 16);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#ffd873'; fitText(c, 'VOLLEYBALL GAEM', 116, w * 0.86); c.fillText('VOLLEYBALL GAEM', w / 2, h / 2 - 6);
      c.fillStyle = '#7fe6ff'; c.font = '800 34px Montserrat, Arial'; c.fillText('BEACH CLUB  ·  EST. 2026', w / 2, h - 40);
    });
    const face = mat(0xffffff, { map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9 });
    box(12, 1.55, 0.14, face, 0, 0, -0.1, g).castShadow = false;
    box(12.5, 1.95, 0.22, mat(0x2b4d63), 0, 0, 0, g).castShadow = false;
    for (const s of [-1, 1]) box(0.34, 2.3, 0.34, trimM, s * 6.4, 0, 0.02, g).castShadow = false;
    const strip = box(11.6, 0.12, 0.1, new THREE.MeshBasicMaterial({ color: 0x7fe6ff }), 0, -1.02, -0.16, g); strip.castShadow = false;
    AMBIENT.push({ update(t) { const k = 0.72 + Math.sin(t * 1.6) * 0.1 + Math.sin(t * 5.3) * 0.04; face.emissiveIntensity = isNight ? k + 0.5 : k; strip.material.color.setHSL(0.52, 0.9, isNight ? 0.72 : 0.6); } });
  }

  /* ---------- planters along the facade ----------------------------------------- */
  const planter = (x, z, w) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); lobby.add(g);
    box(w, 0.64, 1.1, slatMat(w), 0, 0.32, 0, g).castShadow = true;
    box(w + 0.14, 0.14, 1.24, trimM, 0, 0.68, 0, g).castShadow = false;
    box(w - 0.2, 0.1, 0.9, mat(0x4a3626), 0, 0.7, 0, g).castShadow = false;
    const n = Math.max(2, Math.round(w / 1.4));
    for (let i = 0; i < n; i++) makePlantPot(g, -w / 2 + (i + 0.5) * w / n, 0.34, (Math.random() - 0.5) * 0.3, 0.62, 0xb8663f, AMBIENT);
  };
  planter(-10.2, -14.2, 4.6); planter(10.2, -14.2, 4.6);
  planter(-28, -12.2, 5); planter(24, -10.2, 4.4);

  /* ---------- surfboard rack ------------------------------------------------------ */
  {
    const g = new THREE.Group(); g.position.set(-17.6, 0, -14.4); g.rotation.y = 0.3; lobby.add(g);
    for (const s of [-1, 1]) { const leg = box(0.14, 2.5, 0.14, trimM, s * 1.5, 1.25, 0, g); leg.rotation.z = -s * 0.12; }
    box(3.3, 0.14, 0.5, trimM, 0, 0.5, 0, g); box(3.3, 0.14, 0.5, trimM, 0, 1.9, 0, g);
    const cols = [0xf07a5a, 0x6fd0c8, 0xf5c542, 0x8f7fe0];
    for (let i = 0; i < 4; i++) {
      const b = box(0.13, 2.45, 0.62, mat(cols[i]), -1.2 + i * 0.8, 1.3, 0, g); b.rotation.z = 0.09 + i * 0.02;
      box(0.03, 1.9, 0.1, mat(0xffffff), -1.2 + i * 0.8 + 0.08, 1.3, 0, g).rotation.z = 0.09 + i * 0.02;   // stripe
    }
  }

  /* ---------- rope fence along the path down to the courts ---------------------- */
  const ropeRun = (pts, h = 1.0) => {
    for (const [px, pz] of pts) { cyl(0.08, 0.1, h, trimM, px, h / 2, pz, lobby, 7); ball(0.1, trimM, px, h, pz, lobby, 8).castShadow = false; }
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], seg = [];
      for (let k = 0; k <= 6; k++) { const t = k / 6; seg.push(new THREE.Vector3(lerp(ax, bx, t), h - 0.06 - Math.sin(t * Math.PI) * 0.16, lerp(az, bz, t))); }
      lobby.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(seg), new THREE.LineBasicMaterial({ color: 0x8a7048 })));
    }
  };
  ropeRun([[-20, -20], [-20, -24.5], [-20.5, -29], [-21, -33.5]]);   // off to the sides, framing the walk down to the courts rather than crossing it
  ropeRun([[20, -20], [20, -24.5], [20.5, -29], [21, -33.5]]);

  /* ---------- tiki bar out on the sand ------------------------------------------- */
  {
    const g = new THREE.Group(); g.position.set(-24, 0, -19); g.rotation.y = 0.45; lobby.add(g);
    box(4.2, 1.1, 1.2, slatMat(4.2), 0, 0.55, 0, g);
    box(4.7, 0.16, 1.6, trimM, 0, 1.18, 0, g);
    for (const s of [-1, 1]) cyl(0.11, 0.13, 2.9, trimM, s * 2.1, 1.45, -0.4, g, 7);
    const th = new THREE.Mesh(new THREE.ConeGeometry(3.3, 1.15, 4), mat(0xc9a961)); th.position.set(0, 3.35, -0.4); th.rotation.y = Math.PI / 4; th.castShadow = true; g.add(th);
    box(4.8, 0.12, 2.6, mat(0xc9a961), 0, 2.86, -0.4, g).castShadow = false;
    for (let i = 0; i < 6; i++) { const c = [0x8ad4ff, 0xffd36e, 0xff8bc4, 0x9ef5a0][i % 4]; cyl(0.07, 0.09, 0.34, mat(c, { emissive: c, emissiveIntensity: 0.15 }), -1.6 + i * 0.64, 1.43, -0.1, g, 7).castShadow = false; }
    for (let i = 0; i < 3; i++) { const st = new THREE.Group(); st.position.set(-1.2 + i * 1.2, 0, 1.3); g.add(st); cyl(0.36, 0.34, 0.12, mat(0xcf8a4e), 0, 0.86, 0, st, 10); for (let k = 0; k < 3; k++) { const a = k / 3 * TAU; cyl(0.05, 0.06, 0.86, trimM, Math.cos(a) * 0.24, 0.43, Math.sin(a) * 0.24, st, 6); } }
    const lantern = new THREE.Mesh(sphGeo(0.17, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a0 })); lantern.position.set(0, 2.6, 0.5); g.add(lantern);
  }

  /* ---------- buoys bobbing in the shallows -------------------------------------- */
  for (const [bx, bz, hue] of [[-30, -48, 0xe5484d], [12, -52, 0xf5c542], [46, -46, 0x3b8ff0], [-58, -46, 0x3ecf5a]]) {
    const g = new THREE.Group(); g.position.set(bx, 0, bz); lobby.add(g);
    cyl(0.34, 0.44, 0.9, mat(hue), 0, 0.45, 0, g, 10); cyl(0.36, 0.3, 0.3, mat(0xf6f2e6), 0, 1.05, 0, g, 10);
    cyl(0.05, 0.05, 0.5, trimM, 0, 1.4, 0, g, 6); ball(0.1, mat(0x2b2b2b), 0, 1.66, 0, g, 8).castShadow = false;
    AMBIENT.push({ ph: Math.random() * 6, update(t) { g.position.y = 0.3 + Math.sin(t * 1.1 + this.ph) * 0.18; g.rotation.z = Math.sin(t * 0.9 + this.ph) * 0.13; g.rotation.x = Math.cos(t * 0.8 + this.ph) * 0.11; } });
  }

  /* ---------- a sailboat working its way along the horizon ----------------------- */
  {
    const g = new THREE.Group(); lobby.add(g);
    box(1.9, 0.8, 6.4, mat(0xf4f4f4), 0, 0.3, 0, g); box(1.5, 0.3, 5.2, mat(0x2f6f9e), 0, 0.78, 0, g);
    cyl(0.09, 0.11, 7.4, trimM, 0, 4, -0.4, g, 7);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 5.6), new THREE.MeshStandardMaterial({ color: 0xfdfbf2, side: THREE.DoubleSide, roughness: 0.9 }));
    sail.position.set(0.9, 4.2, 0.5); sail.rotation.y = Math.PI / 2 + 0.22; g.add(sail);
    const jib = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 3.9), new THREE.MeshStandardMaterial({ color: 0xffd9a0, side: THREE.DoubleSide, roughness: 0.9 }));
    jib.position.set(-0.5, 3.6, -2.2); jib.rotation.y = Math.PI / 2 - 0.3; g.add(jib);
    AMBIENT.push({ update(t) {
      const p = ((t * 0.012) % 1), x = lerp(-150, 150, p);
      g.position.set(x, 0.2 + Math.sin(t * 0.7) * 0.16, -96 + Math.sin(p * 6) * 8);
      g.rotation.y = Math.PI / 2 + Math.sin(t * 0.5) * 0.05; g.rotation.z = Math.sin(t * 0.6) * 0.05;
    } });
  }

  /* ---------- crabs picking their way across the sand ---------------------------- */
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group(); lobby.add(g);
    const cm = mat([0xe06a4a, 0xf08a5a, 0xd8553f][i % 3]);
    box(0.42, 0.2, 0.32, cm, 0, 0.16, 0, g); for (const s of [-1, 1]) ball(0.055, mat(0x1a1a1a), s * 0.1, 0.29, 0.12, g, 6).castShadow = false;
    const legs = [];
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { const l = box(0.05, 0.05, 0.24, cm, s * 0.23, 0.1, -0.1 + k * 0.1, g); l.castShadow = false; l.rotation.z = s * 0.5; legs.push(l); }
    for (const s of [-1, 1]) { const cl = box(0.17, 0.11, 0.13, cm, s * 0.26, 0.18, 0.2, g); cl.castShadow = false; legs.push(cl); }
    const cx = -80 + Math.random() * 160, cz = -36 + Math.random() * 14, rad = 2 + Math.random() * 4, sp = 0.3 + Math.random() * 0.3, ph = Math.random() * 6;
    AMBIENT.push({ update(t) {
      const a = t * sp + ph;
      g.position.set(cx + Math.cos(a) * rad, 0.02, cz + Math.sin(a * 0.7) * rad * 0.6);
      g.rotation.y = -a + Math.PI / 2;
      for (let k = 0; k < legs.length; k++) legs[k].position.y = 0.1 + Math.abs(Math.sin(t * 9 + k * 1.1)) * 0.04;
    } });
  }

  dressLobbyInterior(M);
}
/* The inside of the beach house: beams, wainscot, art, shelving, the front desk and the
   upstairs bar. Same rule as the exterior — decoration only. */
function dressLobbyInterior(M) {
  const T = detailTex();
  const trimM = mat(0xa8845a), beamM = mat(0x9c7549), darkM = mat(0x6e5033), capM = mat(0xb89263);
  const B = (w, h, d, m, x, y, z, cast) => { const b = box(w, h, d, m, x, y, z, lobby); b.castShadow = !!cast; return b; };

  /* ---------- exposed ceiling beams --------------------------------------------
     The single biggest thing a plain box room is missing: something overhead to read
     depth against. Six beams plus a pair of purlins per room. */
  const beams = (x0, x1, z0, z1, y, along, n) => {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      if (along === 'x') B(x1 - x0, 0.34, 0.26, beamM, (x0 + x1) / 2, y, lerp(z0, z1, t), false);
      else B(0.26, 0.34, z1 - z0, beamM, lerp(x0, x1, t), y, (z0 + z1) / 2, false);
    }
  };
  beams(-12.8, 12.8, -12.8, 12.8, 4.78, 'x', 7);
  B(0.34, 0.4, 25.6, darkM, -6.4, 4.7, 0, lobby).castShadow = false; B(0.34, 0.4, 25.6, darkM, 6.4, 4.7, 0, lobby).castShadow = false;
  beams(-40.8, -15.2, -10.8, 10.8, 4.78, 'x', 6);
  B(0.34, 0.4, 21.6, darkM, -34, 4.7, 0, lobby).castShadow = false; B(0.34, 0.4, 21.6, darkM, -22, 4.7, 0, lobby).castShadow = false;
  beams(15.2, 32.8, -8.8, 8.8, 4.78, 'x', 5);
  B(0.34, 0.4, 17.6, darkM, 24, 4.7, 0, lobby).castShadow = false;
  beams(-12.8, 12.8, -10.4, 12.8, F2 + F2H - 0.22, 'x', 6);                    // the upstairs lounge

  /* ---------- wainscot + cap rail ------------------------------------------------
     Runs are split around the doorways so nothing boards over an opening. */
  const wains = (x, z, len, horiz, y0 = 0) => {
    B(horiz ? len : 0.1, 1.06, horiz ? 0.1 : len, slatMat(len), x, y0 + 0.53, z, false);
    B(horiz ? len : 0.22, 0.12, horiz ? 0.22 : len, capM, x, y0 + 1.1, z, false);
    B(horiz ? len : 0.2, 0.14, horiz ? 0.2 : len, darkM, x, y0 + 0.07, z, false);
  };
  wains(0, 12.74, 25.6, true);                                                                     // centre: south wall
  for (const s of [-1, 1]) { wains(s * 12.74, -7.6, 10.2, false); wains(s * 12.74, 7.6, 10.2, false); }   // centre: side walls, split at the corridors
  wains(-28, 10.74, 25.6, true); wains(-40.74, 0, 21.6, false);                                    // west room
  for (const s of [-1, 1]) wains(-15.26, s * 6.6, 8.2, false);
  wains(24, 8.74, 17.6, true); wains(32.74, 0, 17.6, false);                                       // east room
  for (const s of [-1, 1]) wains(15.26, s * 5.6, 6.2, false);
  wains(0, 12.74, 25.6, true, F2); wains(-12.74, 1, 22, false, F2); wains(12.74, 1, 22, false, F2); // upstairs

  /* ---------- pennant bunting across the ceilings -------------------------------- */
  const bunting = (x, z0, z1, y, horiz, len) => {
    const t = T.bunting.clone(); t.needsUpdate = true; t.wrapS = THREE.RepeatWrapping; t.repeat.set(Math.max(1, len / 6), 1);
    const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.85), m);
    p.position.set(x, y, z0); if (!horiz) p.rotation.y = Math.PI / 2; lobby.add(p);
  };
  bunting(0, -7, 0, 4.45, true, 25); bunting(0, 7, 0, 4.45, true, 25);
  bunting(-28, -5, 0, 4.45, true, 25); bunting(-28, 5, 0, 4.45, true, 25);
  bunting(24, -4, 0, 4.45, true, 17); bunting(24, 4, 0, 4.45, true, 17);

  /* ---------- artwork ------------------------------------------------------------ */
  const ballArt = (c, w, h) => {
    c.fillStyle = '#1d5f86'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2f86b8'; for (let i = 0; i < 9; i++) { c.beginPath(); c.arc(w / 2, h + 40, 60 + i * 46, Math.PI, 0); c.stroke(); }
    c.fillStyle = '#f6e7c8'; c.beginPath(); c.arc(w / 2, h * 0.48, h * 0.27, 0, TAU); c.fill();
    c.strokeStyle = '#c9922f'; c.lineWidth = 7;
    for (const o of [-0.5, 0, 0.5]) { c.beginPath(); c.ellipse(w / 2, h * 0.48, h * 0.27, h * 0.27 * Math.abs(o || 0.28), o, 0, TAU); c.stroke(); }
    c.fillStyle = '#0e3b56'; c.textAlign = 'center'; c.font = '900 46px Montserrat, Arial'; c.fillText('BEACH CLUB', w / 2, h - 34);
  };
  const listArt = (title, rows, bg, ink) => (c, w, h) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
    c.fillStyle = ink; c.fillRect(0, 0, w, 74);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = bg; c.font = '900 44px Montserrat, Arial'; c.fillText(title, w / 2, 38);
    c.textAlign = 'left'; c.fillStyle = ink; c.font = '800 30px Montserrat, Arial';
    rows.forEach((r, i) => { c.globalAlpha = i % 2 ? 0.75 : 1; c.fillText(r, 34, 122 + i * 52); });
    c.globalAlpha = 1;
  };
  const photoArt = (hues) => (c, w, h) => {
    c.fillStyle = '#f3ead6'; c.fillRect(0, 0, w, h);
    hues.forEach((hue, i) => { c.fillStyle = hue; c.fillRect(20 + i * (w - 40) / hues.length, 20, (w - 40) / hues.length - 12, h - 40); });
    c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(0, 0, w, h * 0.35);
  };
  makePoster(lobby, -8, 3.0, 12.7, Math.PI, 3.2, 2.1, ballArt);
  makePoster(lobby, 8, 3.0, 12.7, Math.PI, 3.2, 2.1, photoArt(['#3fb4e6', '#f5c542', '#e5484d']));
  makePoster(lobby, -12.7, 2.9, -8, Math.PI / 2, 2.6, 1.9, listArt('HOUSE RULES', ['1. THREE TOUCHES', '2. NO NET TOUCH', '3. CALL YOUR BALL', '4. HAVE FUN'], '#f6efdd', '#2d5f3a'));
  makePoster(lobby, 12.7, 2.9, -8, -Math.PI / 2, 2.6, 1.9, listArt('TIDE TABLE', ['HIGH   06:12', 'LOW    12:40', 'HIGH   18:31', 'LOW    00:52'], '#e8f2f6', '#1d5f86'));
  makePoster(lobby, -28, 3.1, 10.65, Math.PI, 4.4, 2.6, listArt('CASUAL PLAY', ['2v2   ·   BEACH COURT', '3v3   ·   BEACH COURT', '6v6   ·   FULL COURT', 'WINNERS STAY ON'], '#fbf3e2', '#b3452a'));
  makePoster(lobby, -36, 3.0, 10.65, Math.PI, 3.0, 2.0, photoArt(['#3ecf5a', '#f5c542']));
  makePoster(lobby, -40.65, 2.95, -5, Math.PI / 2, 2.8, 2.0, ballArt);
  makePoster(lobby, 24, 3.1, 8.65, Math.PI, 4.0, 2.4, listArt('PRACTICE', ['SPAWN A BALL   G', 'SERVE          1', 'SPIKE        HOLD', 'NO SCORE, NO CLOCK'], '#eef4fb', '#26527a'));
  makePoster(lobby, 32.65, 2.95, 3, -Math.PI / 2, 2.6, 1.9, photoArt(['#8f7fe0', '#6fd0c8', '#ffd36e']));
  makePoster(lobby, 0, F2 + 3.0, 12.7, Math.PI, 4.0, 2.4, listArt('TRAIT LOUNGE', ['OPEN CHESTS UPSTAIRS', 'ONE PASSIVE  ·  ONE ABILITY', 'TALK TO THE BIG MAN'], '#2a2036', '#f0c860'));

  /* ---------- front desk --------------------------------------------------------- */
  {
    const g = new THREE.Group(); g.position.set(0, 0, 11); lobby.add(g);
    B(10.6, 3.1, 0.14, slatMat(10.6), 0, 1.55, 12.72, false);                           // slat feature wall behind the desk (world coords: B parents to `lobby`)
    B(10.9, 0.18, 0.3, capM, 0, 3.19, 12.72, false);
    box(4.3, 0.16, 1.55, capM, 0, 1.12, 0, g).castShadow = false;                       // countertop, overhanging the base
    box(4.05, 1.0, 0.12, slatMat(4.05), 0, 0.5, -0.53, g).castShadow = false;           // slatted front panel
    box(0.34, 0.44, 0.26, mat(0x2b2b2b), -1.5, 1.42, 0.1, g).castShadow = false;        // monitor
    box(0.42, 0.26, 0.04, mat(0x1f2d3a, { emissive: 0x2f6f9e, emissiveIntensity: 0.5 }), -1.5, 1.52, 0.23, g).castShadow = false;
    ball(0.09, mat(0xd6c05a), 1.55, 1.25, 0.1, g, 10).castShadow = false;               // desk bell
    cyl(0.13, 0.11, 0.07, mat(0xd6c05a), 1.55, 1.18, 0.1, g, 10).castShadow = false;
    for (let i = 0; i < 4; i++) box(0.5, 0.08, 0.36, mat(i % 2 ? 0xffffff : 0x9ed8ef), 0.6, 1.24 + i * 0.08, 0.1, g).castShadow = false;   // folded towels
    makePlantPot(g, -2.0, 1.2, 0.1, 0.5, 0xb8663f, AMBIENT);
    const sTex = canvasTex(512, 128, (c, w, h) => { c.fillStyle = '#12324a'; c.fillRect(0, 0, w, h); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ffd873'; c.font = '900 66px Montserrat, Arial'; c.fillText('FRONT DESK', w / 2, h / 2); });
    const sm = mat(0xffffff, { map: sTex, emissive: 0xffffff, emissiveMap: sTex, emissiveIntensity: 0.6 });
    box(4.2, 0.86, 0.1, sm, 0, 2.45, 1.6, g).castShadow = false;
    for (let i = 0; i < 3; i++) makeShelf(lobby, -4.6 + i * 4.6, 0, 12.5, 0, 2.0, 2.3);   // shelving either side of the desk
  }

  /* ---------- seating, shelving and clutter -------------------------------------- */
  const rugTex = T.rug;
  for (const [rx, rz, ry] of [[0, 1.2, 0], [-28, 0, 0], [24, 0, 0]]) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(rx === 0 ? 7.4 : 8.4, rx === 0 ? 7.4 : 6.4), mat(0xffffff, { map: rugTex }));
    r.rotation.x = -Math.PI / 2; r.rotation.z = ry; r.position.set(rx, 0.012, rz); r.receiveShadow = true; lobby.add(r);
  }
  makeBench(lobby, -9.4, 0, 12.0, 0, 2.6); makeBench(lobby, 9.4, 0, 12.0, 0, 2.6);
  makeBench(lobby, -38.6, 0, 10.2, 0, 2.6); makeBench(lobby, -17.4, 0, 10.2, 0, 2.6);
  makeBench(lobby, 17.2, 0, 8.2, 0, 2.4); makeBench(lobby, 30.8, 0, 8.2, 0, 2.4);
  makeShelf(lobby, -40.2, 0, 6.0, Math.PI / 2, 2.2, 2.4); makeShelf(lobby, -40.2, 0, -6.0, Math.PI / 2, 2.2, 2.4);
  makeShelf(lobby, 32.2, 0, -5.0, -Math.PI / 2, 2.0, 2.3);
  for (const [cx, cz] of [[-39.4, 2.4], [-39.0, 3.4], [-16.4, -8.6], [31.9, 6.4], [11.9, -9.6], [-11.9, -9.6]]) makeCrate(lobby, cx, 0, cz, 0.8 + Math.random() * 0.3);

  /* ball bins: an open crate with volleyballs heaped in it */
  const ballBin = (x, z) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = Math.random(); lobby.add(g);
    for (const [ox, oz, bw, bd] of [[0, -0.6, 1.5, 0.1], [0, 0.6, 1.5, 0.1], [-0.7, 0, 0.1, 1.3], [0.7, 0, 0.1, 1.3]]) box(bw, 0.72, bd, slatMat(1.5), ox, 0.36, oz, g);
    box(1.5, 0.08, 1.3, darkM, 0, 0.04, 0, g).castShadow = false;
    const cols = [0xffffff, 0xffd000, 0x3b8ff0, 0xe5484d, 0xf6f2e6];
    for (let i = 0; i < 7; i++) ball(0.27, mat(cols[i % 5]), (Math.random() - 0.5) * 0.9, 0.34 + Math.random() * 0.5, (Math.random() - 0.5) * 0.8, g, 12);
  };
  ballBin(-17.6, -8.4); ballBin(31.6, -6.2); ballBin(-39.2, -8.6);

  /* wall clock over the doorway */
  {
    const g = new THREE.Group(); g.position.set(0, 3.6, 12.6); lobby.add(g);
    cyl(0.46, 0.46, 0.12, capM, 0, 0, 0, g, 20).rotation.x = Math.PI / 2;
    const ct = canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#fbf6ea'; c.beginPath(); c.arc(w / 2, h / 2, w / 2, 0, TAU); c.fill();
      c.strokeStyle = '#2b2b2b'; c.lineWidth = 6; c.lineCap = 'round';
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; c.beginPath(); c.moveTo(w / 2 + Math.cos(a) * 96, h / 2 + Math.sin(a) * 96); c.lineTo(w / 2 + Math.cos(a) * 110, h / 2 + Math.sin(a) * 110); c.stroke(); }
      c.lineWidth = 10; c.beginPath(); c.moveTo(w / 2, h / 2); c.lineTo(w / 2 + 52, h / 2 - 30); c.stroke();
      c.lineWidth = 7; c.beginPath(); c.moveTo(w / 2, h / 2); c.lineTo(w / 2 - 20, h / 2 - 86); c.stroke();
    });
    const f = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24), mat(0xffffff, { map: ct, emissive: 0xffffff, emissiveMap: ct, emissiveIntensity: 0.2 }));
    f.position.z = -0.07; f.rotation.y = Math.PI; g.add(f);
  }

  /* ---------- painted arrival rings in front of each pad ------------------------- */
  const padRing = (x, z, hue) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); lobby.add(g);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.05, 2.4, 40), new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.014; g.add(ring);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(2.0, 40), new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0.14, depthWrite: false }));
    inner.rotation.x = -Math.PI / 2; inner.position.y = 0.013; g.add(inner);
    AMBIENT.push({ update(t) { const k = 0.36 + Math.sin(t * 2.2) * 0.14; ring.material.opacity = k; ring.scale.setScalar(1 + Math.sin(t * 2.2) * 0.02); } });
  };
  padRing(-36.3, -7, 0xff7a5a); padRing(-36.3, 0, 0xff7a5a); padRing(-36.3, 7, 0xff7a5a); padRing(28.3, 0, 0x5ad0ff);

  /* ---------- upstairs lounge: a proper bar -------------------------------------- */
  {
    const g = new THREE.Group(); g.position.set(0, F2, -8.4); lobby.add(g);
    B(9.0, 2.6, 0.14, slatMat(9.0), 0, F2 + 1.3, -9.1, false);
    box(6.4, 1.12, 1.1, slatMat(6.4), 0, 0.56, 0, g);
    box(6.9, 0.16, 1.5, capM, 0, 1.2, 0, g).castShadow = false;
    for (let i = 0; i < 3; i++) { const sh = box(4.6, 0.1, 0.44, capM, 0, 1.7 + i * 0.55, -0.62, g); sh.castShadow = false; }
    const bottleC = [0x6fd0c8, 0xffd36e, 0xff8bc4, 0x9ef5a0, 0x8ad4ff, 0xe5484d];
    for (let i = 0; i < 15; i++) { const c = bottleC[i % 6]; const bx = -2.1 + (i % 5) * 1.05, by = 1.75 + Math.floor(i / 5) * 0.55; cyl(0.055, 0.08, 0.34, mat(c, { emissive: c, emissiveIntensity: 0.12 }), bx, by + 0.17, -0.62, g, 7).castShadow = false; }
    for (let i = 0; i < 4; i++) { const st = new THREE.Group(); st.position.set(-2.4 + i * 1.6, 0, 1.4); g.add(st); cyl(0.32, 0.3, 0.13, mat(0xcf8a4e), 0, 0.9, 0, st, 10); cyl(0.08, 0.1, 0.9, mat(0x6e6e72), 0, 0.45, 0, st, 8); cyl(0.26, 0.26, 0.05, mat(0x6e6e72), 0, 0.03, 0, st, 10).castShadow = false; }
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 0.1), new THREE.MeshBasicMaterial({ color: 0xffd9a0 })); gl.position.set(0, 1.62, -0.38); g.add(gl);
  }
  makeShelf(lobby, -11.6, F2, 8.6, Math.PI / 2, 2.2, 2.4);
  makeBench(lobby, 10.6, F2, 8.4, -Math.PI / 2, 2.4);
  for (const [hx, hz] of [[-9, -6], [9, -6], [-9, 6]]) {                                  // hanging planters under the lounge ceiling
    const g = new THREE.Group(); g.position.set(hx, F2 + F2H - 1.55, hz); lobby.add(g);
    for (const [ax, az] of [[-0.26, -0.26], [0.26, -0.26], [-0.26, 0.26], [0.26, 0.26]]) lobby.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(hx + ax, F2 + F2H - 0.18, hz + az), new THREE.Vector3(hx, F2 + F2H - 1.32, hz)]), new THREE.LineBasicMaterial({ color: 0x8a7048 })));
    makePlantPot(g, 0, 0, 0, 0.7, 0xc98a5b, AMBIENT);
  }

  /* ---------- dust drifting through the window light ----------------------------- */
  {
    const N = 240, pts = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pts[i * 3] = (Math.random() - .5) * 26; pts[i * 3 + 1] = 0.4 + Math.random() * 4.2; pts[i * 3 + 2] = (Math.random() - .5) * 26; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const motes = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfff4d8, size: 0.045, transparent: true, opacity: 0.5, depthWrite: false }));
    lobby.add(motes);
    AMBIENT.push({ update(t, dt) {
      const a = geo.attributes.position.array;
      for (let i = 0; i < N; i++) { a[i * 3] += Math.sin(t * 0.4 + i) * 0.14 * dt; a[i * 3 + 1] += (0.1 + Math.sin(t * 0.7 + i * 2.1) * 0.14) * dt; a[i * 3 + 2] += Math.cos(t * 0.35 + i * 1.7) * 0.14 * dt; if (a[i * 3 + 1] > 4.7) a[i * 3 + 1] = 0.3; }
      geo.attributes.position.needsUpdate = true;
      motes.visible = indoors(P.pos.x, P.pos.z) && P.pos.y < F2 - 1;
    } });
  }

  /* ---------- butterflies over the planters -------------------------------------- */
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group(); lobby.add(g);
    const c = [0xffd36e, 0xff8bc4, 0x8ad4ff, 0xffffff][i % 4];
    const wm = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
    const wL = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.15), wm), wR = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.15), wm);
    wL.position.x = -0.1; wR.position.x = 0.1; g.add(wL); g.add(wR);
    const cx = [-10.2, 10.2, -28, 24, -24, 0][i], cz = [-14.2, -14.2, -12.2, -10.2, -19, -16][i];
    const rad = 1.2 + Math.random() * 1.4, sp = 0.5 + Math.random() * 0.4, ph = Math.random() * 6;
    AMBIENT.push({ update(t) {
      const a = t * sp + ph;
      g.position.set(cx + Math.cos(a) * rad, 1.1 + Math.sin(t * 1.7 + ph) * 0.45, cz + Math.sin(a * 1.3) * rad);
      g.rotation.y = -a; const f = Math.sin(t * 16 + ph) * 1.1; wL.rotation.y = f; wR.rotation.y = -f;
    } });
  }
}
/* ---- static scenery merge: thousands of little boxes become a few dozen meshes ----
   Every wall, tread, plant and prop is its own Mesh (one draw call each, ~4,000 per frame for the lobby).
   After boot we run the ambient animators forward a few fake seconds, note which meshes (and which
   materials) changed, and fold everything that did NOT change into one mesh per material signature.
   Animated things, rigs, pads and anything flagged noMerge keep their own meshes. The originals stay
   alive off-scene so camera colliders (which raycast them) still work. */
function matSig(m) {
  if (m.userData.solo) return 'solo:' + m.uuid;
  return [m.type, m.color ? m.color.getHex() : '', m.map ? m.map.uuid : '', m.emissive ? m.emissive.getHex() : '', m.emissiveIntensity, m.emissiveMap ? m.emissiveMap.uuid : '', m.roughness, m.metalness, m.transparent, m.opacity, m.side, m.flatShading, m.blending, m.depthWrite, m.depthTest, m.alphaTest, m.normalMap ? m.normalMap.uuid : '', m.roughnessMap ? m.roughnessMap.uuid : '', m.envMapIntensity, m.vertexColors, m.uniforms ? 'shader' + m.uuid : '', m.fog].join('|');
}
function matState(m) { return [m.color ? m.color.getHex() : 0, m.opacity, m.emissiveIntensity, m.visible, m.emissive ? m.emissive.getHex() : 0].join(','); }
function mergeStatic(root, animators, label, quiet = false) {
  root.updateMatrixWorld(true);
  const skip = new Set(); root.traverse(o => { if (o.userData.noMerge) o.traverse(c => skip.add(c)); });
  const all = []; root.traverse(o => { if (o !== root) all.push(o); });
  const m0 = new Map(all.map(o => [o, o.matrixWorld.clone()]));
  const cand = all.filter(o => o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !skip.has(o) && !Array.isArray(o.material) && o.visible && o.geometry.attributes.position && o.geometry.attributes.normal);
  const s0 = new Map(cand.map(o => [o, matState(o.material)]));
  const t0 = performance.now() / 1000 + 1000;                              // fake time, well away from anything the animators have seen
  m0.set(root, root.matrixWorld.clone());
  const rel = (anc, o, map) => new THREE.Matrix4().copy(map.get(anc)).invert().multiply(map.get(o));
  const nearEq = (a, b) => { const x = a.elements, y = b.elements; for (let i = 0; i < 16; i++) if (Math.abs(x[i] - y[i]) > 1e-4) return false; return true; };   // float slack: a rotated parent changes every descendant's world matrix by rounding
  // a mesh merges into the HIGHEST ancestor it stays rigid with across EVERY sampled frame: static props go to
  // the root, a palm's leaves go to its swaying crown (so the crown becomes a few meshes that still sway), a
  // limb goes to its joint, and a part that moves on its own relative to everything stays as it is.
  // (Comparing only first and last frame once let a forearm merge into the shoulder because the elbow happened
  // to be straight in both: hands ended up detached from arms.)
  const rel0 = new Map(); for (const o of cand) { const chain = []; for (let p = o.parent; p; p = p === root ? null : p.parent) chain.push([p, rel(p, o, m0)]); rel0.set(o, chain); }
  const broken = new Map();                                                 // mesh -> Set of ancestors it is NOT rigid with
  const now = new Map(all.map(o => [o, o.matrixWorld])); now.set(root, root.matrixWorld);
  const scan = () => { root.updateMatrixWorld(true); for (const o of cand) { const chain = rel0.get(o); let b = broken.get(o); for (const [p, r0] of chain) { if (b && b.has(p)) continue; if (!nearEq(r0, rel(p, o, now))) { if (!b) { b = new Set(); broken.set(o, b); } b.add(p); } } } };
  for (let i = 1; i <= 8; i++) { for (const a of animators) { try { a.update(t0 + i * 0.41, 0.41); } catch (e) { } } scan(); }
  const anchorOf = o => { let best = null; const b = broken.get(o); for (let p = o.parent; p; p = p === root ? null : p.parent) { if (b && b.has(p)) break; best = p; } return best; };
  const groups = new Map(); let kept = 0;
  for (const o of cand) {
    const anc = anchorOf(o);
    if (!anc || matState(o.material) !== s0.get(o) || !o.visible) { kept++; continue; }   // moves on its own (or its material animates): keep it
    const wp = anc === root ? new THREE.Vector3().setFromMatrixPosition(o.matrixWorld) : null; const cell = wp ? Math.floor(wp.x / 30) + ',' + Math.floor(wp.z / 30) : '';   // root-anchored props merge per 30 m cell, so the frustum can cull whole chunks
    const key = anc.uuid + '#' + cell + '#' + matSig(o.material) + '#' + Object.keys(o.geometry.attributes).sort().join(',');
    let grp = groups.get(key); if (!grp) { grp = { anc, mat: o.material, items: [], cast: false, recv: false }; groups.set(key, grp); }
    grp.items.push(o); grp.cast = grp.cast || o.castShadow; grp.recv = grp.recv || o.receiveShadow;
  }
  const nm = new THREE.Matrix3(); const M = new THREE.Matrix4(); const v = new THREE.Vector3(); let merged = 0, out = 0;
  for (const grp of groups.values()) {
    if (grp.items.length < 2) { kept += grp.items.length; continue; }
    const inv = new THREE.Matrix4().copy(grp.anc.matrixWorld).invert();
    const names = Object.keys(grp.items[0].geometry.attributes); const sizes = {}; let nv = 0, ni = 0;
    for (const o of grp.items) { const g = o.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    for (const n of names) sizes[n] = grp.items[0].geometry.attributes[n].itemSize;
    const bufs = {}; for (const n of names) bufs[n] = new Float32Array(nv * sizes[n]); const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const o of grp.items) {
      const g = o.geometry; M.multiplyMatrices(inv, o.matrixWorld); nm.getNormalMatrix(M); const cnt = g.attributes.position.count;
      for (const n of names) {
        const src = g.attributes[n], dst = bufs[n], sz = sizes[n];
        if (n === 'position') for (let k = 0; k < cnt; k++) { v.fromBufferAttribute(src, k).applyMatrix4(M); dst[(vo + k) * 3] = v.x; dst[(vo + k) * 3 + 1] = v.y; dst[(vo + k) * 3 + 2] = v.z; }
        else if (n === 'normal') for (let k = 0; k < cnt; k++) { v.fromBufferAttribute(src, k).applyMatrix3(nm).normalize(); dst[(vo + k) * 3] = v.x; dst[(vo + k) * 3 + 1] = v.y; dst[(vo + k) * 3 + 2] = v.z; }
        else for (let k = 0; k < cnt * sz; k++) dst[vo * sz + k] = src.array[k];
      }
      if (g.index) { const ia = g.index.array; for (let k = 0; k < ia.length; k++) idx[io + k] = ia[k] + vo; io += ia.length; }
      else { for (let k = 0; k < cnt; k++) idx[io + k] = vo + k; io += cnt; }
      vo += cnt; o.parent.remove(o); merged++;
    }
    const geo = new THREE.BufferGeometry(); for (const n of names) geo.setAttribute(n, new THREE.BufferAttribute(bufs[n], sizes[n])); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mesh = new THREE.Mesh(geo, grp.mat); mesh.castShadow = grp.cast; mesh.receiveShadow = grp.recv; mesh.userData.merged = grp.items.length; grp.anc.add(mesh); out++;
  }
  if (!quiet) console.log(`[merge] ${label}: ${merged} of ${cand.length} meshes folded into ${out} (${kept} kept as they are)`);
}
function updateAmbient(t, dt) { updateWind(); for (const a of AMBIENT) a.update(t, dt); }
const BLOCKED = [];   // footprints players cannot enter (huts)
const inRect = (r, x, z) => x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2;
function regionH(r, x, z) { if (!r.ramp) return r.y || 0; const t = clamp(r.ramp === 'x' ? (x - r.x1) / (r.x2 - r.x1) : (z - r.z1) / (r.z2 - r.z1), 0, 1); return r.h0 + (r.h1 - r.h0) * t; }   // floor height of a region at a point (ramps slope)
function walkable(x, z, y = 0, air = false) {   // a floor within a step of you; in the air anything below; on the ground you may also step down into an 'open' region (the room under the stairs / the stairs), never through a wall
  if (BLOCKED.some(b => inRect(b, x, z) && (!b.under || y < regionH(b.under, x, z) - 0.8))) return false;   // (under a staircase: blocked unless you are on it)
  return WALK.some(r => { if (!inRect(r, x, z)) return false; const h = regionH(r, x, z); return air ? h <= y + 0.8 : (Math.abs(h - y) <= 0.8 || (h < y && r.open)); });
}
function ceilingY(x, z, y) {   // lobby: the ceiling over you - rooms are 5 m, the lounge and the stairwell are open up to the lounge ceiling
  if (!indoors(x, z)) return Infinity;
  if (y >= F2 - 0.8 || inRect(STAIRWELL, x, z)) return F2 + F2H;
  return 5;
}
function groundHeight(x, z, y) { let g = -Infinity; for (const r of WALK) if (inRect(r, x, z)) { const h = regionH(r, x, z); if (h <= y + 0.8 && h > g) g = h; } return g === -Infinity ? 0 : g; }   // the highest floor under you
function indoors(x, z) { for (let i = 0; i < INDOOR_COUNT; i++) { const r = WALK[i]; if (x >= r.x1 && x <= r.x2 && z >= r.z1 && z <= r.z2) return true; } return false; }

/* ---- shared net builder (x,z = center, yaw 0 = net across X) ---- */
let NET_TEX = null;
function buildNet(parent, x, z, yaw, half, antX) {
  NET_TEX = NET_TEX || canvasTex(512, 128, (g, W, H) => { g.clearRect(0, 0, W, H); g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2; for (let xx = 0; xx < W; xx += 12) { g.beginPath(); g.moveTo(xx, 0); g.lineTo(xx, H); g.stroke(); } for (let y = 0; y < H; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } }, [4, 1]);
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw; parent.add(g);
  const postM = mat(0xd0d0d0);
  box(0.14, 2.6, 0.14, postM, -half, 1.3, 0, g); box(0.14, 2.6, 0.14, postM, half, 1.3, 0, g);
  const net = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 1.5), new THREE.MeshBasicMaterial({ map: NET_TEX, transparent: true, side: THREE.DoubleSide })); NET_TEX.wrapS = NET_TEX.wrapT = THREE.RepeatWrapping; NET_TEX.repeat.set(1, 1.5); net.position.set(0, NET_H - 0.75, 0); g.add(net);
  box(half * 2, 0.08, 0.02, mat(0xffffff), 0, NET_H, 0, g); box(half * 2, 0.05, 0.02, mat(0xffffff), 0, NET_H - 1.5, 0, g);   // the net hangs 1.5 m below the tape
  for (const ax of [-(half - 0.3), half - 0.3]) for (let i = 0; i < 5; i++) box(0.06, 0.36, 0.06, mat(i % 2 ? 0xffffff : 0xe23b3b), ax, NET_H - 0.6 + i * 0.36 + 0.18, 0, g);
  const under = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, Math.max(0.05, NET_H - 1.5)), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false })); under.position.set(0, (NET_H - 1.5) / 2, 0); g.add(under);   // (nothing passes under a net: the ball collides with the whole plane below the tape, see ballNets)
  return g;
}
/* ---- score effects (play where a ball you hit lands in on the other side) ---- */
const FX_LIST = [];
let ULTRA = false;                                 // Graphics = Ultra low: no effects, no animated scenery, classic ball for everyone (set by applyQuality)
/* Effect lights come from a fixed pool that always sits in the scene (intensity 0 when idle). Adding or removing a real light
   changes the scene's light count, which makes three.js rebuild every material's shader - that was the hitch on the first
   score effect (and every one after, since the old programs get released). A constant light count means no rebuilds. */
const FX_LIGHT_POOL = [];
function initFxLights() { for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffffff, 0, 10, 1); l.position.set(0, -50, 0); scene.add(l); FX_LIGHT_POOL.push(l); } }
function fxLight(g, y, color, intensity, distance, decay = 1) {   // borrow a pooled light for effect group g (placed at g's position + y); returned to the pool when the effect ends
  let l = FX_LIGHT_POOL.find(x => !x.userData.busy);
  if (!l) l = new THREE.PointLight(color, 0, 1);                                   // pool exhausted: a dummy that is not in the scene (no visual, no rebuild)
  else l.userData.busy = true;
  l.color.setHex(color); l.intensity = intensity; l.distance = distance; l.decay = decay; l.position.set(g.position.x, g.position.y + y, g.position.z);
  g.userData.fxLight = l; return l;
}
function releaseFxLight(g) { const l = g.userData.fxLight; if (!l) return; l.intensity = 0; l.userData.busy = false; l.position.set(0, -50, 0); g.userData.fxLight = null; }
function heartGeo() {
  const sh = new THREE.Shape(); sh.moveTo(0, 0.35); sh.bezierCurveTo(0, 0.6, -0.5, 0.6, -0.5, 0.25); sh.bezierCurveTo(-0.5, 0.0, 0, -0.15, 0, -0.45); sh.bezierCurveTo(0, -0.15, 0.5, 0.0, 0.5, 0.25); sh.bezierCurveTo(0.5, 0.6, 0, 0.6, 0, 0.35);
  return new THREE.ExtrudeGeometry(sh, { depth: 0.18, bevelEnabled: false });
}
function fxPreview(id) {
  if (id === 'heart') { const m = new THREE.Mesh(heartGeo(), mat(0xff3d8a, { emissive: 0xff2d7a, emissiveIntensity: .6 })); m.position.set(0, 0.6, 0); m.scale.setScalar(1.3); return m; }
  if (id === 'confetti') { const g = new THREE.Group(); const cols = [0xffee33, 0xff3fbf, 0xff8c1a, 0x3eff6a, 0x2ee6ff]; for (let i = 0; i < 40; i++) { const c = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), SOLID(cols[i % 5], 1)); c.position.set((Math.random() - .5) * 2.2, 0.2 + Math.random() * 1.8, (Math.random() - .5) * 1.2); c.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); g.add(c); } return g; }
  if (id === 'hammock') { const g = buildHammock('boy'); g.scale.setScalar(0.42); g.position.y = 0.1; return g; }
  if (id === 'smite') { const g = new THREE.Group(); const pts = [0.3, -0.25, 0.2, -0.3, 0.1]; let y = 2.2; for (let i = 0; i < 5; i++) { const seg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.12), new THREE.MeshBasicMaterial({ color: 0xfff176 })); seg.position.set(pts[i], y, 0); seg.rotation.z = (i % 2 ? -1 : 1) * 0.5; g.add(seg); y -= 0.45; } const fl = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffe066 })); fl.position.y = 0.3; g.add(fl); return g; }
  if (id === 'timestop') { const g = buildClock(); g.scale.setScalar(0.32); g.position.y = 0.55; g.rotation.x = -0.35; return g; }
  if (id === 'blackhole') {
    const g = new THREE.Group(); const R = 0.42;
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(R * 9, R * 9), ADD_TEX(accretionTex(), 1));
    disc.position.y = 0.85; disc.rotation.set(-Math.PI / 2 + 0.5, 0, 0.2); g.add(disc);
    const s = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 14), new THREE.MeshBasicMaterial({ color: 0x000000 })); s.position.y = 0.85; g.add(s);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(R * 3, R * 3), ADD_TEX(photonTex(), 1)); ring.position.set(0, 0.85, 0.02); g.add(ring);
    return g;
  }
  return null;
}
const ADD = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
const SOLID = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
function playScoreFx(id, x, z, model = 'boy') {
  if (ULTRA && !FX_WARMING) return;
  if (id !== 'hammock' && typeof impactFrame === 'function') impactFrame(x, z, id === 'blackhole' || id === 'smite' ? 2 : 1);
  if (id === 'heart') {
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
    const heart = new THREE.Mesh(heartGeo(), mat(0xff3d8a, { emissive: 0xff2d7a, emissiveIntensity: .8, transparent: true })); heart.position.y = 0.6; g.add(heart);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), ADD(0xff4fa0, 0.25)); glow.position.y = 0.9; g.add(glow);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.06, 8, 40), ADD(0xff8ad0, 0.9)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
    const light = fxLight(g, 1, 0xff4fa0, 2, 10);
    const sparkM = SOLID(0xffd6ec, 1), pinkM = SOLID(0xff7ac8, 1), magM = SOLID(0xff2d9a, 1); const parts = [];
    for (let i = 0; i < 70; i++) {                               // burst sparkles
      const m = [sparkM, pinkM, magM][i % 3]; const p = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), m);
      const a = Math.random() * Math.PI * 2, sp = 2.5 + Math.random() * 4; p.userData.v = new THREE.Vector3(Math.cos(a) * sp, 3.5 + Math.random() * 4.5, Math.sin(a) * sp); p.userData.spin = (Math.random() - .5) * 12;
      p.position.set(0, 0.4, 0); g.add(p); parts.push(p);
    }
    const minis = []; const mg = heartGeo();
    for (let i = 0; i < 12; i++) { const mh = new THREE.Mesh(mg, mat(0xff5aa8, { emissive: 0xff2d7a, emissiveIntensity: .8, transparent: true })); mh.scale.setScalar(0.28); const a = i / 12 * Math.PI * 2; mh.userData.a = a; mh.userData.r = 0.9 + Math.random() * 0.6; mh.userData.h = Math.random(); g.add(mh); minis.push(mh); }
    FX_LIST.push({ g, t: 0, dur: 2.4, update(dt) {
      this.t += dt; const k = this.t / this.dur; const fade = 1 - Math.max(0, k - 0.65) / 0.35;
      heart.position.y = 0.6 + this.t * 1.3; heart.rotation.y += dt * 3; heart.scale.setScalar(1.3 + Math.sin(this.t * 12) * 0.14); heart.material.opacity = fade;
      glow.position.y = heart.position.y + 0.3; glow.scale.setScalar(1 + Math.sin(this.t * 10) * 0.15); glow.material.opacity = 0.25 * fade;
      ring.scale.setScalar(1 + this.t * 5); ring.material.opacity = Math.max(0, 0.9 - this.t * 1.2);
      light.intensity = 2.5 * fade;
      for (const p of parts) { p.userData.v.y -= 7 * dt; p.position.addScaledVector(p.userData.v, dt); p.rotation.z += p.userData.spin * dt; p.lookAt(camera.position); p.material.opacity = fade; }
      for (const mh of minis) { mh.userData.a += dt * 2.2; mh.position.set(Math.cos(mh.userData.a) * mh.userData.r, 0.3 + this.t * (1.2 + mh.userData.h), Math.sin(mh.userData.a) * mh.userData.r); mh.rotation.y += dt * 4; mh.material.opacity = fade; }
    } });
  } else if (id === 'timestop') { playTimeStop(x, z);
  } else if (id === 'hammock') { playHammock(x, z, model);
  } else if (id === 'confetti') { playConfetti(x, z);
  } else if (id === 'smite') { playSmite(x, z);
  } else if (id === 'blackhole') { playBlackHole(x, z);
  }
}
function buildHammock(model) {                  // two palms, a striped hammock and the scorer lying in it
  const g = new THREE.Group();
  const trunkM = mat(0xa9764f), leafM = mat(0x4fae5b), ropeM = mat(0xe8d9a8);
  const palm = (x) => { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 4.2, 7), trunkM); t.position.set(x, 2.1, 0); g.add(t); for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.07, 0.6), leafM); leaf.position.set(x + Math.cos(a) * 1.05, 4.05, Math.sin(a) * 1.05); leaf.rotation.y = -a; leaf.rotation.z = 0.4; g.add(leaf); } for (const [dx, dz] of [[0.2, 0.2], [-0.2, 0.1], [0.05, -0.25]]) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), mat(0x6b4a2a)); c.position.set(x + dx, 3.85, dz); g.add(c); } };
  palm(-2.3); palm(2.3);
  const clothTex = canvasTex(256, 64, (gg, w, h) => { for (let i = 0; i < 8; i++) { gg.fillStyle = i % 2 ? '#e5484d' : '#f7f2ea'; gg.fillRect(i * 32, 0, 32, h); } });
  const geo = new THREE.PlaneGeometry(3.6, 1.3, 24, 4); const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) { const px = pos.getX(i), pz = pos.getY(i); pos.setY(i, -0.55 * (1 - (px / 1.8) * (px / 1.8)) + 0.12 * (pz / 0.65) * (pz / 0.65)); pos.setZ(i, pz); }
  geo.computeVertexNormals();
  const cloth = new THREE.Mesh(geo, mat(0xffffff, { map: clothTex, side: THREE.DoubleSide })); cloth.position.y = 1.55; g.add(cloth);
  for (const sx of [-1, 1]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 5), ropeM); r.position.set(sx * 2.05, 1.62, 0); r.rotation.z = sx * 1.25; g.add(r); const knot = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 6, 12), ropeM); knot.position.set(sx * 2.3, 1.75, 0); knot.rotation.y = Math.PI / 2; g.add(knot); }
  const lay = new THREE.Group(); lay.position.set(0, 1.12, 0); lay.rotation.z = -Math.PI / 2; g.add(lay);
  const rig = new Rig('white', model); rig.root.rotation.y = -Math.PI / 2; rig.root.position.set(-0.75, 0, 0); lay.add(rig.root);
  rig.setPose('idle'); for (const k in rig.j) { const p = { shL: [-150, 0, 40], shR: [-150, 0, -40], elL: [-125, 0, 0], elR: [-125, 0, 0], hipL: [8, 0, 6], hipR: [-4, 0, -6], knL: [12, 0, 0], knR: [4, 0, 0], neck: [-25, 0, 0], spine: [-6, 0, 0] }[k] || [0, 0, 0]; rig.cur[k].set(p[0] * D, p[1] * D, p[2] * D); rig.j[k].rotation.set(rig.cur[k].x, rig.cur[k].y, rig.cur[k].z); }
  g.userData.rig = rig; g.userData.cloth = cloth; g.userData.lay = lay;
  return g;
}
/* =====================================================================
   BLACK HOLE
   Built from what a real one actually looks like rather than a ball with hoops round it:
   a black event horizon, a bright photon ring hugging its edge, a hot accretion disc seen
   nearly edge-on, the far side of that disc lensed up over the top, relativistic beaming
   making the approaching limb brighter, polar jets, and matter stretching as it spirals in.
   ===================================================================== */
let ACC_TEX = null, PHOTON_TEX = null, RIFT_TEX = null;
function accretionTex() {
  if (ACC_TEX) return ACC_TEX;
  return ACC_TEX = canvasTex(512, 512, (g, W, H) => {
    const cx = W / 2, cy = H / 2, inner = W * 0.155, outer = W * 0.49;
    g.clearRect(0, 0, W, H);
    const gr = g.createRadialGradient(cx, cy, inner, cx, cy, outer);   // inner edge is the hottest part of the gas
    gr.addColorStop(0.00, 'rgba(255,253,242,1)');
    gr.addColorStop(0.05, 'rgba(226,196,255,0.95)');
    gr.addColorStop(0.18, 'rgba(176,110,255,0.88)');
    gr.addColorStop(0.40, 'rgba(150,70,255,0.64)');
    gr.addColorStop(0.64, 'rgba(96,30,190,0.32)');
    gr.addColorStop(0.86, 'rgba(46,12,96,0.11)');
    gr.addColorStop(1.00, 'rgba(18,4,40,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, outer, 0, TAU); g.fill();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 260; i++) {                                    // turbulent filaments, denser and hotter further in
      const r = inner + Math.pow(Math.random(), 1.7) * (outer - inner);
      const a0 = Math.random() * TAU, span = 0.2 + Math.random() * 1.3;
      const k = 1 - (r - inner) / (outer - inner);
      g.strokeStyle = 'rgba(255,' + Math.round(148 + 92 * k) + ',' + Math.round(56 + 124 * k * k) + ',' + (0.04 + 0.2 * k).toFixed(3) + ')';
      g.lineWidth = 1 + Math.random() * 3.5;
      g.beginPath(); g.arc(cx, cy, r, a0, a0 + span); g.stroke();
    }
    const beam = g.createLinearGradient(0, 0, W, 0);                   // Doppler beaming: the limb coming toward you is brighter
    beam.addColorStop(0.0, 'rgba(255,244,214,0.34)'); beam.addColorStop(0.45, 'rgba(255,198,132,0.06)'); beam.addColorStop(1.0, 'rgba(0,0,0,0)');
    g.fillStyle = beam; g.beginPath(); g.arc(cx, cy, outer, 0, TAU); g.fill();
    g.globalCompositeOperation = 'destination-out';                    // punch the hole the horizon sits in
    const hole = g.createRadialGradient(cx, cy, inner * 0.5, cx, cy, inner * 1.06);
    hole.addColorStop(0, 'rgba(0,0,0,1)'); hole.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hole; g.beginPath(); g.arc(cx, cy, inner * 1.1, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
  });
}
function photonTex() {
  if (PHOTON_TEX) return PHOTON_TEX;
  return PHOTON_TEX = canvasTex(256, 256, (g, W, H) => {
    const cx = W / 2, cy = H / 2;
    g.clearRect(0, 0, W, H);
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, W * 0.5);
    gr.addColorStop(0.00, 'rgba(200,150,255,0)');
    gr.addColorStop(0.56, 'rgba(200,150,255,0)');
    gr.addColorStop(0.65, 'rgba(226,200,255,0.75)');
    gr.addColorStop(0.705, 'rgba(250,244,255,1)');
    gr.addColorStop(0.76, 'rgba(206,160,255,0.6)');
    gr.addColorStop(0.90, 'rgba(150,80,255,0.12)');
    gr.addColorStop(1.00, 'rgba(120,60,230,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, W * 0.5, 0, TAU); g.fill();
  });
}
function riftTex() {
  if (RIFT_TEX) return RIFT_TEX;
  return RIFT_TEX = canvasTex(256, 256, (g, W, H) => {
    const cx = W / 2, cy = H / 2;
    g.clearRect(0, 0, W, H);
    const gr = g.createRadialGradient(cx, cy, W * 0.05, cx, cy, W * 0.5);
    gr.addColorStop(0, 'rgba(0,0,0,0.95)'); gr.addColorStop(0.55, 'rgba(18,4,30,0.6)'); gr.addColorStop(1, 'rgba(30,8,40,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, W * 0.5, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,150,70,0.5)'; g.lineWidth = 3;           // cracks glowing at the lip of the rift
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * TAU + Math.random() * 0.2; let r = W * 0.1, px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      g.beginPath(); g.moveTo(px, py);
      for (let s = 0; s < 4; s++) { r += W * (0.04 + Math.random() * 0.06); const aa = a + (Math.random() - 0.5) * 0.4; px = cx + Math.cos(aa) * r; py = cy + Math.sin(aa) * r; g.lineTo(px, py); }
      g.stroke();
    }
  });
}
const ADD_TEX = (map, opacity = 1) => new THREE.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
function playBlackHole(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  /* GAMEPLAY CONSTANTS — unchanged from the original effect. updatePlayer reads pull/core to
     decide who gets dragged in, so these three numbers must stay exactly as they were. */
  const PULL = 6.9, CORE_R = 0.9, DUR = 5.5;
  const R = 1.35;                                                      // visual horizon radius
  const core = new THREE.Group(); g.add(core);

  const horizon = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 24), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  core.add(horizon);                                                   // opaque and depth-writing, so it eats the disc behind it

  const TILT = -Math.PI / 2 + 0.52;                                    // steeply inclined, so the disc reads as a ring round the horizon
  const discM = ADD_TEX(accretionTex(), 1);
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(R * 9.2, R * 9.2), discM);
  disc.rotation.set(TILT, 0, 0.22); core.add(disc);
  const disc2 = new THREE.Mesh(new THREE.PlaneGeometry(R * 7.4, R * 7.4), ADD_TEX(accretionTex(), 0.35));
  disc2.rotation.set(TILT + 0.075, 0, -0.1); core.add(disc2);          // a second sheet just off-plane gives the disc thickness

  const photonM = ADD_TEX(photonTex(), 1);
  const photon = new THREE.Mesh(new THREE.PlaneGeometry(R * 3.05, R * 3.05), photonM); core.add(photon);
  const lensM = ADD_TEX(photonTex(), 0.4);
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(R * 5.6, R * 5.6), lensM); core.add(lens);   // light from the far side bent around the hole

  const jetM = new THREE.MeshBasicMaterial({ color: 0xd2a8ff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const jets = [];
  for (const s of [1, -1]) {
    const j = new THREE.Mesh(new THREE.ConeGeometry(R * 0.5, R * 7.5, 14, 1, true), jetM);
    j.position.y = s * R * 3.9; if (s > 0) j.rotation.x = Math.PI;      // narrow at the hole, flaring away from it
    core.add(j); jets.push(j);
  }

  const orbit = new THREE.Group(); orbit.rotation.set(TILT, 0, 0.22); core.add(orbit);   // matter orbits in the disc plane
  const streams = [];
  for (let i = 0; i < 48; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.05), ADD_TEX(null, 0.9));
    m.material.map = null; m.material.color.setHex(i % 3 ? 0xc48cff : 0xf0e4ff);
    m.userData = { a: Math.random() * TAU, r: R * 2 + Math.random() * R * 7, spd: 0.9 + Math.random() * 1.5, w: 0.5 + Math.random() * 0.9 };
    orbit.add(m); streams.push(m);
  }

  const light = fxLight(g, 2.2, 0xa060ff, 4, 30);

  FX_LIST.push({ g, t: 0, dur: DUR, type: 'blackhole', x, z, pull: PULL, core: CORE_R, update(dt) {
    this.t += dt; const t = this.t, k = t / this.dur;
    const rise = 1 - Math.pow(1 - Math.min(1, t / 1.1), 3);
    const collapse = k > 0.82 ? Math.max(0, 1 - (k - 0.82) / 0.18) : 1;
    const scale = rise * collapse;
    core.position.y = 0.6 + rise * 2.3; core.scale.setScalar(scale);
    disc.rotation.z += dt * 0.9; disc2.rotation.z -= dt * 1.25;         // the disc shears against itself
    photon.scale.setScalar(1 + Math.sin(t * 11) * 0.012);
    photon.lookAt(camera.position); lens.lookAt(camera.position);       // both are lensing artefacts: always face the viewer
    lensM.opacity = 0.4 * collapse; photonM.opacity = collapse; discM.opacity = collapse; disc2.material.opacity = 0.35 * collapse;
    for (const j of jets) { j.material.opacity = 0.4 * collapse * (0.7 + Math.sin(t * 7) * 0.3); j.scale.set(1, 1 + Math.sin(t * 3) * 0.06, 1); }
    for (const m of streams) {
      const u = m.userData;
      u.a += dt * u.spd * (1 + 7 / Math.max(0.5, u.r));                 // closer in, faster round
      u.r -= dt * (0.35 + 2.6 / Math.max(0.7, u.r));
      if (u.r < R * 1.02) { u.r = R * 3 + Math.random() * R * 6.5; u.a = Math.random() * TAU; }
      const stretch = clamp(R * 3.2 / u.r, 1, 11);                      // spaghettification: it draws out as it falls
      m.position.set(Math.cos(u.a) * u.r, Math.sin(u.a) * u.r, 0);
      m.rotation.z = u.a + Math.PI / 2;
      m.scale.set(u.w * stretch, 1 + stretch * 0.05, 1);
      m.material.opacity = 0.9 * collapse * clamp((u.r - R) / (R * 1.5), 0.15, 1);
    }
    light.intensity = 4 * rise * collapse * (0.8 + Math.sin(t * 8) * 0.2);
  } });
}
function playHammock(x, z, model) {
  const g = buildHammock(model); g.position.set(x, 0, z); g.rotation.y = -Math.PI / 2; scene.add(g);
  const { cloth, lay } = g.userData; const cy = cloth.position.y, ly = lay.position.y;
  FX_LIST.push({ g, t: 0, dur: 5.0, update(dt) {
    this.t += dt; const t = this.t;
    const rise = 1 - Math.pow(1 - Math.min(1, t / 0.7), 3); const sink = t > 4.2 ? 1 - (t - 4.2) / 0.8 : 1;
    g.position.y = -4.5 * (1 - rise) - 4.5 * (1 - sink);
    const sway = Math.sin(t * 2.2) * 0.06; cloth.position.y = cy + sway; lay.position.y = ly + sway; lay.rotation.x = Math.sin(t * 2.2) * 0.05;
  } });
}
function playConfetti(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const cols = [0xffee33, 0xff3fbf, 0xff8c1a, 0x3eff6a, 0x2ee6ff, 0xfff176, 0xff5ad0];
  const bits = [];
  for (let i = 0; i < 220; i++) {                                   // confetti pieces
    const long = Math.random() < 0.3;
    const c = new THREE.Mesh(new THREE.PlaneGeometry(long ? 0.08 : 0.22, long ? 0.5 : 0.14), SOLID(cols[i % cols.length], 1));
    const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 6;
    c.userData = { v: new THREE.Vector3(Math.cos(a) * sp, 7 + Math.random() * 9, Math.sin(a) * sp), spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8), ph: Math.random() * 6 };
    c.position.set(0, 0.3, 0); c.rotation.set(Math.random() * 3, Math.random() * 3, 0); g.add(c); bits.push(c);
  }
  const ribbons = [];                                               // streamer ribbons arcing out
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2 + Math.random() * 0.5, len = 4 + Math.random() * 5, h = 3 + Math.random() * 4;
    const pts = []; for (let s = 0; s <= 8; s++) { const u = s / 8; pts.push(new THREE.Vector3(Math.cos(a) * len * u + Math.sin(u * 9 + i) * 0.4, 0.4 + Math.sin(u * Math.PI) * h + u * 0.5, Math.sin(a) * len * u + Math.cos(u * 7 + i) * 0.4)); }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.06, 6, false), SOLID(cols[(i + 2) % cols.length], 1)); tube.userData.delay = i * 0.03; tube.scale.setScalar(0.01); g.add(tube); ribbons.push(tube);
  }
  const pop = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), SOLID(0xffffff, 0.9)); pop.position.y = 0.5; g.add(pop);
  FX_LIST.push({ g, t: 0, dur: 3.4, update(dt) {
    this.t += dt; const t = this.t; const fade = 1 - Math.max(0, (t - 2.4) / 1.0);
    pop.scale.setScalar(1 + t * 8); pop.material.opacity = Math.max(0, 0.9 - t * 3);
    for (const c of bits) {
      const u = c.userData; u.v.y -= (u.v.y > 0 ? 14 : 4.5) * dt;    // shoots up fast, flutters down slowly
      if (u.v.y < -1.6) u.v.y = -1.6; u.v.x *= (1 - 1.8 * dt); u.v.z *= (1 - 1.8 * dt);
      c.position.addScaledVector(u.v, dt); c.position.x += Math.sin(t * 6 + u.ph) * dt * 1.2;
      if (c.position.y < 0.03) { c.position.y = 0.03; u.v.set(0, 0, 0); }
      c.rotation.x += u.spin.x * dt; c.rotation.y += u.spin.y * dt; c.rotation.z += u.spin.z * dt; c.material.opacity = fade;
    }
    for (const r of ribbons) { const k = clamp((t - r.userData.delay) / 0.9, 0, 1); r.scale.setScalar(0.01 + k); r.position.y = -k * 0.3 + Math.max(0, t - 1.2) * -1.5; r.material.opacity = fade * (1 - Math.max(0, t - 1.6) / 1.0); }
  } });
}
/* ---- Time Stop: a glowing blue clock face on the floor; its hands sweep round and any ball inside it crawls ---- */
let CLOCK_TEX = null;
function clockTex() {
  if (CLOCK_TEX) return CLOCK_TEX;
  return CLOCK_TEX = canvasTex(1024, 1024, (g, W, H) => {
    const cx = W / 2, cy = H / 2; g.clearRect(0, 0, W, H);
    const ring = (r, w, a) => { g.strokeStyle = `rgba(120,200,255,${a})`; g.lineWidth = w; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); };
    g.fillStyle = 'rgba(40,120,255,0.16)'; g.beginPath(); g.arc(cx, cy, 500, 0, Math.PI * 2); g.fill();
    ring(500, 10, 0.95); ring(470, 3, 0.7); ring(330, 4, 0.8); ring(300, 2, 0.5); ring(150, 3, 0.6); ring(120, 2, 0.4);
    g.strokeStyle = 'rgba(160,220,255,0.9)'; g.lineWidth = 3;                                        // minute ticks
    for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2, L = i % 5 ? 14 : 34; g.lineWidth = i % 5 ? 3 : 7; g.beginPath(); g.moveTo(cx + Math.cos(a) * 470, cy + Math.sin(a) * 470); g.lineTo(cx + Math.cos(a) * (470 - L), cy + Math.sin(a) * (470 - L)); g.stroke(); }
    g.strokeStyle = 'rgba(160,220,255,0.55)'; g.lineWidth = 5; g.setLineDash([26, 14]); g.beginPath(); g.arc(cx, cy, 405, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);   // dashed inner track
    g.fillStyle = '#bfe8ff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 64px Georgia, "Times New Roman", serif';
    const R = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    for (let i = 0; i < 12; i++) { const a = -Math.PI / 2 + i / 12 * Math.PI * 2; g.save(); g.translate(cx + Math.cos(a) * 372, cy + Math.sin(a) * 372); g.rotate(a + Math.PI / 2); g.fillText(R[i], 0, 0); g.restore(); }
    g.shadowColor = 'rgba(120,200,255,0.9)'; g.shadowBlur = 24; ring(500, 6, 0.6); g.shadowBlur = 0;
  });
}
function buildClock() {                          // face + hands, hands stored in userData so the effect can sweep them
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: clockTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  face.rotation.x = -Math.PI / 2; face.position.y = 0.02; g.add(face);
  const base = new THREE.Mesh(new THREE.CircleGeometry(1.0, 64), SOLID(0x0b2f7a, 0.5)); base.rotation.x = -Math.PI / 2; base.position.y = 0.012; g.add(base); g.userData.base = base;   // dark disc so the glow reads blue on bright floors too
  const glow = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.08, 64), ADD(0x3a8cff, 0.35)); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.015; g.add(glow);
  const hand = (len, w, back) => { const h = new THREE.Group(); const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len + back), ADD(0xd8f1ff, 0.95)); m.position.z = -(len - back) / 2; m.rotation.x = -Math.PI / 2; h.add(m); const tip = new THREE.Mesh(new THREE.PlaneGeometry(w * 2.2, w * 2.2), ADD(0xbfe8ff, 0.8)); tip.rotation.x = -Math.PI / 2; tip.position.z = -len * 0.72; h.add(tip); h.position.y = 0.04; g.add(h); return h; };
  const hub = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), ADD(0xffffff, 1)); hub.rotation.x = -Math.PI / 2; hub.position.y = 0.05; g.add(hub);
  g.userData.hour = hand(0.42, 0.06, 0.1); g.userData.minute = hand(0.66, 0.045, 0.12); g.userData.face = face; g.userData.glow = glow;
  return g;
}
const TIMESTOP_R = 3.4, TIMESTOP_SLOW = 0.12;   // clock radius on the floor; balls and players inside move at 12% speed
function playTimeStop(x, z) {
  const g = buildClock(); g.scale.setScalar(TIMESTOP_R); g.position.set(x, 0, z); scene.add(g);
  const light = fxLight(g, 1.2, 0x3a8cff, 4, TIMESTOP_R * 3, 1.5);
  const shards = []; const shardM = ADD(0x9fd4ff, 0.9);
  for (let i = 0; i < 26; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1 + Math.random() * 0.3, 0.05), shardM); const a = Math.random() * Math.PI * 2, r = (0.3 + Math.random() * 0.75); s.position.set(Math.cos(a) * r, Math.random() * 0.4, Math.sin(a) * r); s.userData.vy = 0.05 + Math.random() * 0.12; s.userData.spin = (Math.random() - .5) * 3; s.scale.setScalar(1 / TIMESTOP_R); g.add(s); shards.push(s); }
  const H = g.userData.hour, M = g.userData.minute;
  FX_LIST.push({ g, t: 0, dur: 6, type: 'timestop', x, z, r: TIMESTOP_R, update(dt) {
    this.t += dt; const k = this.t / this.dur; const grow = Math.min(1, this.t / 0.35); const fade = 1 - Math.max(0, k - 0.8) / 0.2;
    g.scale.setScalar(TIMESTOP_R * (0.6 + 0.4 * grow)); this.r = TIMESTOP_R * (0.6 + 0.4 * grow);
    M.rotation.y = -this.t * 5.5; H.rotation.y = -this.t * 5.5 / 12 - 1.2;                                        // hands race round backwards
    const pulse = 0.85 + 0.15 * Math.sin(this.t * 6);
    g.userData.face.material.opacity = grow * fade * pulse; g.userData.base.material.opacity = 0.5 * grow * fade; g.userData.glow.material.opacity = 0.35 * grow * fade * pulse; g.userData.glow.scale.setScalar(1 + 0.04 * Math.sin(this.t * 4));
    light.intensity = 4 * grow * fade * pulse;
    for (const s of shards) { s.position.y += s.userData.vy * dt; s.rotation.y += s.userData.spin * dt; if (s.position.y > 1.2) s.position.y = 0; }
    shardM.opacity = 0.9 * grow * fade;
  } });
}
/* ---- Smite -------------------------------------------------------------------
   Real lightning is a thin white channel inside a wider blue-violet glow, it strikes several
   times in a tenth of a second rather than once, it forks, and it leaves the ground scorched
   and smoking long after the flash is gone. */
let SMOKE_TEX = null;
function smokeTex() {
  if (SMOKE_TEX) return SMOKE_TEX;
  return SMOKE_TEX = canvasTex(128, 128, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) {                                    // a few overlapping soft blobs read as a puff
      const r = W * (0.16 + Math.random() * 0.16), cx = W / 2 + (Math.random() - 0.5) * W * 0.34, cy = H / 2 + (Math.random() - 0.5) * H * 0.34;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    }
  });
}
let SCORCH_TEX = null;
function scorchTex() {
  if (SCORCH_TEX) return SCORCH_TEX;
  return SCORCH_TEX = canvasTex(256, 256, (g, W, H) => {
    const cx = W / 2, cy = H / 2; g.clearRect(0, 0, W, H);
    const gr = g.createRadialGradient(cx, cy, W * 0.03, cx, cy, W * 0.48);
    gr.addColorStop(0, 'rgba(18,11,7,0.94)'); gr.addColorStop(0.42, 'rgba(38,25,15,0.6)'); gr.addColorStop(1, 'rgba(58,40,24,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, W * 0.5, 0, TAU); g.fill();
    for (let i = 0; i < 44; i++) {                                   // burn streaks thrown out from the point of contact
      const a = Math.random() * TAU, r0 = W * 0.05, r1 = W * (0.18 + Math.random() * 0.28);
      g.strokeStyle = 'rgba(14,9,5,' + (0.14 + Math.random() * 0.34).toFixed(2) + ')'; g.lineWidth = 1 + Math.random() * 5;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke();
    }
  });
}
function buildBolt(height, jitter) {
  const grp = new THREE.Group();
  const coreM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const glowM = new THREE.MeshBasicMaterial({ color: 0x9ec6ff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
  const seg = (a, b, w, m) => {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, a.distanceTo(b), w), m);
    s.position.copy(a).add(b).multiplyScalar(0.5); s.lookAt(b); s.rotateX(Math.PI / 2); grp.add(s);
  };
  const path = []; let p = new THREE.Vector3(0, height, 0); path.push(p.clone());
  while (p.y > 0) {
    p = new THREE.Vector3(p.x + (Math.random() - 0.5) * jitter, p.y - (1.1 + Math.random() * 1.7), p.z + (Math.random() - 0.5) * jitter);
    if (p.y < 0) p.y = 0;
    path.push(p.clone());
  }
  for (let i = 0; i < path.length - 1; i++) { seg(path[i], path[i + 1], 0.34, glowM); seg(path[i], path[i + 1], 0.1, coreM); }
  for (let b = 0; b < 3; b++) {                                      // forks peeling off the main channel
    const i = 2 + Math.floor(Math.random() * Math.max(1, path.length - 5));
    let q = path[Math.min(i, path.length - 2)].clone();
    const dir = new THREE.Vector3((Math.random() - 0.5) * 2, -0.55, (Math.random() - 0.5) * 2).normalize();
    for (let s2 = 0; s2 < 3; s2++) {
      const n = q.clone().addScaledVector(dir, 1 + Math.random() * 1.7).add(new THREE.Vector3((Math.random() - 0.5) * 0.9, 0, (Math.random() - 0.5) * 0.9));
      if (n.y < 0.1) n.y = 0.1;
      seg(q, n, 0.17, glowM); seg(q, n, 0.05, coreM); q = n;
    }
  }
  grp.userData.mats = [coreM, glowM];
  return grp;
}
function playSmite(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const bolts = [buildBolt(26, 1.4), buildBolt(26, 2.3), buildBolt(26, 1.0)];
  for (const b of bolts) { b.visible = false; g.add(b); }
  const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), SOLID(0xffffff, 1)); flash.position.y = 0.5; flash.scale.setScalar(0.01); g.add(flash);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), SOLID(0xbcd4ff, 0.6)); glow.position.y = 0.7; glow.scale.setScalar(0.01); g.add(glow);
  const scorch = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: scorchTex(), transparent: true, depthWrite: false, opacity: 0 }));
  scorch.rotation.x = -Math.PI / 2; scorch.position.y = 0.02; g.add(scorch);
  const cracks = [];                                                 // fissures that flare white then cool to orange and go out
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * TAU + Math.random() * 0.3; let cx = 0, cz = 0;
    for (let s = 0; s < 5; s++) {
      const l = 0.8 + Math.random() * 1.2, na = a + (Math.random() - 0.5) * 0.9;
      const nx = cx + Math.cos(na) * l, nz = cz + Math.sin(na) * l;
      const c = new THREE.Mesh(new THREE.PlaneGeometry(l, 0.13 - s * 0.017), SOLID(0xffffff, 1));
      c.rotation.x = -Math.PI / 2; c.rotation.z = -na; c.position.set((cx + nx) / 2, 0.03, (cz + nz) / 2);
      g.add(c); cracks.push(c); cx = nx; cz = nz;
    }
  }
  const embers = [];
  for (let i = 0; i < 54; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), SOLID(i % 3 ? 0xffc06a : 0xffffff, 1));
    const a = Math.random() * TAU, spd = 3 + Math.random() * 8;
    sp.userData.v = new THREE.Vector3(Math.cos(a) * spd, 3 + Math.random() * 8, Math.sin(a) * spd);
    sp.position.y = 0.3; g.add(sp); embers.push(sp);
  }
  const smoke = [];                                                  // the part that outlives the flash
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: smokeTex(), color: 0x6a6258, transparent: true, opacity: 0, depthWrite: false }));
    const a = Math.random() * TAU, r = Math.random() * 1.3;
    s.position.set(Math.cos(a) * r, 0.2 + Math.random() * 0.4, Math.sin(a) * r);
    s.userData = { rise: 0.5 + Math.random() * 0.9, spin: (Math.random() - 0.5) * 0.8, delay: Math.random() * 0.5, drift: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5) };
    g.add(s); smoke.push(s);
  }
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.95, 48), SOLID(0xdce8ff, 0.9));
  shock.rotation.x = -Math.PI / 2; shock.position.y = 0.04; g.add(shock);
  const light = fxLight(g, 2.5, 0xdcebff, 0, 44);
  const STRIKES = [0, 0.075, 0.185, 0.30];                           // a strike is several return strokes in quick succession
  FX_LIST.push({ g, t: 0, dur: 3.4, update(dt) {
    this.t += dt; const t = this.t;
    let lit = 0, which = -1;
    for (let i = 0; i < STRIKES.length; i++) { const d = t - STRIKES[i]; if (d >= 0 && d < 0.055) { lit = 1 - d / 0.055; which = i % bolts.length; } }
    for (let i = 0; i < bolts.length; i++) {
      const on = i === which; bolts[i].visible = on;
      if (on) { const m = bolts[i].userData.mats; m[0].opacity = 0.55 + lit * 0.45; m[1].opacity = 0.25 + lit * 0.45; }
    }
    const e = Math.max(0, t - 0.02), fade = 1 - clamp((t - 1.8) / 1.6, 0, 1);
    flash.scale.setScalar(0.01 + Math.min(1, e / 0.18) * 4.2); flash.material.opacity = Math.max(0, 1 - e / 0.34);
    glow.scale.setScalar(0.01 + Math.min(1, e / 0.45) * 6); glow.material.opacity = 0.6 * Math.max(0, 1 - e / 1.1);
    scorch.material.opacity = Math.min(1, e / 0.15) * (1 - clamp((t - 2.4) / 1.0, 0, 1));
    const heat = Math.max(0, 1 - e / 1.5);                            // cracks cool from white through orange
    for (const c of cracks) { c.material.color.setRGB(1, 0.45 + heat * 0.55, 0.12 + heat * 0.8); c.material.opacity = Math.min(1, e / 0.12) * heat; }
    for (const sp of embers) {
      sp.userData.v.y -= 13 * dt; sp.userData.v.multiplyScalar(1 - 0.9 * dt);
      sp.position.addScaledVector(sp.userData.v, dt);
      if (sp.position.y < 0.05) { sp.position.y = 0.05; sp.userData.v.y *= -0.35; sp.userData.v.x *= 0.6; sp.userData.v.z *= 0.6; }
      sp.material.opacity = fade * Math.max(0, 1 - e / 2.2);
    }
    for (const s of smoke) {
      const u = s.userData, st = e - u.delay;
      if (st <= 0) continue;
      s.position.y += u.rise * dt; s.position.addScaledVector(u.drift, dt);
      s.scale.setScalar(0.6 + st * 0.75); s.rotation.z += u.spin * dt;
      s.lookAt(camera.position);
      s.material.opacity = Math.min(0.5, st * 1.4) * Math.max(0, 1 - st / 2.6);
    }
    shock.scale.setScalar(0.4 + e * 11); shock.material.opacity = Math.max(0, 0.9 - e * 1.5);
    light.intensity = lit > 0 ? 9 + lit * 6 : 5 * Math.max(0, 1 - e / 1.2);
  } });
}
function lightningFx(pos, dir, boltHex = 0xbfe6ff, glowHex = 0x9fd4ff, n = 7) {   // jagged electric bolts + sparks bursting from pos (blue for Double Spike, yellow for Dash)
  if (ULTRA && !FX_WARMING) return;
  const g = new THREE.Group(); g.position.copy(pos); scene.add(g);
  const m = new THREE.MeshBasicMaterial({ color: boltHex, transparent: true, opacity: 1, depthWrite: false });
  const bolts = [];
  for (let i = 0; i < n; i++) {
    const b = new THREE.Group(); g.add(b); bolts.push(b);
    let p = new THREE.Vector3(); const d = new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().addScaledVector(dir, 0.6).normalize();
    for (let k = 0; k < 5; k++) {
      const n = p.clone().addScaledVector(d, 0.28 + Math.random() * 0.2).add(new THREE.Vector3((Math.random() - .5) * 0.25, (Math.random() - .5) * 0.25, (Math.random() - .5) * 0.25));
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.05, n.distanceTo(p), 0.05), m); seg.position.copy(p).add(n).multiplyScalar(0.5); seg.lookAt(n); seg.rotateX(Math.PI / 2); b.add(seg); p = n;
    }
  }
  const light = fxLight(g, 0, glowHex, 6, 8, 2);
  FX_LIST.push({ g, t: 0, dur: 0.4, update(dt) { this.t += dt; const k = this.t / this.dur; const on = Math.floor(this.t * 40) % 3 !== 2; for (const b of bolts) b.visible = on; m.opacity = 1 - k; light.intensity = 6 * (1 - k) * (on ? 1 : 0.4); } });
  sparkle(pos, 18, glowHex, 1.8, 0.9, 0.45, 0.08, dir);
}
/* ---- effect warm-up: play every effect once, far away, on the first frame so shaders and textures are ready before anyone scores ---- */
let FX_WARMING = false;
function warmUpFx(rig) {
  FX_WARMING = true;                                                     // impact frames stay off while this runs
  const X = 4000, Z = 4000; const fwd = new THREE.Vector3(0, 0, 1);
  try {
    const cam0 = new THREE.PerspectiveCamera(60, 1, 0.1, 200); cam0.position.set(X + 6, 4, Z + 12); cam0.lookAt(X, 2, Z); cam0.updateMatrixWorld();
    for (const id of Object.keys(FXS)) { if (id === 'none') continue; playScoreFx(id, X, Z, 'boy'); updateFx(0.05); renderer.render(scene, cam0); for (const f of FX_LIST) { scene.remove(f.g); releaseFxLight(f.g); } FX_LIST.length = 0; }   // one at a time, like in a match
    for (const id of Object.keys(FXS)) if (id !== 'none') playScoreFx(id, X, Z, 'boy');
    lightningFx(new THREE.Vector3(X, 2, Z), fwd); sparkle(new THREE.Vector3(X, 1, Z), 6, 0xffffff, 1, 1);
    jumpFx(X, Z, 0xf3e4bb); landFx(X, Z, 0xf3e4bb); puff(X, Z, 4, 1, 1, 0xf3e4bb);
    if (rig) for (const k of ['set', 'bump', 'block', 'spike']) actionFx(k, rig, fwd);
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 200); cam.position.set(X + 6, 4, Z + 12); cam.lookAt(X, 2, Z); cam.updateMatrixWorld();
    renderer.compile(scene, cam);
    for (let i = 0; i < 3; i++) { updateFx(0.05); renderer.render(scene, cam); }   // a few real frames: compiles the programs and uploads every texture
  } catch (e) { console.warn('fx warm-up', e); }
  for (const f of FX_LIST) { scene.remove(f.g); releaseFxLight(f.g); } FX_LIST.length = 0;
  for (const p of DUST) scene.remove(p); DUST.length = 0;
  FX_WARMING = false;
}
function updateFx(dt) {
  for (let i = FX_LIST.length - 1; i >= 0; i--) { const f = FX_LIST[i]; f.update(dt); if (f.t >= f.dur) { scene.remove(f.g); releaseFxLight(f.g); FX_LIST.splice(i, 1); } }
}
/* ---- movement dust (walking, jumping, landing) ---- */
const DUST = []; let dustMat = null;
const noDustHere = (x, z) => S.scene === 'lobby' && indoors(x, z);
function puff(x, z, n, spread, up, colorHex) {
  if (ULTRA && !FX_WARMING) return;
  if (noDustHere(x, z)) return;
  dustMat = dustMat || new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
  const m = dustMat.clone(); m.color.setHex(colorHex);
  for (let i = 0; i < n; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), m); const a = Math.random() * Math.PI * 2, sp = spread * (0.4 + Math.random());
    p.position.set(x + (Math.random() - .5) * 0.3, 0.05, z + (Math.random() - .5) * 0.3); p.userData.v = new THREE.Vector3(Math.cos(a) * sp, up * (0.5 + Math.random()), Math.sin(a) * sp); p.userData.life = 0.45 + Math.random() * 0.35; p.userData.t = 0;
    scene.add(p); DUST.push(p);
  }
}
function updateDust(dt) {
  for (let i = DUST.length - 1; i >= 0; i--) { const p = DUST[i]; p.userData.t += dt; const k = p.userData.t / p.userData.life; if (k >= 1) { scene.remove(p); DUST.splice(i, 1); continue; } p.userData.v.y -= 4 * dt; p.userData.v.multiplyScalar(1 - 2.5 * dt); p.position.addScaledVector(p.userData.v, dt); if (p.position.y < 0.03) p.position.y = 0.03; p.scale.setScalar(1 + k * 1.5); p.material.opacity = 0.8 * (1 - k); }
}
/* ---- jump / landing effects (separate from the walking puffs) ---- */
function jumpFx(x, z, colorHex) {
  if (ULTRA && !FX_WARMING) return;
  if (noDustHere(x, z)) return;
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.42, 28), new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
  const streaks = [];
  for (let i = 0; i < 10; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4 + Math.random() * 0.4, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false })); const a = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.35; s.position.set(Math.cos(a) * r, 0.2, Math.sin(a) * r); s.userData.vy = 3.5 + Math.random() * 3; g.add(s); streaks.push(s); }
  FX_LIST.push({ g, t: 0, dur: 0.5, update(dt) { this.t += dt; const k = this.t / this.dur; ring.scale.setScalar(1 + k * 3.5); ring.material.opacity = 0.85 * (1 - k); for (const s of streaks) { s.position.y += s.userData.vy * dt; s.userData.vy *= (1 - 3 * dt); s.material.opacity = 0.9 * (1 - k); } } });
}
function landFx(x, z, colorHex) {
  if (ULTRA && !FX_WARMING) return;
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.12, 6, 28), new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9, depthWrite: false })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.06; g.add(ring);
  const chunks = [];
  for (let i = 0; i < 16; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.12), new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.95, depthWrite: false })); const a = i / 16 * Math.PI * 2 + Math.random() * 0.3; c.position.set(Math.cos(a) * 0.3, 0.08, Math.sin(a) * 0.3); c.userData.v = new THREE.Vector3(Math.cos(a) * (2.5 + Math.random() * 2), 1.5 + Math.random() * 2, Math.sin(a) * (2.5 + Math.random() * 2)); c.rotation.set(Math.random(), Math.random(), 0); g.add(c); chunks.push(c); }
  const cloud = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.45, depthWrite: false })); cloud.scale.set(1, 0.35, 1); cloud.position.y = 0.15; g.add(cloud);
  FX_LIST.push({ g, t: 0, dur: 0.7, update(dt) { this.t += dt; const k = this.t / this.dur; ring.scale.set(1 + k * 4, 1 + k * 4, 1); ring.material.opacity = 0.9 * (1 - k); cloud.scale.set(1 + k * 3, 0.35 + k * 0.4, 1 + k * 3); cloud.material.opacity = 0.45 * (1 - k); for (const c of chunks) { c.userData.v.y -= 9 * dt; c.position.addScaledVector(c.userData.v, dt); if (c.position.y < 0.04) { c.position.y = 0.04; c.userData.v.y = 0; c.userData.v.multiplyScalar(0.6); } c.rotation.x += dt * 6; c.material.opacity = 0.95 * (1 - Math.max(0, k - 0.5) * 2); } } });
}
/* ---- action effects: set / bump / spike / block (small, quick, readable) ---- */
function sparkle(pos, n, colorHex, spread, up, dur = 0.45, size = 0.07, dir = null) {
  if (ULTRA && !FX_WARMING) return;
  const g = new THREE.Group(); g.position.copy(pos); scene.add(g); const parts = [];
  const m = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.95, depthWrite: false });
  for (let i = 0; i < n; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), m); const a = Math.random() * Math.PI * 2, sp = spread * (0.3 + Math.random()); p.userData.v = new THREE.Vector3(Math.cos(a) * sp, up * (0.4 + Math.random()), Math.sin(a) * sp); if (dir) p.userData.v.addScaledVector(dir, spread * 1.2); p.rotation.set(Math.random() * 3, Math.random() * 3, 0); g.add(p); parts.push(p); }
  FX_LIST.push({ g, t: 0, dur, update(dt) { this.t += dt; const k = this.t / this.dur; for (const p of parts) { p.position.addScaledVector(p.userData.v, dt); p.userData.v.multiplyScalar(1 - 2 * dt); p.rotation.y += dt * 6; } m.opacity = 0.95 * (1 - k); } });
}
function actionFx(kind, rig, fwd) {                 // kind: set | bump | block | spike | spikeHit
  if (ULTRA && !FX_WARMING) return;
  if (!rig) return;
  const hl = rig.handPos('L'), hr = rig.handPos('R'); const mid = hl.clone().add(hr).multiplyScalar(0.5);
  if (kind === 'set') sparkle(mid, 10, 0xfff3b0, 0.5, 1.6, 0.5, 0.06);                                   // soft golden specks lifting off the fingertips
  else if (kind === 'bump') sparkle(mid, 8, 0xffffff, 0.7, 0.9, 0.35, 0.06, fwd);                        // a quick forward spray off the forearms
  else if (kind === 'block') {                                                                             // a faint wall flash in front of the hands
    const g = new THREE.Group(); g.position.copy(mid).addScaledVector(fwd, 0.25); g.lookAt(g.position.clone().add(fwd)); scene.add(g);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9), new THREE.MeshBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })); g.add(wall);
    FX_LIST.push({ g, t: 0, dur: 0.35, update(dt) { this.t += dt; const k = this.t / this.dur; wall.scale.setScalar(1 + k * 0.4); wall.material.opacity = 0.35 * (1 - k); } });
  } else if (kind === 'spike') {                                                                           // swing trail: three short white arcs at the hitting hand
    const g = new THREE.Group(); g.position.copy(hr); scene.add(g); const arcs = [];
    for (let i = 0; i < 3; i++) { const a = new THREE.Mesh(new THREE.TorusGeometry(0.35 + i * 0.12, 0.025, 6, 20, 1.6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false })); a.rotation.set(0.4, Math.atan2(fwd.x, fwd.z), -0.6 + i * 0.25); g.add(a); arcs.push(a); }
    FX_LIST.push({ g, t: 0, dur: 0.28, update(dt) { this.t += dt; const k = this.t / this.dur; for (const a of arcs) { a.rotation.z -= dt * 6; a.material.opacity = 0.8 * (1 - k); } } });
  } else if (kind === 'spikeHit') sparkle(mid, 12, 0xffffff, 1.4, 0.6, 0.35, 0.07, fwd);                 // impact sparks when the spike connects
}
/* ---- landing marks ---- */
const MARKS = [];
function landingMark(x, z, inCourt) {
  if (ULTRA && !FX_WARMING) return;
  const m = new THREE.Mesh(new THREE.CircleGeometry(BALL_R, 28), new THREE.MeshBasicMaterial({ color: inCourt ? 0x3ecf5a : 0xe5484d, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.03, z); scene.add(m); MARKS.push({ m, t0: performance.now() });
}
function updateMarks() {
  const now = performance.now();
  for (let i = MARKS.length - 1; i >= 0; i--) { const k = MARKS[i]; const a = (now - k.t0) / 2500; if (a >= 1) { scene.remove(k.m); k.m.geometry.dispose(); k.m.material.dispose(); MARKS.splice(i, 1); } else { k.m.material.opacity = 0.95 * (1 - a); } }
}

/* =====================================================================
   COURT
   ===================================================================== */
const court = new THREE.Group();
const GYM_LIGHTS = []; const GYM_PANEL_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff }); const COURT_AMBIENT = [];
function applyGymLights() { const on = isNight; for (const l of GYM_LIGHTS) l.intensity = on ? 0.55 : 0; GYM_PANEL_MAT.color.setHex(on ? 0xffffff : 0xc9ced8); }
function updateCourtAmbient(t, dt) { for (const a of COURT_AMBIENT) a.update(t, dt); }
const NET_H = 2.93, COURT_W = 11.25, COURT_L = 22.5, GYM_X = 27, GYM_Z = 34.5, NET_HALF = 6.5;   // beach court is 1.25x regulation; gym is 1.5x
const INDOOR_SCALE = 1.1;                                                                         // the indoor court is 1.1x the beach court
const COURTS_BY_MAP = {
  indoor: { w: COURT_W * INDOOR_SCALE, l: COURT_L * INDOOR_SCALE, half: NET_HALF * INDOOR_SCALE, nets: [{ cx: 0, cz: 0, nx: 0, nz: 1, half: NET_HALF * INDOOR_SCALE }], courts: [{ cx: 0, cz: 0, hx: COURT_W * INDOOR_SCALE / 2, hz: COURT_L * INDOOR_SCALE / 2 }] },
  beach:  { w: COURT_W, l: COURT_L, half: NET_HALF, nets: [{ cx: 0, cz: 0, nx: 0, nz: 1, half: NET_HALF }], courts: [{ cx: 0, cz: 0, hx: COURT_W / 2, hz: COURT_L / 2 }] },
};
const courtDims = () => COURTS_BY_MAP[(S.match && S.match.map) || 'indoor'];
const MATCH_NETS = COURTS_BY_MAP.indoor.nets, MATCH_COURTS = COURTS_BY_MAP.indoor.courts;
const BEACH_NETS = [], BEACH_COURTS = [];
let scoreTex = null;
const TEAM_NAME = { A: 'BLACK', B: 'WHITE' };
function buildCourt() {
  const floorTex = canvasTex(1024, 1280, (g, w, h) => {
    const s = w / (GYM_X * 2);
    g.fillStyle = '#d8b67e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(0,0,0,${0.03 + (i % 3) * .02})`; g.fillRect(0, i * (h / 60), w, 3); }
    const cx = w / 2, cz = h / 2; g.strokeStyle = '#fff'; g.lineWidth = 6;
    const CW = COURT_W * INDOOR_SCALE, CL = COURT_L * INDOOR_SCALE; const hw = CW / 2, hl = CL / 2;
    g.fillStyle = 'rgba(70,130,200,.28)'; g.fillRect(cx - hw * s, cz - hl * s, CW * s, CL * s);
    g.strokeRect(cx - hw * s, cz - hl * s, CW * s, CL * s);
    for (const zz of [0, -3.75 * INDOOR_SCALE, 3.75 * INDOOR_SCALE]) { g.beginPath(); g.moveTo(cx - hw * s, cz + zz * s); g.lineTo(cx + hw * s, cz + zz * s); g.stroke(); }
  });
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(GYM_X * 2, GYM_Z * 2), mat(0xffffff, { map: floorTex })); fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; court.add(fl);
  const wallM = mat(0xf2f4f7), wallTop = mat(0x5670b5);
  const w = (x, z, sx, sz) => { COLLIDERS.push(box(sx, 6, sz, wallM, x, 3, z, court)); box(sx, 5, sz, wallTop, x, 8.5, z, court); };
  w(0, -GYM_Z, GYM_X * 2, 0.5); w(0, GYM_Z, GYM_X * 2, 0.5); w(-GYM_X, 0, 0.5, GYM_Z * 2); w(GYM_X, 0, 0.5, GYM_Z * 2);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(GYM_X * 2, GYM_Z * 2), mat(0xaeb6c6)); ceil.rotation.x = Math.PI / 2; ceil.position.y = 11; court.add(ceil);
  for (const z of [-27, -18, -9, 0, 9, 18, 27]) for (const x of [-16, -5.5, 5.5, 16]) { const l = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 1.2), GYM_PANEL_MAT); l.position.set(x, 10.9, z); court.add(l); }
  for (const z of [-22, -8, 8, 22]) for (const x of [-11, 11]) { const pl = new THREE.PointLight(0xfff4e0, 0.55, 40, 1.2); pl.position.set(x, 9.5, z); court.add(pl); GYM_LIGHTS.push(pl); }   // gym lights: on at night, off in daylight
  // stands with a cheering crowd on both long sides
  const seatM = mat(0x3f5fc4), stepM = mat(0x33448a);
  for (const sx of [-1, 1]) for (let i = 0; i < 7; i++) { box(1.3, 0.5 + i * 0.55, GYM_Z * 2 - 2, i % 2 ? seatM : stepM, sx * (GYM_X - 1.0 - (6 - i) * 1.3), (0.5 + i * 0.55) / 2, 0, court); }   // lowest row nearest the court, rising toward the wall
  const shirtCols = [0xe5484d, 0x3b8ff0, 0xf5c542, 0x3ecf5a, 0xffffff, 0x222222, 0xff7ac8, 0xff8c1a, 0xa259ff];
  const skinCols = [0xf3d1b0, 0xd9a878, 0x8d5a3a, 0xf7e0c8];
  const bodies = [], heads = [], seats = [];
  for (const sx of [-1, 1]) for (let i = 0; i < 7; i++) for (let z = -GYM_Z + 3; z < GYM_Z - 2; z += 1.35) {
    if (Math.random() < 0.42) continue;                                      // plenty of empty seats (keeps the crowd cheap)
    const x = sx * (GYM_X - 1.0 - (6 - i) * 1.3), y = 0.5 + i * 0.55;
    seats.push({ x, y, z, ph: Math.random() * 6, spd: 1.4 + Math.random() * 1.2, sx });
  }
  const bodyGeo = roundedBoxGeo(0.48, 0.62, 0.36, 0.1, 1), headGeo = roundedBoxGeo(0.32, 0.32, 0.32, 0.09, 1), armGeo = roundedBoxGeo(0.12, 0.5, 0.12, 0.05, 1);   // k=1: the crowd is small and far, one fillet segment reads fine
  const bodyIM = new THREE.InstancedMesh(bodyGeo, mat(0xffffff), seats.length), headIM = new THREE.InstancedMesh(headGeo, mat(0xffffff), seats.length), armIM = new THREE.InstancedMesh(armGeo, mat(0xffffff), seats.length * 2);
  const tmp = new THREE.Object3D(); const col = new THREE.Color();
  seats.forEach((s, k) => { bodyIM.setColorAt(k, col.setHex(shirtCols[k % shirtCols.length])); const sk = skinCols[k % skinCols.length]; headIM.setColorAt(k, col.setHex(sk)); armIM.setColorAt(k * 2, col.setHex(sk)); armIM.setColorAt(k * 2 + 1, col.setHex(sk)); });
  court.add(bodyIM); court.add(headIM); court.add(armIM);
  let crowdAcc = 0;
  COURT_AMBIENT.push({ update(t, dt) {
    crowdAcc += dt; if (crowdAcc < 0.05) return; crowdAcc = 0;               // crowd animates at 20 Hz
    const wave = ((t * 9) % (GYM_Z * 2 + 20)) - GYM_Z - 10;                  // a wave rolling along the stands
    seats.forEach((s, k) => {
      const near = Math.max(0, 1 - Math.abs(s.z - wave) / 4); const cheer = 0.5 + 0.5 * Math.sin(t * s.spd * 2 + s.ph);
      const hop = near * 0.45 + cheer * 0.06; const y = s.y + 0.31 + hop;
      tmp.position.set(s.x, y, s.z); tmp.rotation.set(0, s.sx < 0 ? -Math.PI / 2 : Math.PI / 2, 0); tmp.scale.setScalar(1); tmp.updateMatrix(); bodyIM.setMatrixAt(k, tmp.matrix);
      tmp.position.set(s.x, y + 0.5, s.z); tmp.rotation.set(0, (s.sx < 0 ? -Math.PI / 2 : Math.PI / 2) + Math.sin(t * 1.3 + s.ph) * 0.3, 0); tmp.updateMatrix(); headIM.setMatrixAt(k, tmp.matrix);
      const up = Math.max(near, cheer > 0.85 ? 1 : 0);                        // arms up in the wave or on a cheer beat
      for (const side of [-1, 1]) { const ang = up ? -2.6 + Math.sin(t * 8 + s.ph + side) * 0.3 : -0.2; tmp.position.set(s.x, y + 0.15 + (up ? 0.35 : 0), s.z + side * 0.32); tmp.rotation.set(ang, 0, 0); tmp.updateMatrix(); armIM.setMatrixAt(k * 2 + (side > 0 ? 1 : 0), tmp.matrix); }
    });
    bodyIM.instanceMatrix.needsUpdate = true; headIM.instanceMatrix.needsUpdate = true; armIM.instanceMatrix.needsUpdate = true;
  } });
  // banners and pennants
  const bannerTex = (text, bg, fg) => canvasTex(1024, 256, (g, W, H) => { g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, text, 150, W * 0.9); g.fillText(text, W / 2, H / 2); });
  const banner = (text, x, z, ry, bg, fg, w = 12) => { const b = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: bannerTex(text, bg, fg) })); b.position.set(x, 6.8, z); b.rotation.y = ry; court.add(b); COURT_AMBIENT.push({ ph: Math.random() * 6, update(t) { b.rotation.z = Math.sin(t * 1.6 + this.ph) * 0.02; } }); };
  banner('VOLLEYBALL GAEM', 0, -GYM_Z + 0.3, 0, '#e5484d', '#fff', 16); banner("LET'S GO!", -12, -GYM_Z + 0.3, 0, '#111', '#f5c542', 8); banner('GO GO GO', 12, -GYM_Z + 0.3, 0, '#3b8ff0', '#fff', 8);
  banner('HOME OF THE GAEM', 0, GYM_Z - 0.3, Math.PI, '#3b8ff0', '#fff', 16);
  const penM = [mat(0xe5484d), mat(0x3b8ff0), mat(0xf5c542), mat(0x3ecf5a)];
  for (let i = -24; i <= 24; i += 2) for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 3), penM[((i / 2) + 12) % 4]); p.position.set(sx * (GYM_X - 0.5), 9.6, i); p.rotation.set(Math.PI, 0, 0); court.add(p); COURT_AMBIENT.push({ ph: i, update(t) { p.rotation.z = Math.sin(t * 2 + this.ph) * 0.25; } }); }
  for (let i = -24; i <= 24; i += 2) for (const sx of [-1, 1]) { const st = box(0.03, 0.03, 2, mat(0xdddddd), sx * (GYM_X - 0.5), 9.95, i + 1, court); st.castShadow = false; }
  // a few balloons drifting near the ceiling
  for (let i = 0; i < 8; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), mat(shirtCols[i % shirtCols.length], { emissive: shirtCols[i % shirtCols.length], emissiveIntensity: 0.25 })); const bx = -20 + Math.random() * 40, bz = -28 + Math.random() * 56; b.position.set(bx, 9.6, bz); court.add(b); COURT_AMBIENT.push({ ph: Math.random() * 6, update(t) { b.position.set(bx + Math.sin(t * 0.4 + this.ph) * 1.5, 9.3 + Math.sin(t * 0.9 + this.ph) * 0.4, bz + Math.cos(t * 0.35 + this.ph) * 1.5); } }); }
  buildNet(court, 0, 0, 0, NET_HALF * INDOOR_SCALE, COURT_W * INDOOR_SCALE / 2);
  scoreTex = canvasTex(1024, 300, () => { });
  for (const sx of [-1, 1]) { const sb = new THREE.Mesh(new THREE.PlaneGeometry(10, 3), new THREE.MeshBasicMaterial({ map: scoreTex })); sb.position.set(sx * (GYM_X - 0.3), 7.5, 0); sb.rotation.y = -sx * Math.PI / 2; court.add(sb); }
  drawScore(0, 0, '');
}
/* ---- beach practice map: a mini beach with one court and the water ---- */
const beachCourt = new THREE.Group();
const BEACH_AMBIENT = [];   // animated props on the beach court map (the lobby has its own AMBIENT list)
function updateBeachAmbient(t, dt) { updateWind(); for (const a of BEACH_AMBIENT) a.update(t, dt); }
function buildBeachCourt() {
  const sandM = mat(0xffffff, { bumpMap: sandBumpTex(), bumpScale: 0.18, map: canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#f0dfae'; g.fillRect(0, 0, w, h); for (let i = 0; i < 2600; i++) { g.fillStyle = ['#e6d29c', '#f7e8bd', '#dcc68f', '#fff3cf'][i % 4]; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); } }, [60, 60]) });
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), sandM); sand.rotation.x = -Math.PI / 2; sand.position.y = -0.03; sand.receiveShadow = true; beachCourt.add(sand);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(160, 300, 34, 64), makeWaterMaterial([1, 0, -50])); water.rotation.x = -Math.PI / 2; water.position.set(50 + 80, -0.015, 0); beachCourt.add(water);   // sea along the +x side, from the shore line at x = 50 outward
  const shore = new THREE.Mesh(new THREE.PlaneGeometry(3, 300), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .45, depthWrite: false })); shore.rotation.x = -Math.PI / 2; shore.position.set(50, 0.01, 0); beachCourt.add(shore);
  const lineM = mat(0xffffff); const hx = COURT_W / 2, hz = COURT_L / 2;
  for (const [x, z, w, dd] of [[0, -hz, hx * 2, 0.12], [0, hz, hx * 2, 0.12], [-hx, 0, 0.12, hz * 2], [hx, 0, 0.12, hz * 2], [0, 0, hx * 2, 0.12], [0, -hz / 3, hx * 2, 0.12], [0, hz / 3, hx * 2, 0.12]]) { const l = box(w, 0.03, dd, lineM, x, 0.0, z, beachCourt); l.castShadow = false; }   // incl. attack lines
  buildNet(beachCourt, 0, 0, 0, NET_HALF, COURT_W / 2);
  const palm = (x, z, h = 5) => makePalm(beachCourt, BEACH_AMBIENT, x, z, h);
  palm(-18, -20, 6); palm(-20, 16, 5); palm(18, -22, 5.5); palm(22, 20, 6); palm(-28, 0, 5); palm(30, -6, 5.5);
  const umbrella = (x, z, color) => makeUmbrella(beachCourt, x, z, color);
  umbrella(-16, 8, 0xe5484d); umbrella(24, -14, 0x3b8ff0); umbrella(-24, -10, 0xf5c542);
  // headlands out past the swim line, same trick as the lobby beach: the sea gets a far edge instead of haze
  const landM = mat(0x7e9c86), landM2 = mat(0x6b8a76);
  for (const [ix, iz, iw, ih, n] of [[132, -70, 46, 11, 4], [146, 30, 58, 14, 5], [128, 106, 38, 8, 3]]) {
    const isle = new THREE.Group(); isle.position.set(ix, 0, iz); isle.rotation.y = Math.random() * TAU; beachCourt.add(isle);
    for (let k = 0; k < n; k++) {
      const r = iw * (0.28 + Math.random() * 0.22), hh = ih * (0.55 + Math.random() * 0.7);
      const c = new THREE.Mesh(new THREE.ConeGeometry(r, hh, 6), k % 2 ? landM : landM2);
      c.position.set((Math.random() - 0.5) * 10, hh / 2 - 1.2, (k - (n - 1) / 2) * iw * 0.34);
      c.castShadow = c.receiveShadow = false; isle.add(c);
    }
  }
  for (const [x, z] of [[-14, -14], [16, 12], [-22, 6], [26, 4]]) { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6), mat(0xc9c2b4)); r.position.set(x, 0.25, z); beachCourt.add(r); }
  const scoreBoard = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.4), new THREE.MeshBasicMaterial({ map: scoreTex })); scoreBoard.position.set(-14, 4.5, 0); scoreBoard.rotation.y = Math.PI / 2; beachCourt.add(scoreBoard);
  box(0.2, 5.6, 0.2, mat(0x8a6a4a), -14, 2.8, -4.2, beachCourt); box(0.2, 5.6, 0.2, mat(0x8a6a4a), -14, 2.8, 4.2, beachCourt);
}
function drawScore(a, b, mode) {
  if (!scoreTex) return;
  const c = scoreTex.image, g = c.getContext('2d'); g.fillStyle = '#15161c'; g.fillRect(0, 0, c.width, c.height);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 170px Montserrat, Arial'; g.fillStyle = '#fff';
  g.fillText(a, 260, 150); g.fillText(b, 764, 150); g.fillText('-', 512, 140);
  g.font = '900 40px Montserrat, Arial'; g.fillStyle = '#aaa'; g.fillText(TEAM_NAME.A, 260, 265); g.fillText(TEAM_NAME.B, 764, 265); g.fillText(mode || '', 512, 265);
  scoreTex.needsUpdate = true;
}

/* =====================================================================
   BALL
   ===================================================================== */
const BALL_R = 0.3, BALL_G = 12.5;   // slightly floaty ball gravity
/* ball skins: same radius / hitbox for every skin, looks only */
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
const AURAS = [];   // chromatic auras (colour cycles every frame)
const NEUTRONS = [];   // neutron star balls (beams sweep, glow pulses)
const SKIN_CACHE = {}; const BALL_GLOW = 0.32;   // keeps balls at their old brightness under the darker lighting
function skinMaterial(id) {
  if (SKIN_CACHE[id]) return SKIN_CACHE[id];
  let m;
  if (id === 'basketball') {
    const tex = canvasTex(512, 256, (g, w, h) => {
      g.fillStyle = '#e8702a'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#1a1a1a'; g.lineWidth = 7;
      for (let i = 0; i < 4; i++) { const x = i * 128; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      for (let i = 0; i < 4; i++) { const x = i * 128 + 64; g.beginPath(); g.moveTo(x - 40, 0); g.quadraticCurveTo(x + 30, h / 2, x - 40, h); g.stroke(); }
    });
    m = mat(0xffffff, { map: tex, roughness: .8, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: BALL_GLOW });
  } else if (id === 'soccer') {                                          // white ball, black pentagons on a staggered lattice, stitched seams between them
    const tex = canvasTex(512, 256, (g, w, h) => {
      g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
      const pent = (cx, cy, r, rot) => { g.beginPath(); for (let i = 0; i < 5; i++) { const a = rot + i / 5 * Math.PI * 2; g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); };
      g.strokeStyle = '#b8b8b8'; g.lineWidth = 2;
      for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) { const cx = i * 128 + (row % 2 ? 64 : 0) + 32, cy = 44 + row * 84; pent(cx, cy, 44, -Math.PI / 2 + row * 0.6); g.stroke(); }   // hexagon seams (drawn as the light outlines between patches)
      g.fillStyle = '#151515';
      for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) { const cx = i * 128 + (row % 2 ? 64 : 0) + 32, cy = 44 + row * 84; pent(cx, cy, 26, -Math.PI / 2 + row * 0.6); g.fill(); }
    });
    m = mat(0xffffff, { map: tex, roughness: .75, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: BALL_GLOW });
  } else if (id === 'neutron') m = mat(0xcfe4ff, { emissive: 0x9fcaff, emissiveIntensity: 2.2, roughness: .15, metalness: .1 });   // a blue-white surface so hot it lights itself; the halo and beams are added in applySkin
  else if (id === 'chromatic') m = mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: .35 + BALL_GLOW, roughness: .3 });
  else if (id === 'black') m = mat(0x151515, { roughness: .6, emissive: 0x151515, emissiveIntensity: BALL_GLOW });
  else if (id === 'lowpoly') m = new THREE.MeshStandardMaterial({ color: 0xc4e3ea, roughness: .55, flatShading: true, emissive: 0xc4e3ea, emissiveIntensity: BALL_GLOW });
  else if (id === 'fire') {
    const tex = canvasTex(512, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ffdd55'); gr.addColorStop(0.5, '#ff6a1f'); gr.addColorStop(1, '#8a0f0f'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.strokeStyle = '#2a0a05'; g.lineWidth = 8; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128 + 60, h); g.stroke(); } });
    m = mat(0xffffff, { map: tex, roughness: .5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: BALL_GLOW });
  } else if (id === 'gold') m = mat(0xffc63a, { metalness: .9, roughness: .25, emissive: 0xffc63a, emissiveIntensity: BALL_GLOW });
  else if (id === 'beach') {
    const tex = canvasTex(512, 256, (g, w, h) => { const cols = ['#ffffff', '#e5484d', '#f5c542', '#3b8ff0', '#ffffff', '#3ecf5a', '#e5484d', '#f5c542']; for (let i = 0; i < 8; i++) { g.fillStyle = cols[i]; g.fillRect(i * 64, 0, 64, h); } });
    m = mat(0xffffff, { map: tex, roughness: .7, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: BALL_GLOW });
  } else {
    const tex = canvasTex(512, 256, (g, w, h) => { g.fillStyle = '#f6f6f6'; g.fillRect(0, 0, w, h); for (let i = 0; i < 4; i++) { g.fillStyle = '#2f6bff'; g.fillRect(i * 128, 0, 44, h); g.fillStyle = '#ffd000'; g.fillRect(i * 128 + 44, 0, 44, h); } g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 118, w, 20); });
    m = mat(0xffffff, { map: tex, roughness: .7, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: BALL_GLOW });
  }
  return SKIN_CACHE[id] = m;
}
const BALL_GEO = new THREE.SphereGeometry(BALL_R, 20, 16), BALL_GEO_LP = new THREE.IcosahedronGeometry(BALL_R, 1);
function applySkin(mesh, id) {
  id = SKINS[id] ? id : 'default'; if (ULTRA) id = 'default'; /* ultra low: every ball is drawn as the classic one (the owner's skin is still sent to others) */ mesh.geometry = id === 'lowpoly' ? BALL_GEO_LP : BALL_GEO; mesh.material = skinMaterial(id); mesh.userData.skin = id;
  // chromatic: glowing rainbow aura around the ball (visual only - hitbox is unchanged)
  const old = mesh.getObjectByName('aura'); if (old) { mesh.remove(old); const i = AURAS.indexOf(old.material); if (i >= 0) AURAS.splice(i, 1); const j = NEUTRONS.indexOf(old); if (j >= 0) NEUTRONS.splice(j, 1); }
  if (id === 'chromatic') {
    const am = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending });
    const aura = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.45, 20, 16), am); aura.name = 'aura'; mesh.add(aura);
    const am2 = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending });
    const aura2 = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.9, 20, 16), am2); aura2.name = 'aura'; aura.add(aura2);
    AURAS.push(am, am2);
  }
  if (id === 'neutron') {                                                 // neutron star: layered blue-white glow, an equatorial light ring, two pulsar beams sweeping round the magnetic axis
    const halo = (r, op, col, back) => { const mm = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, side: back ? THREE.BackSide : THREE.FrontSide }); const h = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * r, 20, 16), mm); return h; };
    const g = new THREE.Group(); g.name = 'aura'; mesh.add(g);
    g.add(halo(1.25, 0.4, 0xd6e9ff, true)); g.add(halo(1.7, 0.2, 0x8fc2ff, true)); g.add(halo(2.6, 0.07, 0x5a9cff, false));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(BALL_R * 1.55, BALL_R * 0.06, 8, 48), new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending })); ring.rotation.x = Math.PI / 2; g.add(ring);
    const beamTex = canvasTex(8, 128, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.35, 'rgba(180,220,255,0.45)'); gr.addColorStop(1, 'rgba(120,180,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); });
    const beamM = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, color: 0xbfdcff });
    const axis = new THREE.Group(); axis.rotation.z = 0.55; g.add(axis);                                   // the magnetic axis is tilted off the spin axis, as on a real pulsar
    for (const sgn of [1, -1]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(BALL_R * 0.03, BALL_R * 0.32, BALL_R * 4.5, 12, 1, true), beamM); b.position.y = sgn * BALL_R * 2.4; if (sgn < 0) b.rotation.x = Math.PI; axis.add(b); }
    g.userData.axis = axis; g.userData.halos = g.children.slice(0, 3).map(h => h.material); g.userData.ring = ring;
    NEUTRONS.push(g);
  }
}
function updateAuras(t) {
  for (let i = 0; i < AURAS.length; i++) AURAS[i].color.setHSL((t * 0.35 + i * 0.08) % 1, 1, 0.55);
  for (const g of NEUTRONS) {                                             // pulsar: beams spin ~4 turns a second about the star's own axis, the glow throbs with them
    g.rotation.y = t * 25; const p = 0.5 + 0.5 * Math.sin(t * 25);
    const h = g.userData.halos; h[0].opacity = 0.4 + p * 0.15; h[1].opacity = 0.18 + p * 0.1; h[2].opacity = 0.06 + p * 0.05;
    g.userData.ring.rotation.z = t * 3; g.userData.ring.material.opacity = 0.55 + p * 0.25;
  }
}
function makeBallMesh(skin = 'default') {
  const m = new THREE.Mesh(BALL_GEO, skinMaterial('default')); applySkin(m, skin); m.castShadow = true;
  const mine = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.04, 20, 16), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.6, depthWrite: false }));   // red shell: "your touch - wait for someone else to play it"
  mine.name = 'mine'; mine.visible = false; m.add(mine);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.2, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .35 })); shadow.rotation.x = -Math.PI / 2;
  return { mesh: m, shadow };
}
