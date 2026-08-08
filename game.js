'use strict';
/* ============================================================================
   KRAZALITY — a dark sci-fi neon pixel platformer
   Pure JS + Canvas. No libraries. 480x270 logical resolution, scaled by CSS.
   ========================================================================== */

/* ------------------------------ helpers ---------------------------------- */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const hash = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
const approach = (v, target, amt) => (v < target ? Math.min(v + amt, target) : Math.max(v - amt, target));
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/* ------------------------------ canvas ------------------------------------ */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const VW = 480, VH = 270;
ctx.imageSmoothingEnabled = false;

// preload the pixel font so canvas text renders crisp & retro (falls back to monospace offline)
if (document.fonts && document.fonts.load) document.fonts.load('8px "Press Start 2P"');

/* ------------------------------ audio ------------------------------------- */
const AudioSys = {
  ctx: null, master: null, muted: false,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type = 'square', vol = 0.2, slide = 0, delay = 0) {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.03);
  },
  noise(dur, vol = 0.25, delay = 0, freq = 2000) {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  },
  jump() { this.tone(300, 0.18, 'square', 0.16, 560); },
  bounce() { this.tone(230, 0.24, 'square', 0.22, 820); },
  land() { this.noise(0.07, 0.12, 0, 700); },
  slash() { this.noise(0.09, 0.16, 0, 2600); },
  arrow() { this.noise(0.07, 0.13, 0, 3200); this.tone(950, 0.1, 'triangle', 0.12, 240); },
  hammer() { this.tone(120, 0.28, 'sawtooth', 0.3, 38); this.noise(0.22, 0.32, 0, 320); },
  hit() { this.tone(230, 0.08, 'square', 0.2, 130); },
  kill() { this.noise(0.26, 0.34, 0, 1600); this.tone(190, 0.26, 'sawtooth', 0.24, 42); },
  clink() { this.tone(1500, 0.06, 'square', 0.13, 950); this.tone(920, 0.05, 'square', 0.1, 700); },
  shard() { [660, 880, 1320, 1760].forEach((f, i) => this.tone(f, 0.12, 'square', 0.16, f * 1.01, i * 0.07)); },
  ammo() { this.tone(520, 0.08, 'square', 0.15, 800); this.tone(780, 0.1, 'square', 0.13, 1180, 0.07); },
  checkpoint() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.2, 0, i * 0.09)); },
  stomp() { this.tone(85, 0.32, 'sawtooth', 0.42, 30); this.noise(0.26, 0.3, 0, 240); },
  void() { this.tone(320, 0.5, 'sawtooth', 0.24, 55); },
  win() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.18, 'square', 0.18, 0, i * 0.12)); },
  glitch() { this.tone(70, 0.12, 'sawtooth', 0.18, 35); this.noise(0.09, 0.16, 0, 400); },
  soul() { this.tone(95, 0.22, 'sawtooth', 0.3, 330); this.noise(0.18, 0.2, 0, 900); this.tone(660, 0.1, 'square', 0.12, 180, 0.05); },
  heal() { [392, 523, 659].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.18, 0, i * 0.08)); },
  ui() { this.tone(620, 0.05, 'square', 0.12, 900); },
};

/* ------------------------------ input -------------------------------------- */
const input = {
  keys: new Set(),
  attackQueued: false,
  jumpPressed: false,
  weaponQueued: null,
  pauseQueued: false,
  skillsQueued: false,
  castQueued: false,   // E — Glitch Wave spell
  restartQueued: false,
  muteQueued: false,
};
const JUMP_KEYS = ['Space', 'KeyW'];
const LEFT_KEYS = ['ArrowLeft', 'KeyA'];
const RIGHT_KEYS = ['ArrowRight', 'KeyD'];

window.addEventListener('keydown', (e) => {
  const c = e.code;
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(c)) e.preventDefault();
  if (e.repeat) return;
  // while the Level 10 faction popup is open, gameplay keys are dead — only
  // sound (M) still works; the choice itself is made by clicking a card
  if (factionChoiceOpen && c !== 'KeyM') return;
  input.keys.add(c);
  if (c === 'KeyF' || c === 'KeyJ' || c === 'KeyX') input.attackQueued = true;
  if (JUMP_KEYS.includes(c)) input.jumpPressed = true;
  if (/^Digit[1-5]$/.test(c)) {
    // hotbar: select the matching inventory slot (only if that slot is unlocked)
    const slot = +c.slice(5) - 1;
    if (P.inventory[slot]) input.weaponQueued = { slot };
  }
  // Q cycles the hotbar — ignored before level 10 and permanently locked by the KRATOS set
  if (c === 'KeyQ' && G.level >= 10 && !P.qLocked) input.weaponQueued = 'cycle';
  // developer testing hotkeys
  if (c === 'KeyL' && G.state === 'play') addDust(100);            // +100 Cosmic Dust → forces immediate level advancement
  if (c === 'KeyH' && G.state === 'play') {                        // instantly restore core health
    G.hp = MAX_HP;
    P.iframes = Math.max(P.iframes, 1.2);
    AudioSys.heal();
    updateHUD();
    toast('CORE HEALTH RESTORED!', false);
  }
  if (c === 'KeyP') input.pauseQueued = true;
  if (c === 'KeyK') input.skillsQueued = true;
  if (c === 'KeyE') input.castQueued = true;   // Glitch Wave spell
  // changeable armor — 'C' cycles the unlocked armor sets (casual first)
  if (c === 'KeyC' && G.level >= 10 && G.state === 'play') cycleArmor();
  if (c === 'KeyV' && G.kratosClaimed && G.rage >= 100 && G.rageT <= 0 && G.state === 'play') {
    // Spartan Rage — 6 seconds of double speed, crimson border, spin vortex, lifesteal
    G.rageActive = true; G.rageT = 6; G.rage = 0;
    AudioSys.void();
    shakeScreen(8);
    burst(cx(), P.y + P.h / 2, COLORS.red, 26, { size: 2, life: 0.5, sp0: 80, sp1: 260 });
    toast('KRAZAL RAGE — 6 SECONDS!', false, 2000);
    updateHUD();
  }
  if (c === 'F2') input.restartQueued = true;  // restart moved to F2 (R now focuses)
  if (c === 'KeyM') input.muteQueued = true;
});
window.addEventListener('keyup', (e) => input.keys.delete(e.code));
// mouse attack: left click on the canvas fires the current weapon
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  AudioSys.ensure();
  mouseDown = true;
  if (G.state === 'play') input.attackQueued = true;
});
window.addEventListener('pointerup', () => { mouseDown = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

/* ------------------------------ constants ---------------------------------- */
const GRAV = 1500, RUN_SPD = 235, ACCEL = 2500, AIR_ACC = 1500, FRICTION = 2100;
const MAX_FALL = 700, JUMP_V = 560, BOUNCE_V = 830, MAX_HP = 5, MAX_SOUL = 100, FOCUS_COST = 33;
const LEVEL_W = 5700, VOID_Y = 286;
let MAX_AMMO = 30;   // scaled to 50 when the VOID HUNTER set unlocks (level 10)
const MAX_LEVEL = 50; // absolute level cap for Cosmic Dust progression (the KRATOS altar opens at 50)
const COLORS = {
  green: '#39ff88', pink: '#ff3fd8', yellow: '#ffe94a', cyan: '#33f5ff',
  purple: '#b44bff', orange: '#ffa726', red: '#ff4d6d', white: '#f4fdff',
};

/* -------- milestone hotbar: inventory slots, armor sets, weapon defs -------- */
// Hand-held weapons — the active one is always P.inventory[P.activeSlot]
const WEAPON_DEFS = {
  GLOVE:          { name: 'KRAZAL BOXING GLOVE', short: 'GLOVE',  ammo: false, melee: true },
  REPEATER:       { name: 'VOID REPEATER',       short: 'REP',    ammo: true,  melee: false },
  AEGIS:          { name: 'AEGIS VANGUARD',      short: 'AEGIS',  ammo: false, melee: true },
  RAILGUN:        { name: 'OVERCHARGED RAILGUN', short: 'RAIL',   ammo: true,  melee: false },
  CHRONO_SCYTHE:  { name: 'CHRONO-SCYTHE',       short: 'SCYTHE', ammo: false, melee: true },
  BLADES_OF_CHAOS:{ name: 'BLADES OF CHAOS',     short: 'CHAOS',  ammo: false, melee: true },
};

// One-time milestone unlocks, banners, and structural rules
const MILESTONES = [
  { level: 10, banner: 'VOID HUNTER SET UNLOCKED!',     weapon: 'REPEATER',       armor: 'VOID_HUNTER', color: '#33f5ff' },
  { level: 12, banner: 'THE CHRONO HOURGLASS APPEARS!', weapon: null,              armor: null,          color: '#7ab8ff' },
  { level: 20, banner: 'AEGIS PALADIN SET UNLOCKED!',   weapon: 'AEGIS',          armor: 'PALADIN',     color: '#b44bff' },
  { level: 30, banner: 'RAIL-JUGGERNAUT SET UNLOCKED!', weapon: 'RAILGUN',        armor: 'JUGGERNAUT',  color: '#ffe94a' },
  { level: 40, banner: 'CHRONO SET UNLOCKED!',          weapon: 'CHRONO_SCYTHE',  armor: 'CHRONO_GUARD', color: '#7ab8ff' },
  { level: 50, banner: 'LEVEL 50 — THE ALTAR AWAITS!',  weapon: 'BLADES_OF_CHAOS', color: '#ff4d6d' },
];

/* -------- Level 10 Faction Class choice -------- */
// At level 10 the game pauses and the boy picks ONE class path. The chosen
// faction weapon occupies hotbar Slot 2; the remaining weapons still unlock
// at 20/30/40 (no duplicates — already-owned faction weapons are skipped).
const FACTION_DEFS = {
  VOID_HUNTER:  { name: 'VOID HUNTER',       weapon: 'REPEATER', armor: 'VOID_HUNTER',  color: '#33f5ff', banner: 'VOID HUNTER SET UNLOCKED!',   synergy: 'AMMO CAP 50' },
  PALADIN:      { name: 'AEGIS PALADIN',     weapon: 'AEGIS',    armor: 'PALADIN',      color: '#b44bff', banner: 'AEGIS PALADIN SET UNLOCKED!', synergy: '+1 SHIELD HEART' },
  JUGGERNAUT:   { name: 'RAIL-JUGGERNAUT',   weapon: 'RAILGUN',  armor: 'JUGGERNAUT',   color: '#ffe94a', banner: 'RAIL-JUGGERNAUT SET UNLOCKED!', synergy: '85% CHARGE SPEED' },
};

// pretty display names for armor sets shown in the top HUD
const ARMOR_NAMES = {
  NONE: 'NONE',
  VOID_HUNTER: 'VOID-STALKER CLOAK',
  PALADIN: 'QUANTUM PLATED CARAPACE',
  JUGGERNAUT: 'GRAVITY STABILIZER EXOSUIT',
  CHRONO_GUARD: 'CHRONO-GUARD PLATE',
  KRATOS: 'PALE SKIN + RED TATTOO',
};

/* ------------------------------ game state --------------------------------- */
const G = {
  state: 'menu', // menu | play | win
  time: 0, runTime: 0,
  shards: 0, deaths: 0, kills: 0, restarts: 0,
  armor: 0, // Knight Helm shield points
  hp: MAX_HP, soul: 0, // Hollow Knight-style SOUL magic
  dust: 0, level: 1, spent: 0, // Cosmic Dust progression
  rage: 0,                     // orange Rage Meter (builds from blade hits / taking hits)
  shieldHearts: 0,             // permanent shield hearts (first PALADIN armor wear grant)
  paladinHeart: false,         // +1 Shield Heart already granted by the PALADIN set
  milestones: {},              // applied milestone flags (level -> true)
  chronoGot: false,            // Level 12 secret hourglass claimed — Chrono-Scythe + plate
  altarSpawned: false,         // End-Game Altar Room opened at the Level 50 cap
  faction: null,               // Level 10 faction class: 'VOID_HUNTER' | 'PALADIN' | 'JUGGERNAUT' | null
  kratosClaimed: false,        // touched the Mark of Krazality at the end-game altar
  kratosHearts: 0,             // 2 neon-red Armor Hearts guard the KRATOS skin
  rageActive: false, rageT: 0, // Spartan Rage override state
  skills: { sharpEdge: false, quickDraw: false, doubleJump: false },
  paused: false,
};

/* ------------------------------ world data --------------------------------- */
let platforms = [], shards = [], pickups = [], checkpoints = [], enemies = [];
let arrows = [], waves = [], shocks = [], spells = [], particles = [];
let gate = null;
let respawn = { x: 90, y: 150 };
let weapon = 'GLOVE', ammo = 30, weaponCd = 0, slashT = 0, castCd = 0, mouseDown = false;
let repStreak = 0, repStreakT = 0, repToastShown = false; // Void Repeater x5 combo streak
let repBurst = 0; const burstHit = new Set(); // per-burst combo tracking (a whiffed burst resets to 1x)
let markOfKrazality = null;               // end-game altar artifact
let hourglass = null;                     // Level 12 secret Chrono artifact
let legendBannerT = 0;                    // timer for the full-screen legendary unlock banner
let factionChoiceOpen = false;            // Level 10 faction popup is showing (game paused)
let hordeActive = false, hordeTimer = 0;  // endless victory-lap Glitch-Hedgehog horde
let slashHitSet = new Set(); // enemies already hit by the current dagger stab
let freeze = 0, shakeT = 0, shakeMag = 0, shakeHoriz = false;
let anomalyTimer = rnd(8, 15), anomalyFlash = 0;
let camX = 0;

const P = { // player (x,y = top-left of hitbox)
  x: 90, y: 150, w: 12, h: 20,
  vx: 0, vy: 0, facing: 1,
  onGround: false, coyote: 0, jumpBuf: 0,
  anim: 0, sq: 0, sqv: 0,
  iframes: 0, stun: 0, runPhase: 0,
  slashAnim: 0, bowAnim: 0, hamWindup: 0, hamSlam: 0, hamActive: false,
  jumpsUsed: 0, hurtFlash: 0,
  focusT: 0,    // Focus (R) channel progress toward 1.2s
  // milestone hotbar & armor set
  inventory: ['GLOVE'], activeSlot: 0, currentArmor: 'NONE', qLocked: false,
  // weapon animation / charge state
  charging: false, charge: 0, aegisT: 0, scytheT: 0, parryT: 0,
  armorBroken: false, // milestone armor shattered by heavy damage (weapons kept)
  trail: [],   // position history for the VOID HUNTER ghost cloak
};
const cx = () => P.x + P.w / 2;
const bottom = () => P.y + P.h;

/* ------------------------------ level build -------------------------------- */
function makePlat(x, y, w, type, tiltDeg, period = 0, off = 0) {
  return { x, y, w, h: 14, type, tilt: tiltDeg * Math.PI / 180, period, off, alpha: 1, bounceT: 0 };
}

function buildLevel() {
  platforms = [];
  shards = [];
  pickups = [];
  checkpoints = [];
  enemies = [];
  arrows = [];
  waves = [];
  shocks = [];
  particles = [];
  weapon = 'GLOVE'; ammo = MAX_AMMO; weaponCd = 0; slashT = 0; castCd = 0;
  spells = [];
  slashHitSet = new Set();
  P.x = 90; P.y = 150; P.vx = 0; P.vy = 0; P.facing = 1; P.onGround = false;
  P.iframes = 2; P.stun = 0; P.hamActive = false; P.focusT = 0;
  G.shards = 0; G.kills = 0; G.runTime = 0; G.time = 0; G.armor = 0;
  G.hp = MAX_HP; G.soul = 0;
  respawn = { x: 90, y: 150 };
  camX = 0;
  P.inventory = ['GLOVE']; P.activeSlot = 0; // worn armor persists across restarts (validated in applyMilestone)
  P.qLocked = false; P.charging = false; P.charge = 0; P.aegisT = 0; P.scytheT = 0; P.parryT = 0;
  P.armorBroken = false; P.trail = [];
  markOfKrazality = null; hourglass = null; hordeActive = false; hordeTimer = 0;
  repStreak = 0; repStreakT = 0; repBurst = 0; burstHit.clear();
  G.rageActive = false; G.rageT = 0; G.kratosHearts = 0;
  applyMilestone(); // sync inventory slots / armor set / ammo cap to the current level

  /* platforms */
  // spawn island + first bounce pad + shard-1 platform (clear of the pad)
  platforms.push(makePlat(-300, 196, 1020, 'solid', -2));
  platforms.push(makePlat(990, 120, 170, 'solid', 3));
  platforms.push(makePlat(880, 196, 90, 'bouncy', 4));
  // section 2 (main road)
  platforms.push(makePlat(1300, 196, 750, 'solid', 2));
  // bonus ammo platform + launch pad
  platforms.push(makePlat(1490, 120, 90, 'solid', -3));
  platforms.push(makePlat(1515, 196, 80, 'bouncy', 3));
  // ghost gauntlet (3 fading bridges)
  platforms.push(makePlat(2140, 130, 160, 'ghost', -3, 6.6, 0));
  platforms.push(makePlat(2350, 130, 160, 'ghost', 3, 6.6, 2.2));
  platforms.push(makePlat(2560, 130, 160, 'ghost', -2, 6.6, 4.4));
  // section 3
  platforms.push(makePlat(2720, 196, 580, 'solid', -2));
  // the steps
  platforms.push(makePlat(3300, 170, 200, 'solid', -3));
  platforms.push(makePlat(3520, 140, 160, 'solid', 2));
  platforms.push(makePlat(3700, 110, 200, 'solid', -2));
  // golem arena
  platforms.push(makePlat(3960, 196, 940, 'solid', 0));
  // gate runway
  platforms.push(makePlat(4900, 196, 720, 'solid', -1));

  /* portal shards (2 hidden + 1 dropped by the golem) */
  shards.push({ x: 1075, y: 118, got: false, t: rnd(TAU) });      // on the platform above the pink pad
  shards.push({ x: 2505, y: 78, got: false, t: rnd(TAU) });       // above the ghost gauntlet

  /* static ammo cache + Knight Helm pickup on the bonus platform */
  pickups.push({ type: 'ammo', x: 1531, y: 110, w: 8, h: 10, grounded: true, vx: 0, vy: 0, t: rnd(TAU) });
  pickups.push({ type: 'helmet', x: 1545, y: 106, w: 14, h: 14, grounded: true, vx: 0, vy: 0, t: rnd(TAU) });

  /* checkpoints */
  checkpoints.push({ x: 90, y: 196, on: true });                   // spawn (auto)
  checkpoints.push({ x: 1400, y: 196, on: false });                // mid level
  checkpoints.push({ x: 3550, y: 140, on: false });                // on step 2

  /* vortex gate */
  gate = { x: 5200, y: 196, w: 90, h: 120, t: 0 };

  /* enemies */
  enemies.push(hedgehog(120, 186, 60, 560));
  enemies.push(hedgehog(1500, 186, 1420, 1900));
  enemies.push(hedgehog(2900, 186, 2800, 3160));
  enemies.push(hedgehog(4100, 186, 3980, 4240));
  enemies.push(bat(1130, 96, 4, 10));
  enemies.push(bat(2460, 80, 4, 9));
  enemies.push(golem(4320, 152));

  /* Level 12 secret — the Chrono hourglass materializes near a high platform */
  if (G.level >= 12 && !G.chronoGot) spawnHourglass();
  /* re-open the End-Game Altar if it was triggered but the Mark was never claimed */
  if (G.milestones[50] && !G.kratosClaimed && !markOfKrazality) {
    markOfKrazality = { x: gate.x - 40, y: 176, w: 16, h: 16, t: 0, taken: false };
  }

  updateHUD();
}

/* ------------------------------ enemies ------------------------------------ */
function hedgehog(x, y, min, max) {
  return {
    kind: 'hedgehog', x, y, w: 14, h: 10, hp: 1, maxHp: 1, dead: false,
    dir: 1, facing: 1, speed: 46, min, max, flash: 0, bob: 0, kb: 0, kbTime: 0,
    color: COLORS.purple, cx: x + 7, cy: y + 5,
  };
}
function bat(x, y, amp, speed) {
  return {
    kind: 'bat', x, y, w: 16, h: 12, hp: 1, maxHp: 1, dead: false,
    baseY: y, amp, speed, off: rnd(TAU), flash: 0, t: rnd(TAU), kb: 0, kbTime: 0,
    color: COLORS.orange, cx: x + 8, cy: y + 6,
  };
}
function golem(x, y) {
  return {
    kind: 'golem', x, y, w: 40, h: 44, hp: 3, maxHp: 3, dead: false,
    phase: 'idle', timer: 2.0, telegraph: 0, flash: 0, t: rnd(TAU), kb: 0, kbTime: 0,
    color: COLORS.red, cx: x + 20, cy: y + 22, dropped: false,
  };
}

function updateEnemies(dt) {
  for (const e of enemies) {
    if (e.dead) continue;
    // KO-launched bodies (Boxing Glove Knockout Frame) arc upward until they
    // clear the top of the world, then are spliced out of memory
    if (e.ko) {
      e.koVy += 700 * dt;
      e.y += e.koVy * dt;
      e.x += e.koVx * dt;
      e.cx = e.x + e.w / 2; e.cy = e.y + e.h / 2;
      if (e.y < -60 || e.x < -100 || e.x > LEVEL_W + 100) e.dead = true;
      continue;
    }
    e.flash = Math.max(0, e.flash - dt);
    if (e.kind === 'hedgehog') {
      if (e.kbTime > 0) { e.kbTime -= dt; e.x += e.kb * dt; }   // knocked back
      else e.x += e.dir * e.speed * dt;
      if (e.x <= e.min) { e.x = e.min; e.dir = 1; }
      if (e.x + e.w >= e.max) { e.x = e.max - e.w; e.dir = -1; }
      e.facing = e.dir;
      e.bob += dt * 14;
      e.cx = e.x + e.w / 2; e.cy = e.y + Math.sin(e.bob) * 1;
      // turn-around dust puffs
      if (Math.random() < 0.4 && (Math.abs(e.x - e.min) < 3 || Math.abs(e.x + e.w - e.max) < 3)) dust(e.cx, e.y + e.h, 1, COLORS.purple);
    } else if (e.kind === 'bat') {
      e.t += dt * e.speed;
      e.y = e.baseY + Math.sin(e.t) * e.amp;
      if (e.kbTime > 0) { e.kbTime -= dt; e.x += e.kb * dt; }
      else e.x += Math.sin(e.t * 0.7) * 8 * dt;
      e.cx = e.x + e.w / 2; e.cy = e.y + e.h / 2;
    } else if (e.kind === 'golem') {
      e.t += dt;
      if (e.kbTime > 0) { e.kbTime -= dt; e.x += e.kb * dt; e.cx = e.x + e.w / 2; } // glove 40px shove
      if (e.phase === 'stunned') {
        // perfectly parried — frozen solid for 1.5s
        e.timer -= dt;
        if (Math.random() < dt * 30) sparks(e.cx + rnd(-14, 14), e.y + rnd(0, 20), '#ffa3ec', 1);
        if (e.timer <= 0) { e.phase = 'idle'; e.timer = 2.0; }
      } else if (e.phase === 'idle') {
        e.timer -= dt;
        if (e.timer <= 0) { e.phase = 'telegraph'; e.telegraph = 0.55; }
      } else if (e.phase === 'telegraph') {
        e.telegraph -= dt;
        shakeScreen(1.5);
        if (e.telegraph <= 0) {
          stomp(e);
          e.phase = 'cooldown'; e.timer = 4.0;
        }
      } else { // cooldown
        e.timer -= dt;
        if (e.timer <= 0) e.phase = 'idle';
      }
    }
  }

  // endless victory-lap horde — weak Glitch-Hedgehogs swarm after the Mark is claimed
  if (hordeActive && enemies.length < 14) {
    hordeTimer -= dt;
    if (hordeTimer <= 0) {
      hordeTimer = rnd(0.8, 1.4);
      const side = Math.random() < 0.5 ? -1 : 1;
      const hx = clamp(P.x + side * rnd(180, 420), 40, LEVEL_W - 60);
      const h = hedgehog(hx, 186, hx - 90, hx + 90);
      h.speed = 55 + rnd(20); // weak victory-lap Glitch-Hedgehog
      enemies.push(h);
    }
  }

  // splice defeated enemies out of memory (keeps the endless horde truly endless)
  enemies = enemies.filter((e) => !e.dead);
}

function stomp(e) {
  AudioSys.stomp();
  shakeScreen(6);
  dust(e.cx, e.y + e.h, 10, COLORS.red);
  const dir = P.x + P.w / 2 > e.cx ? 1 : -1;
  waves.push({ x: e.cx - 14, y: 184, w: 18, h: 14, dir, speed: 250, life: 3.6, owner: e });
}

function damageEnemy(e, n, fromX, melee) {
  if (e.dead || e.ko) return false; // KO-launched bodies are already counted — never double-award
  e.hp -= n;
  e.flash = 0.14;
  if (e.hp <= 0) { killEnemy(e); return true; }
  // CHRONO-SCYTHE — 25% health execute window. It belongs to the scythe weapon
  // itself, so it keeps working even if the Chrono plate armor was shattered by
  // heavy damage (weapons are never lost when armor breaks). Wide-arc MELEE
  // executions award double SOUL (+20) + a 0.5s i-frame.
  if (weapon === 'CHRONO_SCYTHE' && e.hp <= Math.max(1, Math.ceil((e.maxHp || 1) * 0.25))) {
    killEnemy(e);
    if (melee) {
      gainSoul(20);
      P.iframes = Math.max(P.iframes, 0.5);
      addFloatText(e.cx, e.cy - 8, 'EXECUTE! +20 SOUL', '#7ab8ff');
    } else {
      addFloatText(e.cx, e.cy - 8, 'EXECUTE!', '#7ab8ff');
    }
    return true;
  }
  AudioSys.hit();
  freeze = Math.max(freeze, 0.05);
  sparks(e.cx, e.cy, e.color, 8);
  if (e.kind === 'golem') { shakeScreen(4); AudioSys.clink(); }
  return false;
}

function killEnemy(e) {
  e.dead = true;
  G.kills++;
  freeze = Math.max(freeze, 0.09);
  shakeScreen(6);
  if (e.kind === 'golem') {
    // shifting glitch-RGB block particles (12-15 total)
    addParticle({ kind: 'flash', x: e.cx, y: e.cy, life: 0.18, color: COLORS.red, r: 18 });
    addParticle({ kind: 'ring', x: e.cx, y: e.cy, r: 4, vr: 240, life: 0.3, color: COLORS.red });
    burst(e.cx, e.cy, '#ff4d6d', 14, { glitch: true, size: 2, life: 0.5, sp0: 60, sp1: 260 });
  } else {
    // hedgehog = neon purple, wobble-bat = neon yellow
    explode(e.cx, e.cy, e.kind === 'bat' ? COLORS.yellow : e.color, 14);
  }
  AudioSys.kill();
  // Cosmic Dust reward (hedgehog 10, bat 15, golem 50)
  addDust(enemyDust(e));
  addFloatText(e.cx, e.cy - 8, `+${dustVal}`, e.color);
  if (e.kind === 'bat') {
    const pk = { type: 'ammo', x: e.x, y: e.y, w: 8, h: 10, grounded: false, vx: rnd(-30, 30), vy: -140, t: rnd(TAU) };
    pickups.push(pk);
  }
  if (e.kind === 'golem' && !e.dropped) {
    e.dropped = true;
    shards.push({ x: e.cx - 8, y: e.y - 6, got: false, t: rnd(TAU) }); // shard #3
  }
}

function enemyDust(e) { return e.kind === 'hedgehog' ? 10 : e.kind === 'bat' ? 15 : 50; }

function addDust(n) {
  const prevLevel = G.level;
  G.dust += n;
  G.level = Math.min(Math.floor(G.dust / 100) + 1, MAX_LEVEL);
  if (G.level > prevLevel) {
    AudioSys.checkpoint();
    toast(G.level >= MAX_LEVEL ? 'MAX LEVEL REACHED!' : 'LEVEL UP! PRESS K FOR SKILLS', false, 2600);
    explode(P.x + P.w / 2, P.y - 10, COLORS.cyan, 18);
    applyMilestone(); // milestone banners / inventory & armor structural rules
  }
  updateHUD();
  if (skillsOpen) updateSkillsUI();
}

function addFloatText(x, y, text, color) {
  addParticle({ kind: 'text', x, y, text, color, life: 0.85 });
}

/* ------------------------------ pickups / shards --------------------------- */
function updatePickups(dt) {
  for (const p of pickups) {
    p.t += dt;
    if (!p.grounded) {
      p.vy = Math.min(p.vy + GRAV * 0.6 * dt, MAX_FALL * 0.6);
      p.x += p.vx * dt; p.y += p.vy * dt;
      for (const pl of platforms) {
        if (!solid(pl)) continue;
        if (overlap(p, pl) && p.vy > 0) {
          p.y = pl.y - p.h; p.vy = 0; p.vx = 0; p.grounded = true;
        }
      }
    }
    if (overlap(p, P) && G.state === 'play') {
      p.grounded = true;
      if (p.type === 'ammo') {
        ammo = Math.min(ammo + 5, MAX_AMMO);
        AudioSys.ammo();
        explode(p.x + 6, p.y + 4, COLORS.yellow, 10);
        toast('AMMO +5', false);
        p.dead = true;
        updateHUD();
      } else if (p.type === 'helmet') {
        if (G.armor < 1) {
          G.armor = 1;
          AudioSys.checkpoint();
          explode(p.x + 7, p.y + 7, '#c9ced6', 14);
          toast('KNIGHT HELM EQUIPPED! +1 SHIELD', false);
          p.dead = true;
          updateHUD();
        }
      }
    }
  }
  pickups = pickups.filter((p) => !p.dead);

  for (const s of shards) {
    if (s.got) continue;
    s.t += dt;
    const sy = s.y + Math.sin(s.t * 2.4) * 4;
    if (Math.abs(cx() - (s.x + 6)) < 20 && Math.abs(P.y + P.h / 2 - sy) < 24 && G.state === 'play') {
      s.got = true;
      G.shards++;
      AudioSys.shard();
      explode(s.x + 6, sy, COLORS.cyan, 18);
      toast(`PORTAL SHARD ${G.shards}/3 — KEEP GOING!`, false);
      updateHUD();
      if (G.shards >= 3) {
        toast('THE VORTEX IS OPEN — REACH THE GATE!', false);
        AudioSys.win();
        explode(gate.x + gate.w / 2, gate.y - 40, COLORS.cyan, 30);
      }
    }
  }
}

/* ------------------------------ weapons ------------------------------------- */
function setWeapon(q) {
  // switching weapons mid-charge aborts the railgun charge cycle
  if (q === 'cycle') {
    // Q — cycle the hotbar (locked below level 10 and permanently by the KRATOS set)
    if (G.level >= 10 && !P.qLocked && P.inventory.length > 1) {
      P.activeSlot = (P.activeSlot + 1) % P.inventory.length;
      weapon = P.inventory[P.activeSlot];
    }
  } else if (q && typeof q === 'object' && q.slot !== undefined) {
    // digit keys — jump straight to a hotbar slot (only if unlocked)
    if (P.inventory[q.slot]) {
      P.activeSlot = q.slot;
      weapon = P.inventory[q.slot];
    }
  }
  P.charging = false; P.charge = 0;
  AudioSys.ui();
  updateHUD();
}

/* ---------------------- milestone structure engine ------------------------- */
// Enforces the absolute inventory-length / armor / Q-lock rules for the current
// level, then fires one-time banners + bonuses when a new milestone is crossed.
function applyMilestone() {
  const lvl = G.level;

  if (G.kratosClaimed) {
    // KRATOS override active — single locked BLADES OF CHAOS slot, Q permanently
    // off. Checked FIRST so leveling past the Lv50 awakening can never rebuild
    // the loadout and undo the override.
    P.inventory = ['BLADES_OF_CHAOS'];
    P.activeSlot = 0;
    weapon = 'BLADES_OF_CHAOS';
    P.currentArmor = 'KRATOS';
    P.qLocked = true;
    // NOTE: G.rage is set to 100 once inside claimKratos() (the awakening);
    // this sync branch must NOT pin it to 100 on every level-up during the
    // victory-lap horde, or the player would have infinite Spartan Rage.
  } else if (lvl >= MAX_LEVEL) {
    // Reached the level cap — the full loadout stays (CHRONO_GUARD armor)
    // until the Mark of Krazality artifact is touched.
    P.inventory = ['GLOVE'];
    for (const w of ['REPEATER', 'AEGIS', 'RAILGUN', 'CHRONO_SCYTHE']) {
      if (!P.inventory.includes(w)) P.inventory.push(w);
    }
    P.activeSlot = Math.min(P.activeSlot, P.inventory.length - 1);
    weapon = P.inventory[P.activeSlot] || 'GLOVE';
    P.currentArmor = 'CHRONO_GUARD';
    P.qLocked = false;
  } else {
    // Slot 1 is strictly [Krazal Boxing Glove]; the arsenal unlocks one at a
    // time: Lv10 Repeater → Lv20 Aegis → Lv30 Railgun → Lv40 Chrono-Scythe
    // (the scythe can also be claimed early from the Lv12 hourglass — no dupes).
    P.inventory = ['GLOVE'];
    P.qLocked = false; // Q cycling is always live outside the KRATOS override
    if (lvl >= 10) P.inventory.push('REPEATER');
    if (lvl >= 20) P.inventory.push('AEGIS');
    if (lvl >= 30) P.inventory.push('RAILGUN');
    if (G.chronoGot && lvl >= 12 && !P.inventory.includes('CHRONO_SCYTHE')) P.inventory.push('CHRONO_SCYTHE');
    if (lvl >= 40 && !P.inventory.includes('CHRONO_SCYTHE')) P.inventory.push('CHRONO_SCYTHE');
    if (P.activeSlot >= P.inventory.length) P.activeSlot = Math.max(0, P.inventory.length - 1);
    weapon = P.inventory[P.activeSlot] || 'GLOVE';
    // armor is CHANGEABLE — keep whatever set the boy is currently wearing
    // (base look is casualwear). Only fall back to casual if the worn set is
    // no longer unlocked.
    if (!armorCycleList().includes(P.currentArmor)) P.currentArmor = 'NONE';
    // ammo cap scales to 50 the moment the Void Repeater is owned
    if (P.inventory.includes('REPEATER') && MAX_AMMO < 50) { MAX_AMMO = 50; ammo = MAX_AMMO; }
  }

  // one-time milestone effects + banners
  for (const m of MILESTONES) {
    if (G.kratosClaimed) break; // the awakening overrides all further milestones
    if (lvl >= m.level && !G.milestones[m.level]) {
      G.milestones[m.level] = true;
      P.armorBroken = false; // fresh set injection re-equips the worn armor
      if (m.level === 12) {
        // Level 12 secret — the Chrono hourglass materializes near a high
        // platform. The set is claimed by touching it (claimChrono), so the
        // banner here is just a breadcrumb — no auto-select.
        spawnHourglass();
        AudioSys.win();
        toast(m.banner, false, 3000);
        burst(cx(), P.y - 10, m.color, 18, { size: 2, life: 0.8, sp0: 60, sp1: 200 });
        continue;
      }
      if (m.level === 40 && G.chronoGot) continue; // scythe already claimed via the hourglass
      if (m.level === 20 && !G.paladinHeart) {      // Aegis Paladin set: +1 permanent Shield Heart
        G.paladinHeart = true;
        G.shieldHearts++;
      }
      // auto-select the freshly unlocked hotbar slot so the boy immediately
      // wields the new weapon (slot push + armor injection both already happened
      // synchronously above — same millisecond, single unified block)
  const freshIdx = m.level === 50 ? -1
    : (P.inventory.indexOf(m.weapon) >= 0 ? P.inventory.indexOf(m.weapon) : P.inventory.length - 1);
      if (freshIdx >= 0) { P.activeSlot = freshIdx; weapon = P.inventory[freshIdx]; P.charging = false; P.charge = 0; }
      // force-equip the matching milestone armor set the exact millisecond the
      // weapon slot unlocks (the KRATOS skin at Lv50 is only claimed via the Mark)
      if (m.armor) { P.currentArmor = m.armor; P.armorBroken = false; }
      if (m.level === 50) {
        // End-Game Altar Room — teleport the boy to the Mark of Krazality
        // (spawnAltar guards against double-fire)
        spawnAltar();
      }
      AudioSys.win();
      toast(m.banner, false, 3200);
      burst(cx(), P.y - 10, m.color, 22, { size: 2, life: 0.8, sp0: 60, sp1: 220 });
    }
  }

  updateHUD();
  if (skillsOpen) updateSkillsUI();
}

/* ------------------ Level 10 Faction Class choice ------------------------- */
function openFactionChoice() {
  if (factionChoiceOpen || G.faction) return;
  factionChoiceOpen = true;
  G.paused = true; // freeze the game loop behind the pixel popup
  input.attackQueued = false; input.jumpPressed = false; input.castQueued = false;
  $('factionScreen').classList.remove('hidden');
  AudioSys.ui();
}

// The chosen path is permanent for the run. Slot expansion, armor injection, and
// the synergy bonus all happen in ONE synchronous block — the exact same
// millisecond — then the boy auto-wields the new Slot 2 weapon immediately.
function chooseFaction(id) {
  const D = FACTION_DEFS[id];
  if (!D || G.faction || !factionChoiceOpen) return;
  G.faction = id;
  // --- unified block: hotbar expands to exactly 2 slots + armor force-equipped ---
  P.inventory = ['GLOVE', D.weapon];
  P.activeSlot = 1;                  // auto-select Slot 2 → boy wields it instantly
  weapon = D.weapon;
  P.currentArmor = D.armor;
  P.armorBroken = false;
  if (D.weapon === 'REPEATER') { MAX_AMMO = 50; ammo = MAX_AMMO; } // Void Hunter synergy
  if (D.weapon === 'AEGIS') { G.shieldHearts++; }                  // Paladin synergy
  // --- close the popup + resume the game ---
  factionChoiceOpen = false;
  G.paused = false;
  $('factionScreen').classList.add('hidden');
  AudioSys.win();
  flashFade();
  burst(cx(), P.y - 10, D.color, 26, { size: 2, life: 0.7, sp0: 60, sp1: 220 });
  toast(D.banner, false, 3200);
  updateHUD();
}

/* -------------- Level 12 secret — the Chrono hourglass ------------------- */
// Materializes near a high platform the moment the boy hits Level 12. Touching
// it pushes the Chrono-Scythe into hotbar Slot 3 and force-equips the deep
// neon-blue Chrono-Guard plate over the current armor sprite.
function spawnHourglass() {
  if (hourglass || G.chronoGot) return;
  // prefer a high solid platform just ahead of the boy; fall back to the steps
  let target = null;
  for (const pl of platforms) {
    if (pl.type !== 'solid' || pl.y >= 160) continue;        // "high" platform only
    if (pl.x > P.x - 80 && pl.x < P.x + 800) { target = pl; break; }
  }
  if (!target) {
    // the top stair, else the bonus ammo island above the bouncy pad
    const step = platforms.find((pl) => Math.abs(pl.x - 3700) < 60)
      || platforms.find((pl) => Math.abs(pl.x - 1490) < 60);
    target = step || { x: 3690, y: 110, w: 100 };
  }
  hourglass = { x: target.x + target.w / 2 - 6, y: target.y - 16, w: 12, h: 16, t: 0, taken: false };
}

function claimChrono() {
  if (G.chronoGot || !hourglass) return;
  G.chronoGot = true;
  hourglass = null;
  // unified block — Slot 3 push + Chrono-Guard plate injection in one frame
  if (!P.inventory.includes('CHRONO_SCYTHE')) P.inventory.push('CHRONO_SCYTHE');
  P.activeSlot = P.inventory.indexOf('CHRONO_SCYTHE');
  weapon = 'CHRONO_SCYTHE';
  P.currentArmor = 'CHRONO_GUARD';
  P.armorBroken = false;
  G.milestones[12] = true; // the secret is claimed
  AudioSys.win();
  flashFade(); shakeScreen(8);
  explode(cx(), P.y, COLORS.cyan, 40);
  burst(cx(), P.y + P.h / 2, '#b8fbff', 26, { size: 2, life: 0.7, sp0: 60, sp1: 240 });
  toast('CHRONO SET UNLOCKED!', false, 3600);
  updateHUD();
}

// Touching the Mark of Krazality permanently overrides the hotbar: the 5-slot
// array is deleted and the legendary KRATOS layout is activated simultaneously.
function claimKratos() {
  if (G.kratosClaimed) return;
  G.kratosClaimed = true;
  markOfKrazality = null; // the artifact is consumed by the awakening
  // delete all 5 previous slots — force BLADES OF CHAOS into a single locked slot
  P.inventory = ['BLADES_OF_CHAOS'];
  P.activeSlot = 0;
  weapon = 'BLADES_OF_CHAOS';
  P.currentArmor = 'KRATOS';
  P.qLocked = true;                 // 'Q' cycle permanently disabled
  P.armorBroken = false;
  G.kratosHearts = 2;               // 2 neon-red Armor Hearts guard the skin
  G.rage = 100;                     // Rage Meter wakes full
  hordeActive = true;               // endless victory-lap Glitch-Hedgehog horde
  AudioSys.win();
  flashFade(); shakeScreen(12);
  explode(cx(), P.y, COLORS.red, 50);
  burst(cx(), P.y + P.h / 2, '#ffffff', 24, { size: 2, life: 0.6, sp0: 60, sp1: 240 });
  showLegendBanner();
  toast('LEGENDARY POWER AWAKENED: THE GHOST OF KRAZALITY', false, 4200);
  updateHUD();
}

// Both neon-red Armor Hearts are gone — the KRATOS skin shatters. The boy reverts
// to his normal sprite and his standard level-appropriate weapon cycle (Q is
// re-enabled; the Rage Meter and the victory-lap horde end with the skin).
function shatterKratosSkin() {
  G.kratosHearts = 0;
  G.rage = 0; G.rageActive = false; G.rageT = 0;
  hordeActive = false;
  P.armorBroken = false;
  P.qLocked = false;
  G.kratosClaimed = false;
  applyMilestone(); // rebuild the standard level-appropriate loadout (Q works again)
  P.currentArmor = 'NONE'; // the spec'd revert to the normal sprite always sticks (even at the level cap)
  AudioSys.void();
  flashFade();
  burst(cx(), P.y + P.h / 2, '#ffffff', 24, { size: 2, life: 0.6, sp0: 60, sp1: 240 });
  toast('THE KRATOS SKIN SHATTERED — BACK TO THE ARSENAL!', true, 3000);
}

// Teleport the boy into the End-Game Altar Room and place the Mark of Krazality.
// Triggered by the Level 50 cap milestone (the guard keeps it from double-firing).
function spawnAltar() {
  if (G.altarSpawned || !gate) return;
  G.altarSpawned = true;
  P.x = gate.x - 96; P.y = 196 - P.h; P.vx = 0; P.vy = 0;
  respawn = { x: P.x, y: P.y };
  markOfKrazality = { x: gate.x - 40, y: 176, w: 16, h: 16, t: 0, taken: false };
  flashFade(); shakeScreen(12);
  explode(cx(), P.y, COLORS.red, 40);
  explode(cx(), P.y, COLORS.orange, 30);
}

/* -------------- changeable armor (glove + casualwear base) ---------------- */
// The boy starts in casualwear. At Level 10 the three faction armor sets become
// available and 'C' cycles between them (plus the Chrono plate at Lv12+). The
// KRATOS awakening is a permanent override and is never in the cycle.
function armorCycleList() {
  // each armor set unlocks alongside its matching weapon milestone
  const sets = ['NONE'];
  if (G.level >= 10) sets.push('VOID_HUNTER');
  if (G.level >= 20) sets.push('PALADIN');
  if (G.level >= 30) sets.push('JUGGERNAUT');
  if (G.chronoGot) sets.push('CHRONO_GUARD');
  return sets;
}

function cycleArmor() {
  if (G.kratosClaimed) return; // the KRATOS awakening is a permanent override
  const sets = armorCycleList();
  const i = sets.indexOf(P.currentArmor);
  const next = sets[(i + 1) % sets.length];
  P.currentArmor = next;
  P.armorBroken = false; // fresh set injection re-equips the armor
  if (next === 'PALADIN' && !G.paladinHeart) { // Aegis Paladin synergy: +1 Shield Heart
    G.paladinHeart = true;
    G.shieldHearts++;
  }
  AudioSys.ui();
  toast(`ARMOR: ${ARMOR_NAMES[next] || next}`, false, 1400);
  updateHUD();
}

// Full-screen dramatic pixel-text animation when the KRATOS set awakens.
function showLegendBanner() {
  const el = $('legendBanner');
  el.classList.remove('hidden');
  el.style.opacity = '0';
  el.style.transform = 'scale(1.4)';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'scale(1)';
  }));
  clearTimeout(legendBannerT);
  legendBannerT = setTimeout(() => el.classList.add('hidden'), 3800);
}

// single-frame melee strike (Aegis / Chrono-Scythe / Blades of Chaos)
// World-space strike zone for forward melee attacks — a flat rectangle in front
// of the boy (never a huge square around his center), so hits land exactly where
// the weapon visuals swing. Enemy bodies are tested rect-vs-rect: a partially
// overlapping target counts, but a target 2 tiles above/below the boy does not.
function meleeBox(range, omni = false) {
  if (omni) {
    // Krazal Rage 360° spin vortex — centered on the boy, body-height tall
    return { x: cx() - range, y: P.y - 8, w: range * 2, h: P.h + 16 };
  }
  const top = P.y + 1, bot = P.y + P.h - 3; // torso band — head & feet excluded
  return P.facing > 0
    ? { x: cx() + 1, y: top, w: range - 1, h: bot - top }
    : { x: cx() - range, y: top, w: range - 1, h: bot - top };
}

function meleeStrike(dmg, range, omni = false) {
  const box = meleeBox(range, omni);
  for (const e of enemies) {
    if (e.dead) continue;
    if (!overlap(box, e)) continue; // accurate rect-vs-body reach — no phantom hits
    const executed = damageEnemy(e, dmg, null, true);
    // SOUL siphon: only the Krazal Boxing Glove (via doSlashHit) and the
    // Chrono-Scythe are siphon melee — Aegis & Blades deal no SOUL.
    if (!executed && weapon === 'CHRONO_SCYTHE') gainSoul(10); // executes already paid +20 SOUL
    if (weapon === 'BLADES_OF_CHAOS') G.rage = Math.min(100, G.rage + 3); // blade hits fuel the Rage Meter
    if (G.rageActive) {                                     // Krazal Rage: +2 HP + +10 SOUL lifesteal per hit
      let rageTextY = P.y - 12;
      if (G.hp < MAX_HP) {
        G.hp = Math.min(MAX_HP, G.hp + 2);
        flashHearts();
        addFloatText(cx(), rageTextY, '+2 HP', '#ff6b5e');
        rageTextY -= 10;                                    // stack the second popup above
      }
      if (G.soul < MAX_SOUL) {                              // only siphon SOUL if there's room
        gainSoul(10);                                       // rage hits siphon +10 Dimension SOUL
        addFloatText(cx(), rageTextY, '+10 SOUL', '#b8fbff');
      }
      updateHUD();
    }
    if (dmg >= 2) { e.kb = P.facing * 170; e.kbTime = 0.18; } // heavier weapons shove
  }
}

function fireRailgun() {
  if (ammo <= 0) {
    P.charging = false; P.charge = 0;
    AudioSys.clink();
    toast('RAILGUN DRY! DEFEAT WOBBLE-BATS FOR AMMO', true);
    return;
  }
  ammo--;
  const pow = clamp(P.charge / 1.5, 0, 1); // 1.5s full charge pierces everything
  arrows.push({
    x: cx() + P.facing * 18, y: P.y + 8, w: 8, h: 6,
    vx: P.facing * (500 + pow * 320), vy: 0,
    life: 1.6, dead: false, dmg: 2 + Math.round(pow * 3), rail: true,
    pierce: pow >= 0.98, hit: new Set(),
  });
  AudioSys.hammer();
  shakeScreen(3 + pow * 4);
  freeze = Math.max(freeze, 0.04);
  burst(cx() + P.facing * 16, P.y + 8, COLORS.yellow, 6 + Math.round(pow * 8), { size: 2, life: 0.3, sp0: 80, sp1: 260 });
  P.vx -= P.facing * 120 * (0.5 + pow); // recoil
  P.charging = false; P.charge = 0;
  updateHUD();
}

function doAttack() {
  if (weaponCd > 0) return;
  if (weapon === 'GLOVE') {
    // KRAZAL BOXING GLOVE — lightning-fast jab, zero cooldown
    slashT = 0.12;
    P.slashAnim = 0.12;
    slashHitSet.clear();
    P.vx += P.facing * 30;
    AudioSys.slash();
    weaponCd = 0;
  } else if (weapon === 'REPEATER') {
    // VOID REPEATER — 3-shot plasma burst, 3 ammo per click; hits build the combo
    // multiplier (a whiffed burst resets it to 1x), x5 doubles damage
    if (ammo < 3) {
      AudioSys.clink();
      toast('NO AMMO! DEFEAT WOBBLE-BATS FOR AMMO', true);
      weaponCd = 0.4;
      return;
    }
    ammo -= 3;
    P.bowAnim = 0.2;
    const dmg = repStreak >= 5 ? 2 : 1; // x5 streak combo → double damage
    const burst = ++repBurst;
    for (let i = 0; i < 3; i++) {
      arrows.push({ x: cx() + P.facing * 12, y: P.y + 10 + (i - 1) * 3, w: 5, h: 5, vx: P.facing * (420 + i * 60), vy: 0, life: 1.8, dead: false, dmg, bolt: true, rep: true, burst });
    }
    AudioSys.arrow();
    weaponCd = G.skills.quickDraw ? 0 : 0.42; // Quick Draw: rapid fire
    updateHUD();
  } else if (weapon === 'AEGIS') {
    // AEGIS VANGUARD — raises an energy shield barrier: deals 0 base damage; the
    // game is the tight 0.2s parry window (reflects projectiles + awards +30 SOUL)
    P.aegisT = 0.3;
    P.parryT = 0.2;
    AudioSys.hammer();
    weaponCd = 0.6;
  } else if (weapon === 'RAILGUN') {
    // OVERCHARGED RAILGUN — hold to charge, release to fire
    if (ammo <= 0) {
      AudioSys.clink();
      toast('RAILGUN DRY! DEFEAT WOBBLE-BATS FOR AMMO', true);
      weaponCd = 0.4;
      return;
    }
    if (!P.charging) { P.charging = true; P.charge = 0; }
  } else if (weapon === 'CHRONO_SCYTHE') {
    // CHRONO-SCYTHE — sweeping arc with a 50ms blue/white stroke path
    P.scytheT = 0.05;
    P.slashAnim = 0.16;
    AudioSys.slash();
    meleeStrike(2, G.skills.sharpEdge ? 54 : 42);
    weaponCd = 0.34;
  } else if (weapon === 'BLADES_OF_CHAOS') {
    // BLADES OF CHAOS — 120px plasma chain whips (doubled to 240px during Rage);
    // omni-directional 360° spin vortex while Rage is active
    P.slashAnim = 0.13;
    AudioSys.slash();
    AudioSys.arrow();
    meleeStrike(3, G.rageActive ? 240 : 120, G.rageActive);
    weaponCd = G.rageActive ? 0.15 : 0.24;
  }
}

function doSlashHit() {
  if (slashT <= 0) return;
  const box = meleeBox(G.skills.sharpEdge ? 48 : 32);       // Sharp Edge: +50% range
  for (const e of enemies) {
    if (e.dead) continue;
    if (slashHitSet.has(e)) continue;                       // one hit per stab
    if (!overlap(box, e)) continue;                         // jab zone vs enemy body rect
    if (e.kind === 'hedgehog') {
      // spikes face the hedgehog's movement direction — front stabs get blocked
      const onSpikeSide = (P.x + P.w / 2 < e.cx) ? e.facing === -1 : e.facing === 1;
      if (onSpikeSide) {
        slashHitSet.add(e);
        AudioSys.clink();
        sparks(e.cx + (e.facing * 8), e.cy, COLORS.white, 6);
        P.vx = -e.facing * 140; P.stun = 0.16;
        weaponCd = Math.max(weaponCd, 0.25);
        continue;
      }
    }
    slashHitSet.add(e);
    // KNOCKOUT FRAME — striking an enemy already under 25% health launches it
    // vertically off-screen: double SOUL (+20) + a 0.5s invincibility frame
    if (e.kind !== 'golem' && e.hp <= Math.max(1, Math.ceil((e.maxHp || 1) * 0.25))) {
      e.ko = true; e.koVy = -620; e.koVx = P.facing * 30;
      gainSoul(20);
      P.iframes = Math.max(P.iframes, 0.5);
      G.kills++;
      freeze = Math.max(freeze, 0.05); // execution blow — 50ms hit freeze
      addDust(enemyDust(e));
      addFloatText(e.cx, e.cy - 18, `+${enemyDust(e)}`, e.color);
      addFloatText(e.cx, e.cy - 8, 'KNOCKOUT! +20 SOUL', '#ffb3c6');
      AudioSys.kill();
      burst(e.cx, e.cy, e.color, 10, { size: 2, life: 0.4, sp0: 60, sp1: 220 });
      if (e.kind === 'bat') {
        pickups.push({ type: 'ammo', x: e.x, y: e.y, w: 8, h: 10, grounded: false, vx: rnd(-30, 30), vy: -140, t: rnd(TAU) });
      }
      continue;
    }
    // standard jab — 1 dmg, +10 SOUL siphon, 40px shove for space management
    if (!damageEnemy(e, 1, null, true)) {
      gainSoul(10); // Glove strikes channel Dimension SOUL
      e.kb = P.facing * 200; e.kbTime = 0.2; // 40px shove on impact
    }
  }
}

/* ------------------------------ arrows & waves ----------------------------- */
function updateArrows(dt) {
  // backward iteration so off-screen / expired projectiles are spliced straight
  // out of memory the instant they breach (camX + canvas.width) or (camX - 100)
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    a.vy = Math.min(a.vy + 25 * dt, 120);   // nearly straight, gentle drop
    a.x += a.vx * dt; a.y += a.vy * dt;
    a.life -= dt;
    if (a.life <= 0 || a.x < 0 || a.x > LEVEL_W || a.x > camX + canvas.width || a.x < camX - 100) {
      if (a.rep) repBoltWhiffed(a);
      arrows.splice(i, 1);
      continue;
    }
    if (a.pierce) {
      // full-charge rail bolt tears straight through every enemy (and objects)
      for (const e of enemies) {
        if (e.dead || a.hit.has(e)) continue;
        if (overlap(a, e)) { a.hit.add(e); damageEnemy(e, a.dmg || 3); }
      }
      continue;
    }
    let hit = false;
    for (const pl of platforms) {
      if (solid(pl) && overlap(a, pl)) { sparks(a.x, a.y, COLORS.white, 3); hit = true; if (a.rep) repBoltWhiffed(a); break; }
    }
    if (!hit) {
      for (const e of enemies) {
        if (e.dead) continue;
        if (overlap(a, e)) {
          damageEnemy(e, a.dmg || 1);
          if (a.rep) {
            // any landed bolt builds the combo (not just kills)
            repStreak++;
            repStreakT = 2.0;
            burstHit.add(a.burst);
            if (!arrows.some((o) => o !== a && o.rep && o.burst === a.burst)) burstHit.delete(a.burst);
            if (repStreak >= 5 && !repToastShown) {
              repToastShown = true;
              toast('X5 REPEATER STREAK — DOUBLE DAMAGE!', false, 1400);
            }
          }
          hit = true;
          break;
        }
      }
    }
    if (hit) arrows.splice(i, 1);
  }
}

// A repeater bolt that fails to connect (expired / off-screen / wall): if it was
// the last surviving bolt of its 3-shot burst and the burst never landed a hit,
// the combo multiplier resets to 1x.
function repBoltWhiffed(a) {
  const burstAlive = arrows.some((o) => o !== a && o.rep && o.burst === a.burst);
  if (!burstAlive) {
    const landed = burstHit.has(a.burst);
    burstHit.delete(a.burst);
    if (!landed) { repStreak = 0; repToastShown = false; }
  }
}

function updateWaves(dt) {
  for (const w of waves) {
    w.x += w.dir * w.speed * dt;
    w.life -= dt;
    if (w.friendly) {
      // an Aegis-reflected wave now hunts enemies instead
      for (const e of enemies) {
        if (e.dead) continue;
        if (overlap(w, e)) { damageEnemy(e, 2); w.life = 0; break; }
      }
    } else if (P.parryT > 0 && overlap(w, P) && G.state === 'play') {
      // perfectly timed Aegis parry — reflect the shockwave + stun its golem 1.5s
      w.dir *= -1; w.friendly = true; w.speed = 330; w.life = 2.5;
      P.parryT = 0;
      AudioSys.clink();
      freeze = Math.max(freeze, 0.15); // freeze-frame
      sparks(w.x, w.y, '#ffa3ec', 10);
      // stun the golem that fired the reflected wave (freeze frame for 1.5s)
      if (w.owner && w.owner.kind === 'golem' && !w.owner.dead) {
        w.owner.phase = 'stunned';
        w.owner.timer = 1.5;
      }
      gainSoul(30);
      toast('PERFECT PARRY! +30 SOUL', false, 1200);
    } else if (overlap(w, P) && G.state === 'play' && P.iframes <= 0) {
      hurtPlayer(w.dir);
    }
  }
  waves = waves.filter((w) => w.life > 0 && w.x > -50 && w.x < LEVEL_W + 50 && w.x > camX - 100 && w.x < camX + canvas.width + 50);
}

/* ------------------- hammer shockwave (player-side) ----------------------- */
function updateShocks(dt) {
  for (const s of shocks) {
    s.x += s.dir * s.speed * dt;
    s.life -= dt;
    s.t += dt;
    for (const e of enemies) {
      if (e.dead) continue;
      if (overlap(s, e)) {
        damageEnemy(e, 3);                        // extreme damage
        gainSoul(10);                             // Hammer slams channel SOUL
        if (e.kind !== 'golem') { e.kb = s.dir * 260; e.kbTime = 0.24; } // shove back
      }
    }
    // vaporize golem shockwaves on contact
    for (let i = waves.length - 1; i >= 0; i--) {
      if (Math.abs(waves[i].x - s.x) < 40 && Math.abs(waves[i].y - s.y) < 30) {
        explode(waves[i].x, waves[i].y, COLORS.orange, 10);
        waves.splice(i, 1);
        s.dead = true;
        break;
      }
    }
  }
  shocks = shocks.filter((s) => s.life > 0 && !s.dead && s.x > camX - 100 && s.x < camX + canvas.width + 40);
}

/* ------------------------------ SOUL magic ---------------------------------- */
function gainSoul(n) {
  const before = G.soul;
  G.soul = Math.min(MAX_SOUL, G.soul + n);
  if (G.soul !== before) {
    updateSoulHUD();
    pulseSoul();
  }
}

function castSpell() {
  if (castCd > 0) return;
  if (G.soul < FOCUS_COST) {
    AudioSys.clink();
    toast('NOT ENOUGH SOUL! STRIKE ENEMIES TO CHARGE', true);
    castCd = 0.3;
    return;
  }
  G.soul -= FOCUS_COST;
  castCd = 0.35;
  spells.push({ x: cx() + P.facing * 16, y: P.y + 8, w: 26, h: 14, dir: P.facing, speed: 380, life: 1.4, t: 0, hit: new Set() });
  AudioSys.soul();
  burst(cx() + P.facing * 10, P.y + 8, COLORS.cyan, 6, { size: 2, life: 0.3, sp0: 30, sp1: 90 });
  shakeScreen(2);
  updateSoulHUD();
}

function updateSpells(dt) {
  for (const s of spells) {
    s.t += dt;
    s.x += s.dir * s.speed * dt;
    s.life -= dt;
    // roaring glitch trail
    if (Math.random() < dt * 40) {
      const gpal = [COLORS.cyan, COLORS.purple, '#ffffff'];
      addParticle({ kind: 'pixel', x: s.x - s.dir * rnd(6, 14), y: s.y + rnd(-6, 6), vx: -s.dir * rnd(20, 60), vy: rnd(-15, 15), life: rnd(0.15, 0.35), color: gpal[rndi(0, 2)], size: 2, grav: 0 });
    }
    // pierces through every enemy — each struck exactly once
    for (const e of enemies) {
      if (e.dead || s.hit.has(e)) continue;
      if (overlap(s, e)) {
        s.hit.add(e);
        damageEnemy(e, 3); // high damage
        if (e.kind !== 'golem') { e.kb = s.dir * 200; e.kbTime = 0.22; }
      }
    }
    // tears golem shockwaves apart
    for (let i = waves.length - 1; i >= 0; i--) {
      if (Math.abs(waves[i].x - s.x) < 34 && Math.abs(waves[i].y - s.y) < 26) {
        explode(waves[i].x, waves[i].y, COLORS.orange, 8);
        waves.splice(i, 1);
      }
    }
  }
  spells = spells.filter((s) => s.life > 0 && s.x > -60 && s.x < LEVEL_W + 60 && s.x > camX - 100 && s.x < camX + canvas.width + 60);
}

/* ------------------------------ player -------------------------------------- */
function hurtPlayer(dir) {
  if (P.iframes > 0 || P.hamWindup > 0) return;
  if (G.armor > 0) {
    // the Knight Helm shatters instead of the boy taking the hit
    G.armor = 0;
    P.iframes = 1.2;
    breakFocus(); // armor blocking during the window also kills the Focus channel
    AudioSys.clink();
    shakeScreen(3);
    sparks(cx(), P.y - 4, '#c9ced6', 10);
    burst(cx(), P.y - 6, '#8f9aa6', 8, { sp0: 60, sp1: 200 });
    toast('KNIGHT HELM SHATTERED!', true);
    updateHUD();
    return;
  }
  if (G.shieldHearts > 0) {
    // a permanent PALADIN Shield Heart absorbs the blow
    G.shieldHearts--;
    P.iframes = 1.2;
    breakFocus(); // absorbed blows still break any Focus channel
    AudioSys.clink();
    shakeScreen(3);
    sparks(cx(), P.y - 4, COLORS.purple, 10);
    burst(cx(), P.y - 6, '#8f6ab8', 8, { sp0: 60, sp1: 200 });
    toast('SHIELD HEART DESTROYED!', true);
    updateHUD();
    return;
  }
  // KRATOS — the 2 neon-red Armor Hearts absorb heavy blows instead of the boy.
  // Shattering the last one removes the skin and returns the standard arsenal.
  if (P.currentArmor === 'KRATOS' && G.kratosHearts > 0 && !G.rageActive) {
    G.kratosHearts--;
    P.iframes = 1.2;
    breakFocus();
    P.hurtFlash = 0.18;
    AudioSys.clink();
    shakeScreen(4);
    sparks(cx(), P.y - 4, COLORS.red, 12);
    burst(cx(), P.y - 6, '#ff6b6b', 10, { sp0: 60, sp1: 220 });
    G.rage = Math.min(100, G.rage + 15); // taking hits fuels the Rage Meter
    if (G.kratosHearts <= 0) {
      shatterKratosSkin();
    } else {
      toast('NEON ARMOR HEART SHATTERED!', true);
    }
    updateHUD();
    return;
  }
  // heavy damage shatters the milestone armor — the visual overlay and passive
  // synergies are lost, but every unlocked weapon slot is kept (Q still cycles)
  if (!P.armorBroken && P.currentArmor !== 'NONE' && P.currentArmor !== 'KRATOS' && !G.rageActive) {
    P.armorBroken = true;
    P.iframes = 1.2;
    breakFocus(); // heavy hit breaks any Focus channel — committed SOUL is lost
    P.stun = 0.24;
    P.vx = dir * 320;
    P.vy = -220;
    P.hurtFlash = 0.18;
    AudioSys.hit();
    AudioSys.clink();
    shakeScreen(4);
    burst(cx(), P.y - 6, '#8f9aa6', 14, { sp0: 60, sp1: 220 });
    toast('MILESTONE ARMOR SHATTERED!', true);
    updateHUD();
    return;
  }
  // a strike while Focus is channeling breaks the channel — the committed 33 SOUL
  // is permanently deleted and no health point is restored
  breakFocus();
  G.hp--;
  updateHUD();
  if (G.hp <= 0) { killPlayer(); return; }
  P.iframes = 1.1;
  P.stun = 0.24;
  P.vx = dir * 320;
  P.vy = -220;
  AudioSys.hit();
  shakeScreen(5, 0.2, true); // 200ms horizontal screen shake on damage
  freeze = Math.max(freeze, 0.04);
  P.hurtFlash = 0.18;
  sparks(cx(), P.y + P.h / 2, COLORS.red, 8);
  if (G.kratosClaimed && !G.rageActive) G.rage = Math.min(100, G.rage + 15); // taking hits fuels the Rage Meter
}

function solid(pl) {
  return pl.type === 'solid' || pl.type === 'bouncy' || (pl.type === 'ghost' && pl.alpha > 0.55);
}

function updatePlayer(dt) {
  const left = LEFT_KEYS.some((k) => input.keys.has(k));
  const right = RIGHT_KEYS.some((k) => input.keys.has(k));
  const jumpHeld = JUMP_KEYS.some((k) => input.keys.has(k));

  // --- horizontal ---
  if (P.stun > 0) {
    P.stun -= dt;
    P.vx *= (1 - 6 * dt);
  } else {
    // Krazal Glove passive: +25% movement speed. RAILGUN charge slows you down
    // (JUGGERNAUT set raises the charge speed cap to 85%; Krazal Rage doubles it).
    const runSpd = (weapon === 'GLOVE' ? RUN_SPD * 1.25 : RUN_SPD)
      * (P.charging ? (P.currentArmor === 'JUGGERNAUT' && !P.armorBroken ? 0.85 : 0.45) : 1)
      * (G.rageActive ? 2 : 1);
    const target = (right ? runSpd : 0) + (left ? -runSpd : 0);
    const acc = P.onGround ? ACCEL : AIR_ACC;
    if (left !== right) {
      P.vx = approach(P.vx, target, acc * dt);
      if (!right) P.facing = -1;
      else P.facing = 1;
    } else {
      P.vx = approach(P.vx, 0, FRICTION * dt);
    }
  }

  // --- jumping (coyote + buffer + Dimension Hopper double jump) ---
  P.coyote = P.onGround ? 0.1 : P.coyote - dt;
  P.jumpBuf -= dt;
  if (input.attackQueued) { if (G.state === 'play') doAttack(); input.attackQueued = false; }
  if (input.castQueued) { if (G.state === 'play') castSpell(); input.castQueued = false; }
  if (input.jumpPressed) { P.jumpBuf = 0.12; input.jumpPressed = false; }
  const groundJump = P.jumpBuf > 0 && P.coyote > 0;
  const airJump = !groundJump && P.jumpBuf > 0 && G.skills.doubleJump && P.coyote <= 0 && P.jumpsUsed < 2;
  if (groundJump || airJump) {
    P.vy = -JUMP_V;
    P.onGround = false; P.coyote = 0; P.jumpBuf = 0;
    P.jumpsUsed++;
    P.sqv = 0.45;
    AudioSys.jump();
    dust(P.x + P.w / 2, bottom(), 4, COLORS.white);
    if (airJump) {
      dust(P.x + P.w / 2, bottom(), 6, COLORS.cyan);
      particles.push({ kind: 'ring', x: cx(), y: bottom(), r: 4, vr: 130, life: 0.25, color: COLORS.cyan });
    }
  }
  if (!jumpHeld && P.vy < -170) P.vy = -170; // variable jump height

  // --- RAILGUN hold-charge cycle: accumulate charge while the attack is held ---
  if (weapon === 'RAILGUN' && P.charging) {
    const held = mouseDown || ['KeyF', 'KeyJ', 'KeyX'].some((k) => input.keys.has(k));
    if (held) {
      P.charge = Math.min(P.charge + dt, 1.5); // 1.5s to reach the piercing overcharge
      // white/yellow crackle sparks during the hold-charge cycle
      if (Math.random() < dt * 26) sparks(cx() + P.facing * 18, P.y + rnd(2, 12), '#ffffff', 1);
      if (Math.random() < dt * 22) sparks(cx() + P.facing * 18, P.y + rnd(2, 12), COLORS.yellow, 1);
    } else {
      fireRailgun(); // released — fire!
    }
  }

  // --- Focus (R): commit 33 SOUL, then stand perfectly still for 1.2s ---
  // The cost is spent the instant the channel begins. If the boy is struck — or
  // his armor blocks — during the window, the channel breaks and the spent SOUL
  // is permanently deleted with no health point restored.
  const canFocus = input.keys.has('KeyR') && P.onGround && !left && !right && Math.abs(P.vx) < 5 && P.stun <= 0 && G.hp < MAX_HP && G.soul >= FOCUS_COST;
  if (canFocus && P.focusT === 0) {
    G.soul -= FOCUS_COST; // 33 SOUL committed up-front
    updateSoulHUD();
    AudioSys.ui();
  }
  if (canFocus) {
    P.focusT += dt;
    if (P.focusT >= 1.2) completeFocus();
    // swirling white pixels while channeling
    if (Math.random() < dt * 34) {
      addParticle({ kind: 'pixel', x: cx() + rnd(-7, 7), y: P.y + rnd(-16, P.h - 4), vx: rnd(-24, 24), vy: rnd(-46, -8), life: rnd(0.2, 0.42), color: '#ffffff', size: 2, grav: 30 });
    }
  } else if (P.focusT > 0) {
    // moving, airborne, full HP, out of SOUL, or released early — the committed
    // SOUL is already spent and the heal is forfeit
    P.focusT = 0;
  }

  // --- gravity ---
  P.vy = Math.min(P.vy + GRAV * dt, MAX_FALL);

  // --- move + collide (per-axis, pixel-perfect AABB) ---
  const prevBottom = bottom();
  const prevGround = P.onGround;
  P.onGround = false;

  P.x += P.vx * dt;
  for (const pl of platforms) {
    if (!solid(pl)) continue;
    if (overlap(P, pl)) {
      if (P.vx > 0) P.x = pl.x - P.w;
      else if (P.vx < 0) P.x = pl.x + pl.w;
      P.vx = 0;
    }
  }
  P.x = clamp(P.x, 0, LEVEL_W - P.w);

  P.y += P.vy * dt;
  // pass 1 — bouncy pads get priority on landings, so pads sitting flush with
  // the ground aren't shadowed by the solid platform underneath them
  for (const pl of platforms) {
    if (pl.type !== 'bouncy' || !overlap(P, pl)) continue;
    if (P.vy >= 0 && (bottom() - pl.y) <= (pl.y + pl.h - P.y) && cx() >= pl.x && cx() <= pl.x + pl.w) {
      P.y = pl.y - P.h;
      P.vy = -BOUNCE_V;
      P.sqv = 0.55;
      pl.bounceT = 0.2;
      AudioSys.bounce();
      dust(cx(), bottom(), 8, COLORS.pink);
      shakeScreen(2);
      P.onGround = true;
    }
  }
  // pass 2 — everything solid (bouncy pads included as plain solid ground)
  for (const pl of platforms) {
    if (!solid(pl)) continue;
    if (overlap(P, pl)) {
      const fromTop = P.vy >= 0 && (bottom() - pl.y) <= (pl.y + pl.h - P.y);
      if (fromTop) {
        P.y = pl.y - P.h;
        if (!prevGround && P.vy > 320) { AudioSys.land(); dust(cx(), bottom(), 5, COLORS.white); }
        P.vy = 0;
        P.onGround = true;
      } else {
        P.y = pl.y + pl.h;
        P.vy = Math.max(0, P.vy);
      }
    }
  }

  // --- landing squash ---
  if (!prevGround && P.onGround && prevBottom < P.y + 1) {
    P.sqv = -0.22;
  }
  if (P.onGround) P.jumpsUsed = 0; // being grounded refills the jump counter

  // --- void death ---
  if (P.y > VOID_Y) {
    dieInVoid();
  }

  // --- timers ---
  P.iframes = Math.max(0, P.iframes - dt);
  P.slashAnim = Math.max(0, P.slashAnim - dt);
  P.bowAnim = Math.max(0, P.bowAnim - dt);
  P.hamSlam = Math.max(0, P.hamSlam - dt);
  P.hurtFlash = Math.max(0, P.hurtFlash - dt);
  P.sq = approach(P.sq, 0, dt * 5);
  P.sqv = approach(P.sqv, 0, dt * 8);
  P.sq += P.sqv;
  P.anim += dt;
  if (Math.abs(P.vx) > 20 && P.onGround) P.runPhase += dt * Math.abs(P.vx) * 0.085;
  else P.runPhase *= (1 - 8 * dt);
  slashT = Math.max(0, slashT - dt);
  if (slashT > 0) doSlashHit();
  weaponCd = Math.max(0, weaponCd - dt);
  castCd = Math.max(0, castCd - dt);
  P.aegisT = Math.max(0, P.aegisT - dt);
  P.scytheT = Math.max(0, P.scytheT - dt);
  P.parryT = Math.max(0, P.parryT - dt);
  repStreakT -= dt;
  if (repStreakT <= 0) { repStreak = 0; repToastShown = false; } // repeater streak decays after 2s idle

  // --- Krazal Rage timer + crimson aura ---
  if (G.rageT > 0) {
    G.rageT -= dt;
    if (G.rageT <= 0) { G.rageActive = false; toast('RAGE FADES...', true, 1400); }
    if (Math.random() < dt * 40) {
      addParticle({ kind: 'pixel', x: cx() + rnd(-10, 10), y: P.y + rnd(0, P.h), vx: rnd(-30, 30), vy: rnd(-40, 0), life: rnd(0.15, 0.3), color: COLORS.red, size: 2, grav: 0 });
    }
  }

  // --- milestone armor FX + VOID HUNTER ghost trail (disabled while armor is broken) ---
  if (P.currentArmor === 'VOID_HUNTER' && !P.armorBroken) {
    if (Math.abs(P.vx) > 20) P.trail.push({ x: P.x, y: P.y });
    if (P.trail.length > 10) P.trail.shift();
  } else {
    P.trail.length = 0;
  }
  if (P.currentArmor === 'CHRONO_GUARD' && !P.armorBroken && Math.random() < dt * 28) {
    // 1x1 white clockwork sparks off the deep-blue plates
    addParticle({ kind: 'pixel', x: cx() + rnd(-8, 8), y: P.y + rnd(0, P.h), vx: rnd(-20, 20), vy: rnd(-60, -12), life: rnd(0.08, 0.2), color: '#ffffff', size: 1, grav: 0 });
  }
  if (P.currentArmor === 'KRATOS' && !P.armorBroken && Math.random() < dt * 42) {
    // red pixel sparks off the ghost-white skin mesh
    addParticle({ kind: 'pixel', x: cx() + rnd(-8, 8), y: P.y + rnd(0, P.h), vx: rnd(-40, 40), vy: rnd(-70, -20), life: rnd(0.12, 0.3), color: Math.random() < 0.5 ? COLORS.red : '#ffd0d8', size: 1, grav: 0 });
  }

  // --- enemy contact damage ---
  if (P.iframes <= 0 && G.state === 'play') {
    for (const e of enemies) {
      if (e.dead || e.ko) continue; // KO-launched bodies can't damage the boy mid-arc
      const hb = { x: e.x + 2, y: e.y + 2, w: e.w - 4, h: e.h - 3 };
      if (e.kind === 'golem') { hb.x = e.x + 4; hb.w = e.w - 8; hb.y = e.y + 2; hb.h = e.h - 8; }
      if (overlap(P, hb)) hurtPlayer(P.x + P.w / 2 < e.cx ? -1 : 1);
    }
  }

  // --- checkpoints ---
  for (const c of checkpoints) {
    if (!c.on && Math.abs(cx() - c.x) < 24 && Math.abs(bottom() - c.y) < 30) {
      c.on = true;
      respawn = { x: c.x - 6, y: c.y - P.h - 2 };
      AudioSys.checkpoint();
      explode(c.x, c.y - 26, COLORS.cyan, 14);
      toast('CHECKPOINT REACHED!', false);
      updateHUD();
    }
  }

  // --- the Chrono hourglass (Level 12 secret unlock) ---
  if (hourglass && !hourglass.taken
    && Math.abs(cx() - (hourglass.x + 6)) < 20
    && Math.abs(P.y + P.h / 2 - (hourglass.y + 8)) < 26) {
    claimChrono();
  }

  // --- the Mark of Krazality (end-game altar artifact) ---
  if (markOfKrazality && !markOfKrazality.taken
    && Math.abs(cx() - (markOfKrazality.x + 8)) < 20
    && Math.abs(P.y + P.h / 2 - (markOfKrazality.y + 8)) < 26) {
    claimKratos();
  }

  // --- shards / gate win ---
  if (G.shards >= 3 && P.x + P.w > gate.x && P.x < gate.x + gate.w) {
    winGame();
  }
}

// an incoming hit (or armor block) during Focus breaks the channel — the 33 SOUL
// committed at the start is permanently deleted and no health point is restored
function breakFocus() {
  if (P.focusT > 0) {
    P.focusT = 0;
    toast('FOCUS INTERRUPTED — SOUL LOST!', true);
  }
}

function completeFocus() {
  // the 33 SOUL was already committed when the channel began — deliver the heal
  G.hp = Math.min(MAX_HP, G.hp + 1);
  AudioSys.heal();
  burst(cx(), P.y + P.h / 2, '#ffffff', 14, { size: 2, life: 0.6, sp0: 40, sp1: 150 });
  particles.push({ kind: 'ring', x: cx(), y: P.y + P.h / 2, r: 4, vr: 170, life: 0.4, color: '#ffffff' });
  P.focusT = 0;
  flashHearts();
  updateHUD();
  updateSoulHUD();
  toast('FOCUS COMPLETE — +1 HP!', false, 1500);
}

function respawnAtCheckpoint(msg) {
  freeze = Math.max(freeze, 0.18);
  shakeScreen(9);
  explode(cx(), P.y, COLORS.purple, 26);
  flashFade();
  P.x = respawn.x; P.y = respawn.y;
  P.vx = 0; P.vy = 0;
  P.iframes = 2.4;
  P.facing = 1;
  P.hamActive = false; P.hamWindup = 0; P.slashAnim = 0; P.bowAnim = 0; P.focusT = 0;
  P.charging = false; P.charge = 0; P.aegisT = 0; P.scytheT = 0; P.parryT = 0;
  P.armorBroken = false; // a fresh life re-equips the milestone armor
  toast(msg, true);
}

function dieInVoid() {
  AudioSys.void();
  G.deaths++;
  respawnAtCheckpoint('THE VOID CLAIMS YOU...');
}

function killPlayer() {
  // HP depleted — the boy is banished back to his last checkpoint, fully restored
  AudioSys.void();
  G.deaths++;
  G.hp = MAX_HP;
  updateHUD();
  respawnAtCheckpoint('YOU DIED — RETURNING TO CHECKPOINT...');
}

/* ------------------------------ particles ----------------------------------- */
function addParticle(p) { if (particles.length < 520) particles.push(p); }

function burst(x, y, color, n, opts = {}) {
  for (let i = 0; i < n; i++) {
    const ang = rnd(TAU), sp = rnd(opts.sp0 || 40, opts.sp1 || 180);
    addParticle({
      kind: 'pixel', x, y,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40,
      life: opts.life || rnd(0.3, 0.8),
      color,
      size: opts.size || rnd(1.5, 3.5),
      grav: opts.grav || 420,
      glitch: !!opts.glitch,
    });
  }
}
function explode(x, y, color, n) {
  // 2x2 pixel squares, gravity, fade after 0.5s
  burst(x, y, color, n, { size: 2, life: 0.5 });
  addParticle({ kind: 'flash', x, y, life: 0.18, color, r: 16 });
  addParticle({ kind: 'ring', x, y, r: 4, vr: 240, life: 0.3, color });
}
function sparks(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const ang = rnd(TAU), sp = rnd(120, 320);
    addParticle({ kind: 'spark', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rnd(0.12, 0.3), color, size: rnd(1, 2.5) });
  }
}
function dust(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    addParticle({ kind: 'pixel', x: x + rnd(-8, 8), y, vx: rnd(-50, 50), vy: rnd(-60, -10), life: rnd(0.2, 0.5), color, size: rnd(1.5, 3), grav: 160, fade: true });
  }
}
function updateParticles(dt) {
  for (const p of particles) {
    p.life -= dt;
    if (p.kind === 'pixel' || p.kind === 'spark') {
      p.vy += (p.grav || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    } else if (p.kind === 'ring') {
      p.r += p.vr * dt;
    } else if (p.kind === 'text') {
      p.y -= 26 * dt;
    } else if (p.kind === 'dustpuff') {
      p.x += p.vx * dt;
      p.dist += Math.abs(p.vx) * dt;
      if (p.dist >= p.maxDist) p.life = 0;
    }
  }
  // GC: any particle whose alpha has decayed to <= 0 is popped out of memory
  particles = particles.filter((p) => p.life > 0 && (p.alpha === undefined || p.alpha > 0));
}

/* ------------------------------ camera & fx --------------------------------- */
function shakeScreen(mag, dur = 0.35, horiz = false) {
  shakeMag = Math.max(shakeMag, mag);
  shakeT = Math.max(shakeT, dur);
  shakeHoriz = horiz; // a non-horizontal shake clears the horizontal mode
}
function flashFade() {
  const el = $('fadeFlash');
  el.style.transition = 'none'; el.style.opacity = '0.85';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transition = 'opacity 0.5s ease'; el.style.opacity = '0';
  }));
}

/* ------------------------------ rendering ----------------------------------- */
function drawPixelRect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), w, h); }

function glowRect(x, y, w, h, color, layers = 3) {
  for (let i = layers; i >= 1; i--) {
    ctx.globalAlpha = 0.06 * i;
    drawPixelRect(x - i, y - i, w + i * 2, h + i * 2, color);
  }
  ctx.globalAlpha = 1;
}

function drawPlatform(p) {
  const cx0 = p.x + p.w / 2, cy0 = p.y + p.h / 2;
  ctx.save();
  ctx.translate(cx0, cy0);
  ctx.rotate(p.tilt);
  const w2 = p.w / 2, h2 = p.h / 2;

  if (p.type === 'ghost') {
    ctx.globalAlpha = p.alpha;
    // 8-bit checkerboard ghost body
    drawPixelRect(-w2, -h2, p.w, p.h, '#4a3d10');
    for (let gx = -w2; gx < w2; gx += 8) {
      for (let gy = -h2; gy < h2; gy += 4) {
        if ((Math.round((gx + w2) / 8) + Math.round((gy + h2) / 4)) % 2 === 0) drawPixelRect(gx, gy, 8, 4, '#6b5a1a');
      }
    }
    drawPixelRect(-w2, -h2, p.w, 3, COLORS.yellow);
    ctx.globalAlpha = p.alpha * 0.2;
    drawPixelRect(-w2 - 3, -h2 - 3, p.w + 6, p.h + 6, COLORS.yellow);
    ctx.globalAlpha = p.alpha;
    // blinking warning when about to fade
    if (p.alpha < 0.62 && Math.floor(G.time * 8) % 2 === 0) {
      drawPixelRect(-w2, -h2 - 4, p.w, 2, COLORS.red);
    }
    // blocky ghost face
    ctx.fillStyle = '#ffe94a';
    ctx.fillRect(-w2 + 10, -h2 + 4, 3, 3); ctx.fillRect(-w2 + p.w - 16, -h2 + 4, 3, 3);
    ctx.fillRect(-w2 + 13, -h2 + 9, 3, 1); ctx.fillRect(-w2 + p.w - 19, -h2 + 9, 3, 1);
    ctx.globalAlpha = 1;
  } else if (p.type === 'bouncy') {
    const sq = p.bounceT > 0 ? 0.7 + 0.3 * (p.bounceT / 0.2) : 1;
    p.bounceT = Math.max(0, (p.bounceT || 0) - 0.016);
    ctx.save();
    ctx.scale(1, sq);
    // 8-bit checkerboard pad
    drawPixelRect(-w2, -h2, p.w, p.h, '#3d0f33');
    for (let gx = -w2; gx < w2; gx += 8) {
      for (let gy = -h2; gy < h2; gy += 4) {
        if ((Math.round((gx + w2) / 8) + Math.round((gy + h2) / 4)) % 2 === 1) drawPixelRect(gx, gy, 8, 4, '#5c1a4c');
      }
    }
    drawPixelRect(-w2, -h2, p.w, 4, COLORS.pink);
    ctx.globalAlpha = 0.22;
    drawPixelRect(-w2 - 3, -h2 - 3, p.w + 6, p.h + 6, COLORS.pink);
    ctx.globalAlpha = 1;
    // blocky springs on the pad surface
    ctx.fillStyle = '#ffa3ec';
    for (let sx = -w2 + 10; sx < w2 - 10; sx += 16) {
      ctx.fillRect(sx, -h2 - 2, 3, 2);
      ctx.fillRect(sx + 1, -h2, 1, 3);
    }
    ctx.restore();
  } else {
    // solid neon green — 8-bit checkerboard
    drawPixelRect(-w2, -h2, p.w, p.h, '#0e3a24');
    for (let gx = -w2; gx < w2; gx += 8) {
      for (let gy = -h2; gy < h2; gy += 4) {
        if ((Math.round((gx + w2) / 8) + Math.round((gy + h2) / 4)) % 2 === 1) drawPixelRect(gx, gy, 8, 4, '#165237');
      }
    }
    drawPixelRect(-w2, -h2, p.w, 3, COLORS.green);
    ctx.globalAlpha = 0.16;
    drawPixelRect(-w2 - 2, -h2 - 2, p.w + 4, p.h + 4, COLORS.green);
    ctx.globalAlpha = 1;
    // neon rivet pixels
    ctx.fillStyle = '#a4ffd0';
    for (let sx = -w2 + 6; sx < w2 - 4; sx += 20) ctx.fillRect(sx, -h2 + 7, 3, 3);
  }
  ctx.restore();
}

function drawBackground() {
  // sky gradient
  const grad = ctx.createLinearGradient(0, 0, 0, VH);
  grad.addColorStop(0, '#12071f');
  grad.addColorStop(0.55, '#1b0b33');
  grad.addColorStop(1, '#0a0416');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VW, VH);

  // parallax stars
  for (let i = 0; i < 46; i++) {
    const par = 0.15 + hash(i) * 0.25;
    const sx = ((hash(i + 50) * 620 - camX * par) % (VW + 40) + VW + 40) % (VW + 40) - 20;
    const sy = hash(i + 99) * 190;
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(G.time * (1 + hash(i)) + i));
    ctx.globalAlpha = tw * 0.8;
    drawPixelRect(sx, sy, 2, 2, i % 5 === 0 ? COLORS.cyan : '#cfd6ff');
  }
  ctx.globalAlpha = 1;

  // distant neon silhouettes (parallax layer 1)
  for (let i = 0; i < 14; i++) {
    const par = 0.35;
    const sx = ((hash(i + 7) * 900 - camX * par) % (VW + 200) + VW + 200) % (VW + 200) - 100;
    const sy = 150 + hash(i + 21) * 40;
    const s = 14 + hash(i + 3) * 26;
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = COLORS.purple;
    if (i % 3 === 0) {
      ctx.beginPath(); ctx.moveTo(sx, sy + s); ctx.lineTo(sx + s / 2, sy); ctx.lineTo(sx + s, sy + s); ctx.fill();
    } else {
      drawPixelRect(sx, sy, s, s);
    }
  }
  ctx.globalAlpha = 1;

  // neon moon
  const mx = VW * 0.78, my = 46;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#fff6c8';
  ctx.beginPath(); ctx.arc(mx, my, 16, 0, TAU); ctx.fill();
  ctx.globalAlpha = 0.25;
  ctx.beginPath(); ctx.arc(mx, my, 24, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;

  // the infinite void
  const vg = ctx.createLinearGradient(0, 206, 0, VH);
  vg.addColorStop(0, '#3b0a63');
  vg.addColorStop(1, '#0d0218');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 206, VW, VH - 206);
  // rising void wisps
  for (let i = 0; i < 10; i++) {
    const wx = ((hash(i + 31) * VW + G.time * (8 + hash(i + 5) * 14)) % VW);
    const wy = VH - ((hash(i + 71) * 60 + (G.time * (6 + hash(i + 9) * 10)) % 66));
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = COLORS.purple;
    ctx.fillRect(Math.round(wx), Math.round(wy), 2, 3);
  }
  ctx.globalAlpha = 1;
}

function drawGate() {
  if (!gate) return;
  if (freeze <= 0) gate.t += 0.016;
  const open = G.shards >= 3;
  ctx.save();
  ctx.translate(gate.x + gate.w / 2, gate.y);
  const gx = Math.round(-gate.w / 2), gy = -gate.h;
  // frame
  drawPixelRect(gx - 6, gy - 4, gate.w + 12, gate.h + 4, open ? '#0e4a52' : '#241c33');
  drawPixelRect(gx - 6, gy - 4, gate.w + 12, 5, open ? COLORS.cyan : '#5a4a75');
  // swirling vortex core
  const swirl = open ? 3.2 : 0.7;
  for (let i = 0; i < (open ? 22 : 8); i++) {
    const a = gate.t * swirl + i * (TAU / (open ? 22 : 8));
    const rr = 10 + (i % 4) * 11;
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr * 0.75;
    ctx.globalAlpha = open ? 0.9 : 0.35;
    ctx.fillStyle = open ? COLORS.cyan : '#6f6390';
    ctx.fillRect(Math.round(px), Math.round(py), 4, 4);
  }
  ctx.globalAlpha = 1;
  if (open) {
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = COLORS.cyan;
    ctx.fillRect(gx, gy, gate.w, gate.h);
    ctx.globalAlpha = 1;
  }
  ctx.font = '8px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = open ? COLORS.cyan : '#8d7fbd';
  ctx.fillText(open ? 'OPEN!' : 'LOCKED', 0, 10);
  ctx.restore();
}

function drawCheckpoints() {
  for (const c of checkpoints) {
    ctx.save();
    ctx.translate(c.x, c.y);
    const on = c.on;
    drawPixelRect(-2, -34, 4, 34, on ? '#0f4a4a' : '#2a2440');
    ctx.fillStyle = on ? COLORS.cyan : '#6f6390';
    // blocky pixel diamond
    ctx.fillRect(-4, -43, 8, 3);
    ctx.fillRect(-6, -40, 12, 3);
    ctx.fillRect(-8, -37, 16, 3);
    ctx.fillRect(-6, -34, 12, 3);
    ctx.fillRect(-4, -31, 8, 3);
    if (on) {
      ctx.globalAlpha = 0.2 + 0.1 * Math.sin(G.time * 4);
      ctx.beginPath(); ctx.arc(0, -34, 12, 0, TAU); ctx.fillStyle = COLORS.cyan; ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function drawShard(x, y, t, got) {
  if (got) return;
  const sy = y + Math.sin(t * 2.4) * 4;
  ctx.save();
  ctx.translate(x + 6, sy);
  ctx.rotate(Math.sin(t * 1.8) * 0.25);
  // blocky glow cross
  ctx.globalAlpha = 0.15 + 0.08 * Math.sin(t * 5);
  ctx.fillStyle = COLORS.cyan;
  ctx.fillRect(-9, -3, 18, 6);
  ctx.fillRect(-3, -9, 6, 18);
  ctx.globalAlpha = 1;
  // 8-bit gem made of neon square pixels (5 rows)
  const widths = [3, 6, 9, 6, 3];
  for (let r = 0; r < 5; r++) {
    const half = widths[r];
    ctx.fillStyle = r <= 1 ? '#d9feff' : (r === 2 ? '#a5f6ff' : COLORS.cyan);
    ctx.fillRect(-half, -8 + r * 4, half * 2, 4);
  }
  // sparkle + dark base pixels
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-3, -8, 2, 2);
  ctx.fillStyle = '#0d4a55';
  ctx.fillRect(5, 4, 4, 2);
  ctx.restore();
}

function drawPickup(p) {
  const bob = p.grounded ? Math.sin(p.t * 2.2) * 2 : 0;
  const x = Math.round(p.x + 3), y = Math.round(p.y + bob);
  if (p.type === 'ammo') {
    ctx.globalAlpha = 0.2 + 0.1 * Math.sin(p.t * 4);
    ctx.fillStyle = COLORS.yellow;
    ctx.fillRect(x - 5, y - 4, 12, 10);
    ctx.globalAlpha = 1;
    drawPixelRect(x, y, 6, 4, '#5a4a12');
    drawPixelRect(x - 3, y - 5, 4, 3, COLORS.yellow);
    drawPixelRect(x + 3, y - 2, 3, 2, COLORS.yellow);
    drawPixelRect(x, y, 6, 2, '#fff');
  } else if (p.type === 'helmet') {
    // glowing Knight Helm pickup box
    const gx = Math.round(p.x), gy = Math.round(p.y + bob);
    ctx.globalAlpha = 0.18 + 0.1 * Math.sin(p.t * 5);
    ctx.fillStyle = '#c9ced6';
    ctx.fillRect(gx - 2, gy - 2, 18, 18);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#241d3d';
    ctx.fillRect(gx, gy, 14, 14);
    // blocky helm icon inside the box
    ctx.fillStyle = '#c9ced6';
    ctx.fillRect(gx + 2, gy + 2, 10, 5);
    ctx.fillRect(gx + 1, gy + 4, 3, 4);
    ctx.fillStyle = '#2a2f3a';
    ctx.fillRect(gx + 5, gy + 3, 4, 3);
    ctx.fillStyle = '#e5261b';
    ctx.fillRect(gx + 5, gy, 3, 4);
    ctx.fillStyle = '#8f9aa6';
    ctx.fillRect(gx + 2, gy + 7, 10, 1);
  }
}

/* -------- milestone armor overlays + hand-held weapon renders -------- */
function drawArmorOverlay(y0) {
  const a = P.currentArmor;
  // broken armor falls back to the normal blocky shirt (weapons are unaffected)
  if (a === 'NONE' || P.armorBroken) return;
  if (a === 'VOID_HUNTER') {
    // tattered neon-cyan cloak — hood + shoulder cowl + jagged torn hem
    ctx.fillStyle = '#0e7d8f';
    ctx.fillRect(-8, -16 + y0, 16, 8);
    ctx.fillStyle = COLORS.cyan;
    ctx.fillRect(-8, -16 + y0, 2, 8); ctx.fillRect(6, -16 + y0, 2, 8);
    ctx.fillRect(-7, -24 + y0, 14, 3);
    ctx.fillRect(-4, -27 + y0, 8, 4);
    ctx.fillStyle = '#b8fbff';
    ctx.fillRect(2, -26 + y0, 2, 2);
    // tattered hem — jagged pixel notches along the cloak bottom
    ctx.fillRect(-7, -9 + y0, 3, 2); ctx.fillRect(-1, -9 + y0, 2, 2);
    ctx.fillRect(3, -9 + y0, 3, 2); ctx.fillRect(7, -9 + y0, 2, 2);
    ctx.fillStyle = '#0e7d8f';
    ctx.fillRect(-3, -9 + y0, 2, 1); ctx.fillRect(5, -9 + y0, 2, 1); // torn rips
  } else if (a === 'PALADIN') {
    // purple chestplate grid
    ctx.fillStyle = '#6d2bb0';
    ctx.fillRect(-7, -16 + y0, 14, 8);
    ctx.fillStyle = '#b44bff';
    for (let gx = -6; gx < 8; gx += 4) ctx.fillRect(gx, -16 + y0, 2, 8);
    ctx.fillRect(-7, -13 + y0, 14, 2); ctx.fillRect(-7, -10 + y0, 14, 2);
    // 2 pink boxes continuously orbiting the core coordinates
    for (let k = 0; k < 2; k++) {
      const ang = G.time * 4.2 + k * Math.PI;
      const ox = Math.round(Math.cos(ang) * 17);
      const oy = Math.round(Math.sin(ang) * 9 - 7 + y0);
      ctx.fillStyle = COLORS.pink;
      ctx.fillRect(ox - 2, oy - 2, 4, 4);
      ctx.fillStyle = '#ffa3ec';
      ctx.fillRect(ox - 1, oy - 1, 2, 2);
    }
  } else if (a === 'JUGGERNAUT') {
    // yellow block mechanical exoskeleton grid over torso + limbs
    ctx.fillStyle = '#7a6a10';
    ctx.fillRect(-7, -17 + y0, 14, 9);
    ctx.fillStyle = COLORS.yellow;
    for (let gx = -7; gx < 8; gx += 4) ctx.fillRect(gx, -17 + y0, 2, 9);
    for (let gy = -17 + y0; gy < -8 + y0; gy += 4) ctx.fillRect(-7, gy, 14, 2);
    ctx.fillRect(-10, -12 + y0, 3, 6); ctx.fillRect(7, -12 + y0, 3, 6);
    ctx.fillRect(-8, -6 + y0, 5, 6); ctx.fillRect(3, -6 + y0, 5, 6);
    ctx.fillStyle = '#fff7c8';
    ctx.fillRect(-6, -16 + y0, 2, 2); ctx.fillRect(4, -10 + y0, 2, 2);
  } else if (a === 'CHRONO_GUARD') {
    // deep blue armor plates (clockwork sparks are emitted in updatePlayer)
    ctx.fillStyle = '#16336b';
    ctx.fillRect(-8, -16 + y0, 16, 8);
    ctx.fillStyle = '#2a5cd4';
    ctx.fillRect(-8, -16 + y0, 3, 8); ctx.fillRect(5, -16 + y0, 3, 8);
    ctx.fillRect(-9, -18 + y0, 2, 10); ctx.fillRect(7, -18 + y0, 2, 10);
    ctx.fillStyle = '#7ab8ff';
    ctx.fillRect(-1, -13 + y0, 2, 4);
    // 1x1 glowing clockwork-white studs on the shoulder plates (blinking)
    ctx.fillStyle = '#ffffff';
    const tw = Math.floor(G.time * 8) % 2;
    ctx.fillRect(-9 + (tw ? 0 : 1), -18 + y0, 1, 1);
    ctx.fillRect(8 - (tw ? 0 : 1), -18 + y0, 1, 1);
    ctx.fillRect(-8 + (tw ? 1 : 0), -19 + y0, 1, 1);
    ctx.fillRect(7 - (tw ? 1 : 0), -19 + y0, 1, 1);
  } else if (a === 'KRATOS') {
    // ghost-white skin mesh with sharp angular red pixel tattoos (pure fillRect blocks)
    ctx.fillStyle = '#e9e9f4';
    ctx.fillRect(-6, -16 + y0, 12, 7);
    ctx.fillStyle = '#c2c2d4';
    ctx.fillRect(-6, -10 + y0, 12, 2);
    ctx.fillStyle = '#ff4d6d';
    // angular tattoo zigzag winding across the chest
    for (let k = 0; k < 5; k++) {
      ctx.fillRect(-6 + k * 2, -15 + y0 + (k % 2), 2, 2);
    }
    ctx.fillRect(-4, -14 + y0, 2, 2); ctx.fillRect(2, -13 + y0, 2, 2);
    ctx.fillRect(-5, -9 + y0, 3, 2); ctx.fillRect(4, -14 + y0, 3, 2);
    ctx.fillRect(-7, -13 + y0, 3, 2); ctx.fillRect(-4, -12 + y0, 2, 1); ctx.fillRect(1, -15 + y0, 2, 1);
  }
}

function drawSlashArc() {
  // fast-fading pixel arc jab path (Krazal Boxing Glove)
  if (slashT <= 0) return;
  ctx.save();
  ctx.translate(Math.round(cx()), Math.round(P.y + P.h / 2));
  ctx.scale(P.facing, 1);
  const prog = 1 - slashT / 0.12;
  const a0 = -1.0 + prog * 2.2, a1 = a0 + 1.5;
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 7; i++) {
    const ang = a0 + (a1 - a0) * (i / 6);
    const rr = 10 + i * 1.6;
    ctx.fillRect(Math.round(Math.cos(ang) * rr), Math.round(Math.sin(ang) * rr), 2, 2);
  }
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = COLORS.cyan;
  for (let i = 0; i < 9; i++) {
    const ang = a0 + (a1 - a0) * (i / 8);
    const rr = 7 + i * 2.2;
    ctx.fillRect(Math.round(Math.cos(ang) * rr), Math.round(Math.sin(ang) * rr), 3, 3);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawScytheArc(prog) {
  // 50ms blue/white semicircular stroke arc path (Chrono-Scythe swing)
  ctx.save();
  ctx.translate(Math.round(cx()), Math.round(P.y + P.h / 2));
  ctx.scale(P.facing, 1);
  const a0 = -1.2, a1 = 1.2;
  const sweep = (a1 - a0) * (1 - prog);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#b8fbff';
  for (let i = 0; i < 9; i++) {
    const ang = a0 + sweep * (i / 8);
    const rr = 16 + i * 1.1;
    ctx.fillRect(Math.round(Math.cos(ang) * rr), Math.round(Math.sin(ang) * rr), 2, 2);
  }
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#4d7dff';
  for (let i = 0; i < 8; i++) {
    const ang = a0 + sweep * (i / 7);
    const rr = 12 + i * 1.8;
    ctx.fillRect(Math.round(Math.cos(ang) * rr), Math.round(Math.sin(ang) * rr), 3, 3);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawWeaponVisuals() {
  const f = P.facing;
  const hx = cx(), hy = P.y + 8; // hand anchor (world space)
  if (weapon === 'GLOVE') {
    // giant red block glove extending forward during melee attack frames
    if (P.slashAnim > 0) {
      ctx.save();
      ctx.translate(Math.round(hx + f * 8), Math.round(hy));
      ctx.fillStyle = '#e5261b';
      ctx.fillRect(f * 2 - 3, -4, 12, 8);
      ctx.fillStyle = '#ff6b5e';
      ctx.fillRect(f * 2 - 1, -2, 8, 4);
      ctx.fillStyle = '#fff';
      ctx.fillRect(f * 8, -3, 3, 2);
      ctx.restore();
    }
    drawSlashArc();
  } else if (weapon === 'REPEATER') {
    // tech cyan barrel box extending forward
    ctx.save();
    ctx.translate(Math.round(hx), Math.round(hy));
    ctx.fillStyle = '#1f4d5e';
    ctx.fillRect(f * 3, -3, 12, 6);
    ctx.fillStyle = COLORS.cyan;
    ctx.fillRect(f * 12, -2, 5, 4);
    ctx.fillStyle = '#b8fbff';
    ctx.fillRect(f * 13, -1, 2, 2);
    ctx.restore();
    if (P.bowAnim > 0) {
      ctx.save();
      ctx.translate(Math.round(hx + f * 16), Math.round(hy));
      ctx.fillStyle = COLORS.cyan;
      ctx.fillRect(-2, -2, 4, 4);
      ctx.restore();
    }
  } else if (weapon === 'AEGIS') {
    // thick vertical pink light barrier box on the forearm
    ctx.save();
    ctx.translate(Math.round(hx), Math.round(hy));
    const on = P.aegisT > 0;
    ctx.fillStyle = '#5a1360';
    ctx.fillRect(f * 3, -5, 7, 10);
    ctx.globalAlpha = on ? 0.95 : 0.4;
    ctx.fillStyle = on ? '#ffa3ec' : COLORS.pink;
    ctx.fillRect(f * 6, -7, 6, 14);
    ctx.globalAlpha = 1;
    ctx.restore();
  } else if (weapon === 'RAILGUN') {
    // heavy yellow block cannon — crackling with white sparks while hold-charging
    ctx.save();
    ctx.translate(Math.round(hx), Math.round(hy));
    ctx.fillStyle = '#8a7414';
    ctx.fillRect(f * 2, -5, 14, 10);
    ctx.fillStyle = COLORS.yellow;
    ctx.fillRect(f * 4, -4, 10, 8);
    ctx.fillStyle = '#5a4a12';
    ctx.fillRect(f * 4, -5, 4, 2); ctx.fillRect(f * 4, 3, 4, 2);
    if (P.charging) {
      ctx.fillStyle = '#ffffff';
      const t = G.time * 40;
      ctx.fillRect(f * (15 + Math.round((t % 4) / 4 * 3)) - 1, -3 + Math.round((t % 5) / 5 * 6) - 3, 2, 2);
      ctx.fillRect(f * (15 + Math.round(((t + 2) % 4) / 4 * 3)) - 1, -1 + Math.round(((t + 3) % 5) / 5 * 4) - 2, 2, 2);
    }
    ctx.restore();
  } else if (weapon === 'CHRONO_SCYTHE') {
    // thin staff with a curved cyan blade
    ctx.save();
    ctx.translate(Math.round(hx), Math.round(hy));
    ctx.fillStyle = '#5a4a75';
    ctx.fillRect(f * 2, -8, 3, 12);
    ctx.fillStyle = COLORS.cyan;
    ctx.fillRect(f * 5, -10, 8, 2);
    ctx.fillRect(f * 9, -9, 2, 4);
    ctx.fillStyle = '#b8fbff';
    ctx.fillRect(f * 5, -11, 2, 2);
    ctx.restore();
    if (P.scytheT > 0) drawScytheArc(P.scytheT / 0.05);
  } else if (weapon === 'BLADES_OF_CHAOS') {
    // dual jagged neon-red daggers with plasma chain links winding back to the arms
    const reach = P.slashAnim > 0 ? (G.rageActive ? 240 : 120) : 18; // 120px whips, 240px during Rage
    const n = Math.max(4, Math.ceil(reach / 7));
    for (const s of [-1, 1]) {
      const tipX = hx + f * reach + s * 3;
      const tipY = hy + s * 2;
      const handX = hx + s * 3;
      const handY = hy - 2;
      ctx.fillStyle = '#c93838';
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        // wide 120px horizontal whip arc — chains bow vertically while slashing
        const arc = P.slashAnim > 0 ? Math.sin(t * Math.PI) * 12 : Math.sin(t * Math.PI) * 2;
        const wob = Math.sin(G.time * 24 + i * 1.7 + s) * (1 + t * 3);
        ctx.fillRect(Math.round(lerp(handX, tipX, t) + wob * t), Math.round(lerp(handY, tipY, t) + wob * t * 0.5 - arc), 2, 2);
      }
      ctx.save();
      ctx.translate(Math.round(tipX), Math.round(tipY));
      ctx.fillStyle = '#ff4d6d';
      ctx.fillRect(0, -2, 8, 4);
      ctx.fillRect(6, -3, 3, 2); ctx.fillRect(6, 1, 3, 2); // jagged edge
      ctx.fillStyle = '#fff';
      ctx.fillRect(5, -1, 2, 1);
      ctx.restore();
    }
    if (G.rageActive) {
      // Krazal Rage — 360-degree spinning blade vortex
      ctx.save();
      ctx.translate(Math.round(hx), Math.round(hy));
      for (let k = 0; k < 4; k++) {
        const ang = G.time * 18 + k * (TAU / 4);
        const rr = 26 + (k % 2) * 8;
        ctx.fillStyle = k % 2 ? '#ff4d6d' : '#ffd0d8';
        ctx.fillRect(Math.round(Math.cos(ang) * rr) - 2, Math.round(Math.sin(ang) * rr) - 2, 4, 4);
      }
      ctx.restore();
    }
    if (P.slashAnim > 0 && Math.random() < 0.4) sparks(hx + f * 12, hy, COLORS.red, 2);
  }
}

function drawBoy(t) {
  const p = P;

  // VOID HUNTER cloak — 3 fading cyan ghost rectangles trail horizontal movement
  if (p.currentArmor === 'VOID_HUNTER' && !p.armorBroken && Math.abs(p.vx) > 20 && p.trail.length > 2) {
    for (let i = 0; i < 3; i++) {
      const tp = p.trail[p.trail.length - 2 - i];
      if (!tp) break;
      ctx.globalAlpha = [0.22, 0.13, 0.06][i];
      ctx.fillStyle = COLORS.cyan;
      ctx.fillRect(Math.round(tp.x), Math.round(tp.y), p.w, p.h);
    }
    ctx.globalAlpha = 1;
  }

  ctx.save();
  ctx.translate(Math.round(p.x + p.w / 2), Math.round(bottom()));
  const sq = 1 + p.sq * 0.35;
  ctx.scale(p.facing * sq, 2 - sq);
  if (p.hurtFlash > 0 && Math.floor(t * 24) % 2 === 0) ctx.globalAlpha = 0.5;

  const running = p.onGround && Math.abs(p.vx) > 20;
  const idleBob = p.onGround && !running ? Math.sin(t * 3.2) * 0.8 : 0;
  const y0 = Math.round(idleBob);
  const airPose = !p.onGround;
  const step = running ? Math.floor(p.runPhase * 0.6) % 2 : 0; // 2-frame walk
  const kratos = p.currentArmor === 'KRATOS' && !p.armorBroken; // ghost-white skin override

  // legs — chunky blocks with a discrete 2-frame run cycle
  const legPoses = airPose
    ? [{ x: -5, y: -10 }, { x: 1, y: -10 }]
    : running
      ? (step === 0
        ? [{ x: -5, y: -8 }, { x: 1, y: -10 }]
        : [{ x: -5, y: -10 }, { x: 1, y: -8 }])
      : [{ x: -5, y: -8 }, { x: 1, y: -8 }];
  for (const l of legPoses) {
    ctx.fillStyle = '#23284f';
    ctx.fillRect(l.x, l.y, 4, 6);
    ctx.fillStyle = '#ffcf4d';
    ctx.fillRect(l.x - 1, l.y + 6, 5, 2); // chunky shoe
  }
  // body — blocky blue shirt
  ctx.fillStyle = '#2b5cff';
  ctx.fillRect(-6, -15 + y0, 12, 7);
  ctx.fillStyle = '#1d44c4';
  ctx.fillRect(-6, -9 + y0, 12, 2);
  ctx.fillStyle = '#eaf6ff';
  ctx.fillRect(-6, -15 + y0, 2, 3);
  ctx.fillRect(4, -15 + y0, 2, 3);
  // red backpack on the back (shed in the KRATOS transformation)
  if (!kratos) {
    ctx.fillStyle = '#e5261b';
    ctx.fillRect(-9, -14 + y0, 3, 6);
    ctx.fillStyle = '#a3160e';
    ctx.fillRect(-9, -9 + y0, 3, 2);
    ctx.fillRect(-7, -15 + y0, 1, 2); // strap
  }
  // arms — ghost-white skin + red angular tattoos winding down them in KRATOS state
  ctx.fillStyle = kratos ? '#e9e9f4' : '#2b5cff';
  if (p.slashAnim > 0) {
    ctx.fillRect(4, -14 + y0, 5, 3);
    ctx.fillStyle = kratos ? '#ff4d6d' : COLORS.white;
    ctx.fillRect(8, -15 + y0, 8, 2);
  } else if (p.bowAnim > 0) {
    ctx.fillRect(4, -13 + y0, 4, 2);
  } else {
    const armUp = running && step === 1;
    ctx.fillRect(-8, -13 + y0 + (armUp ? 1 : -1), 3, 3); // back arm
    ctx.fillRect(4, -13 + y0 + (armUp ? -1 : 1), 3, 3);  // front arm
  }
  if (kratos) {
    // neon-red angular tattoos winding down both arms
    ctx.fillStyle = '#ff4d6d';
    ctx.fillRect(-8, -12 + y0, 2, 1); ctx.fillRect(-7, -11 + y0, 1, 2); ctx.fillRect(-8, -9 + y0, 2, 1);
    ctx.fillRect(4, -12 + y0, 2, 1); ctx.fillRect(5, -11 + y0, 1, 2); ctx.fillRect(4, -9 + y0, 2, 1);
    ctx.fillRect(-7, -13 + y0, 1, 1); ctx.fillRect(5, -13 + y0, 1, 1);
  }
  // head
  ctx.fillStyle = kratos ? '#e9e9f4' : '#ffd9a0';
  ctx.fillRect(-5, -23 + y0, 10, 8);
  if (G.armor > 0) {
    // oversized Knight Helm (silver, red plume, visor slit)
    ctx.fillStyle = '#c9ced6';
    ctx.fillRect(-6, -27 + y0, 12, 6);
    ctx.fillRect(-7, -24 + y0, 3, 4);
    ctx.fillStyle = '#8f9aa6';
    ctx.fillRect(-6, -27 + y0, 12, 1);
    ctx.fillStyle = '#2a2f3a';
    ctx.fillRect(-2, -23 + y0, 4, 3);   // visor slit
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, -22 + y0, 2, 1);    // visor glint
    ctx.fillStyle = '#e5261b';
    ctx.fillRect(-1, -31 + y0, 3, 5);   // red plume
    ctx.fillStyle = '#a3160e';
    ctx.fillRect(-1, -31 + y0, 1, 5);
  } else {
    // hair
    ctx.fillStyle = '#3a2a55';
    ctx.fillRect(-5, -25 + y0, 10, 3);
    ctx.fillRect(-5, -23 + y0, 3, 3);
    // eye
    ctx.fillStyle = '#10142e';
    ctx.fillRect(2, -20 + y0, 3, 3);
    ctx.fillStyle = '#fff';
    ctx.fillRect(3, -19 + y0, 1, 1);
    // cheek (red angular war-mark in KRATOS state)
    ctx.fillStyle = kratos ? '#ff4d6d' : '#ffb27a';
    ctx.fillRect(-4, -19 + y0, 2, 1);
  }

  // milestone armor overlay (drawn inside the same scaled transform)
  drawArmorOverlay(y0);

  ctx.restore();
  ctx.globalAlpha = 1;

  // hand-held weapon visuals (switch on the active inventory slot)
  drawWeaponVisuals();
  // Void Repeater combo multiplier — floats above the boy's head (x5 = 2x damage)
  if (weapon === 'REPEATER' && repStreak >= 2) {
    ctx.save();
    ctx.fillStyle = repStreak >= 5 ? '#ff3fd8' : COLORS.cyan;
    ctx.font = '6px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`x${repStreak}`, Math.round(cx()), Math.round(P.y - 8));
    ctx.restore();
  }
  // iframe blink ring
  if (P.iframes > 0 && Math.floor(t * 14) % 2 === 0) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = COLORS.cyan;
    ctx.fillRect(Math.round(P.x - 3), Math.round(P.y - 3), P.w + 6, P.h + 6);
    ctx.globalAlpha = 1;
  }
}

function drawEnemies() {
  for (const e of enemies) {
    if (e.dead) continue;
    ctx.save();
    ctx.translate(Math.round(e.cx), Math.round(e.cy));
    if (e.flash > 0) ctx.globalAlpha = 0.5;

    if (e.kind === 'hedgehog') {
      ctx.scale(e.facing, 1);
      // blocky spikes on the front (movement direction)
      ctx.fillStyle = '#8a3cff';
      ctx.fillRect(2, -7, 5, 2);
      ctx.fillRect(5, -6, 3, 3);
      ctx.fillRect(8, -4, 3, 3);
      ctx.fillRect(9, -1, 2, 3);
      // body
      ctx.fillStyle = '#5c1fa8';
      ctx.fillRect(-7, -5, 12, 9);
      ctx.fillStyle = e.color;
      ctx.fillRect(-7, -5, 12, 4);
      ctx.fillStyle = '#7d3fd6';
      ctx.fillRect(-7, 0, 12, 2);
      // blocky eyes (safe side)
      ctx.fillStyle = '#fff';
      ctx.fillRect(-6, -4, 3, 3);
      ctx.fillStyle = '#10142e';
      ctx.fillRect(-5, -3, 2, 2);
      // feet
      ctx.fillStyle = '#4a2470';
      ctx.fillRect(-6, 4, 4, 2); ctx.fillRect(0, 4, 4, 2);
    } else if (e.kind === 'bat') {
      // 2-frame blocky wing flap (~4 cycles/sec)
      const flap = Math.floor(e.t * 0.8) % 2;
      ctx.fillStyle = '#8a4a14';
      if (flap === 0) {
        ctx.fillRect(-10, -6, 3, 3); ctx.fillRect(-13, -4, 3, 3);
        ctx.fillRect(7, -6, 3, 3); ctx.fillRect(10, -4, 3, 3);
      } else {
        ctx.fillRect(-10, -3, 3, 3); ctx.fillRect(-13, -1, 3, 3);
        ctx.fillRect(7, -3, 3, 3); ctx.fillRect(10, -1, 3, 3);
      }
      // body
      ctx.fillStyle = '#6b3710';
      ctx.fillRect(-7, -5, 14, 9);
      ctx.fillStyle = e.color;
      ctx.fillRect(-7, -5, 14, 4);
      ctx.fillStyle = '#ffd9a0';
      ctx.fillRect(-7, -1, 14, 1);
      // blocky eyes
      ctx.fillStyle = '#fff';
      const eyes = [[-4, -2], [0, -3], [4, -2], [0, 0]];
      for (const [ex, ey] of eyes) ctx.fillRect(ex, ey, 3, 3);
      ctx.fillStyle = '#401f00';
      for (const [ex, ey] of eyes) ctx.fillRect(ex + 1, ey + 1, 2, 2);
    } else if (e.kind === 'golem') {
      // glitch block body
      const cells = 6, cs = 40 / cells;
      for (let i = 0; i < cells; i++) {
        for (let j = 0; j < cells; j++) {
          const h = hash(i * 31 + j * 17 + Math.floor(e.t * 6));
          if (h < 0.35) continue;
          const pal = [e.color, COLORS.purple, '#7d4daf', '#3d0f33', COLORS.green];
          ctx.fillStyle = pal[Math.floor(h * pal.length) % pal.length];
          ctx.fillRect(-20 + i * cs, -22 + j * cs, cs, cs);
        }
      }
      // blocky outer border
      ctx.fillStyle = '#2b0f1a';
      ctx.fillRect(-20, -22, 40, 2); ctx.fillRect(-20, 20, 40, 2);
      ctx.fillRect(-20, -22, 2, 42); ctx.fillRect(18, -22, 2, 42);
      // crack overlay (damage)
      if (e.hp <= 2) {
        ctx.strokeStyle = '#ff8fa3'; ctx.lineWidth = 1;
        const cracks = 3 - e.hp;
        for (let c = 0; c < cracks; c++) {
          ctx.beginPath();
          ctx.moveTo(-16 + c * 14, -20); ctx.lineTo(-8 + c * 14, -6); ctx.lineTo(-14 + c * 14, 8); ctx.lineTo(-4 + c * 14, 18);
          ctx.stroke();
        }
      }
      // blocky portal face
      ctx.fillStyle = '#1a0912';
      ctx.fillRect(-9, -14, 18, 24);
      ctx.fillStyle = COLORS.cyan;
      const eyeGlow = 0.7 + 0.3 * Math.sin(e.t * 3);
      ctx.globalAlpha = eyeGlow;
      ctx.fillRect(-7, -12, 5, 5); ctx.fillRect(2, -12, 5, 5);
      ctx.globalAlpha = 1;
      ctx.fillRect(-5, -2, 10, 2);
      ctx.fillStyle = '#ff8fa3';
      ctx.fillRect(-3, 0, 6, 2);
      // telegraph glow
      if (e.phase === 'telegraph') {
        ctx.globalAlpha = 0.4 + 0.4 * Math.sin(e.t * 30);
        ctx.fillStyle = COLORS.orange;
        ctx.fillRect(-22, -24, 44, 48);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

function drawWaves() {
  for (const w of waves) {
    ctx.save();
    ctx.translate(Math.round(w.x), Math.round(w.y));
    if (w.friendly) {
      // Aegis-parried shockwave — now a pink/white blade of light
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = COLORS.pink;
      ctx.fillRect(0, 0, w.w, 4);
      ctx.fillStyle = '#ffe3f7';
      ctx.fillRect(2, 4, 6, 4); ctx.fillRect(10, 4, 6, 4);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = COLORS.pink;
      ctx.fillRect(-2, 0, w.w + 4, 8);
    } else {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = COLORS.orange;
      ctx.fillRect(0, 0, w.w, 4);
      ctx.fillStyle = '#ffd9a0';
      ctx.fillRect(2, 4, 6, 4); ctx.fillRect(10, 4, 6, 4);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = COLORS.orange;
      ctx.fillRect(-2, 0, w.w + 4, 8);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function drawMarkOfKrazality() {
  if (!markOfKrazality || markOfKrazality.taken) return;
  const m = markOfKrazality;
  m.t += 0.016;
  const sy = m.y + Math.sin(m.t * 2) * 3;
  ctx.save();
  ctx.translate(Math.round(m.x + 8), Math.round(sy + 8));
  ctx.rotate(Math.sin(m.t * 1.6) * 0.2);
  ctx.globalAlpha = 0.25 + 0.15 * Math.sin(m.t * 6);
  ctx.fillStyle = '#ff4d6d';
  ctx.fillRect(-10, -10, 20, 20);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#3a0f2e';
  ctx.fillRect(-7, -7, 14, 14);
  ctx.fillStyle = '#ff4d6d';
  ctx.fillRect(-4, -4, 8, 8);
  ctx.fillStyle = '#fff';
  ctx.fillRect(-2, -2, 4, 4);
  ctx.fillStyle = '#ff4d6d';
  ctx.fillRect(-7, -10, 4, 3); ctx.fillRect(3, -10, 4, 3);
  ctx.fillRect(-7, 7, 4, 3); ctx.fillRect(3, 7, 4, 3);
  ctx.restore();
  ctx.font = '8px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd0d8';
  ctx.globalAlpha = 0.8 + 0.2 * Math.sin(m.t * 4);
  ctx.fillText('THE MARK OF KRAZALITY', m.x + 8, m.y - 12);
  ctx.globalAlpha = 1;
}

function drawHourglass() {
  if (!hourglass || hourglass.taken) return;
  const h = hourglass;
  h.t += 0.016;
  const sy = h.y + Math.sin(h.t * 2) * 3;
  ctx.save();
  ctx.translate(Math.round(h.x + 6), Math.round(sy + 8));
  ctx.globalAlpha = 0.85;
  // glowing blue pixel hourglass
  ctx.fillStyle = '#2a5cd4';
  ctx.fillRect(-6, -8, 12, 2);                            // top cap
  ctx.fillRect(-6, 6, 12, 2);                             // bottom cap
  ctx.fillStyle = '#7ab8ff';
  ctx.fillRect(-1, -7, 2, 13);                            // neck
  ctx.fillStyle = '#dff4ff';
  ctx.fillRect(-3, -5, 6, 2); ctx.fillRect(-3, 3, 6, 2);  // glass
  ctx.fillStyle = '#7ab8ff';
  ctx.fillRect(-3, -3, 6, 6); ctx.fillRect(-2, -2, 4, 4);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  ctx.font = '8px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#b8fbff';
  ctx.globalAlpha = 0.7 + 0.3 * Math.sin(h.t * 4);
  ctx.fillText('THE CHRONO HOURGLASS', h.x + 6, h.y - 14);
  ctx.globalAlpha = 1;
}

function drawShocks() {
  for (const s of shocks) {
    ctx.save();
    ctx.translate(Math.round(s.x), Math.round(s.y));
    // pixelated zigzag shockwave (flickers as it tears across the ground)
    ctx.fillStyle = '#c9feff';
    ctx.fillRect(0, 0, 16, 3);
    ctx.fillStyle = COLORS.cyan;
    ctx.fillRect(2, 3, 6, 3); ctx.fillRect(10, 3, 4, 3);
    ctx.fillRect(4, 6, 4, 3);
    if (Math.floor(s.t * 14) % 2 === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(4, 0, 3, 1); ctx.fillRect(11, 5, 2, 2);
    }
    ctx.globalAlpha = 0.3;
    ctx.fillRect(-2, 0, 20, 9);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function drawArrows() {
  for (const a of arrows) {
    ctx.save();
    ctx.translate(Math.round(a.x), Math.round(a.y));
    ctx.rotate(Math.atan2(a.vy, a.vx));
    if (a.rail) {
      // heavy yellow rail bolt crackling white
      ctx.fillStyle = COLORS.yellow;
      ctx.fillRect(-4, -3, 12, 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(4, -2, 5, 4);
      if (Math.floor(G.time * 30) % 2 === 0) ctx.fillRect(-2, -5, 3, 2);
    } else if (a.bolt) {
      // Void Repeater tech-cyan bolt
      ctx.fillStyle = COLORS.cyan;
      ctx.fillRect(-2, -2, 9, 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(3, -1, 4, 2);
    } else {
      ctx.fillStyle = '#ffe9b0';
      ctx.fillRect(-2, -1, 6, 2);
      ctx.fillStyle = COLORS.cyan;
      ctx.fillRect(4, -2, 4, 4);
      ctx.fillStyle = '#fff';
      ctx.fillRect(-3, -1, 2, 2);
    }
    ctx.restore();
    // 3 glowing neon trail pixels fading behind the projectile
    const spd = Math.hypot(a.vx, a.vy) || 1;
    const trailColor = a.rail ? COLORS.yellow : COLORS.cyan;
    for (let i = 1; i <= 3; i++) {
      ctx.globalAlpha = 0.28 / i;
      ctx.fillStyle = trailColor;
      ctx.fillRect(Math.round(a.x - (a.vx / spd) * i * 3), Math.round(a.y - (a.vy / spd) * i * 3), 2, 2);
    }
    ctx.globalAlpha = 1;
  }
}

function drawSpells() {
  for (const s of spells) {
    ctx.save();
    ctx.translate(Math.round(s.x), Math.round(s.y + Math.sin(s.t * 18) * 2));
    ctx.scale(s.dir, 1);
    const flick = Math.floor(s.t * 22) % 2 === 0;
    const pal = [COLORS.cyan, COLORS.purple, '#ffffff'];
    // roaring layered energy wave
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = pal[Math.floor(s.t * 14) % 3];
    ctx.fillRect(-18, -8, 38, 18);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = pal[(Math.floor(s.t * 14) + 1) % 3];
    ctx.fillRect(-14, -6, 30, 14);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-10, -4, 22, 9);
    ctx.fillStyle = pal[(Math.floor(s.t * 14) + 2) % 3];
    if (flick) { ctx.fillRect(7, -5, 4, 3); ctx.fillRect(13, 1, 4, 3); }
    ctx.fillRect(-16, -2, 4, 5);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function drawFocusFx() {
  if (P.focusT <= 0) return;
  const prog = P.focusT / 1.2;
  ctx.save();
  ctx.translate(Math.round(cx()), Math.round(P.y + P.h / 2));
  ctx.globalAlpha = 0.22 * prog;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(0, 0, 9 + prog * 5, 0, TAU); ctx.fill();
  for (let i = 0; i < 10; i++) {
    const a = G.time * 6 + i * (TAU / 10);
    const rr = 13 + prog * 5 + (i % 3) * 3;
    ctx.globalAlpha = 0.45 + 0.55 * prog;
    ctx.fillStyle = i % 2 ? '#ffffff' : '#cfe9ff';
    ctx.fillRect(Math.round(Math.cos(a) * rr), Math.round(Math.sin(a) * rr * 0.85), 2, 2);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawParticles() {
  ctx.save();
  for (const p of particles) {
    const a = clamp(p.life / 0.4, 0, 1);
    ctx.globalAlpha = a;
    if (p.kind === 'ring') {
      ctx.strokeStyle = p.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
    } else if (p.kind === 'flash') {
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    } else if (p.kind === 'text') {
      ctx.globalAlpha = clamp(p.life / 0.3, 0, 1);
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    } else if (p.kind === 'dustpuff') {
      const fade = clamp(p.life / 0.4, 0, 1);
      const px = Math.round(p.x), py = Math.round(p.y);
      ctx.globalAlpha = fade * 0.7;
      ctx.fillStyle = p.color;
      ctx.fillRect(px - 1, py - 1, 3, 2);
      ctx.fillRect(px + 2, py - 2, 2, 2);
      ctx.fillRect(px, py + 1, 2, 2);
      ctx.globalAlpha = fade * 0.4;
      ctx.fillRect(px + 4, py, 2, 2);
      ctx.fillRect(px - 3, py, 2, 2);
    } else {
      if (p.glitch) {
        // shifting glitch-RGB color, re-rolled every frame
        const gpal = [COLORS.red, COLORS.green, COLORS.cyan, COLORS.purple, COLORS.yellow];
        ctx.fillStyle = gpal[Math.floor((p.x * 0.3 + p.y * 0.2 + G.time * 18) % gpal.length + gpal.length) % gpal.length];
      } else {
        ctx.fillStyle = p.color;
      }
      ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.round(p.size), Math.round(p.size));
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  let shx = 0, shy = 0;
  if (shakeT > 0) {
    shakeT -= 0.016;
    shx = rnd(-shakeMag, shakeMag);
    shy = shakeHoriz ? 0 : rnd(-shakeMag, shakeMag) * 0.6; // hurt shake = pure horizontal
    shakeMag *= 0.86;
    if (shakeT <= 0) shakeHoriz = false;
  }
  drawBackground();

  ctx.save();
  ctx.translate(Math.round(-camX + shx), Math.round(shy));
  // platforms
  for (const p of platforms) drawPlatform(p);
  // gate
  drawGate();
  // checkpoints
  drawCheckpoints();
  // shards
  for (const s of shards) drawShard(s.x, s.y, s.t, s.got);
  // pickups
  for (const p of pickups) drawPickup(p);
  // Level 12 secret hourglass + end-game altar artifact
  drawHourglass();
  drawMarkOfKrazality();
  // enemies
  drawEnemies();
  // waves & arrows & hammer shocks & Glitch Wave spells
  drawWaves();
  drawShocks();
  drawArrows();
  drawSpells();
  // player (Focus vortex swirls behind the boy)
  drawFocusFx();
  if (G.state === 'play' || G.state === 'win') drawBoy(G.time);
  // particles (world space)
  drawParticles();
  ctx.restore();

  // lock-on hint text when gate approached
  if (G.shards < 3 && P.x > gate.x - 200 && G.state === 'play') {
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8d7fbd';
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(G.time * 4);
    ctx.fillText(`${G.shards}/3 SHARDS - VORTEX LOCKED`, VW / 2, VH - 14);
    ctx.globalAlpha = 1;
  }
}

/* ------------------------------ game flow ----------------------------------- */
function resetLevel() {
  G.restarts++;
  G.deaths = 0;
  buildLevel();
  G.state = 'play';
  G.paused = false;
  skillsOpen = false;
  showHUD();
  hideOverlays();
  $('winScreen').classList.add('hidden');
  // if the run already passed level 10 but no faction was chosen yet (e.g. the
  toast('WELCOME TO KRAZALITY — FIND THE SHARDS!', false);
}

function startGame() {
  AudioSys.ensure();
  AudioSys.ui();
  buildLevel();
  G.state = 'play';
  G.paused = false;
  showHUD();
  hideOverlays();
}

function winGame() {
  G.state = 'win';
  AudioSys.win();
  explode(gate.x + gate.w / 2, gate.y - 60, COLORS.cyan, 40);
  const mins = Math.floor(G.runTime / 60), secs = Math.floor(G.runTime % 60);
  $('winStats').innerHTML =
    `TIME <b>${mins}:${secs.toString().padStart(2, '0')}</b><br />` +
    `DEATHS <b>${G.deaths}</b><br />` +
    `ENEMIES BANISHED <b>${G.kills}</b><br />` +
    `SHARDS <b>${G.shards}/3</b>`;
  $('winScreen').classList.remove('hidden');
}

function togglePause() {
  if (G.state !== 'play' || factionChoiceOpen) return;
  if (skillsOpen) {
    // closing the skills menu with P keeps the game paused, showing the pause screen
    skillsOpen = false;
    $('skillsScreen').classList.add('hidden');
    $('pauseScreen').classList.remove('hidden');
    AudioSys.ui();
    return;
  }
  G.paused = !G.paused;
  $('pauseScreen').classList.toggle('hidden', !G.paused);
  AudioSys.ui();
}

/* ------------------------------ skill tree ---------------------------------- */
let skillsOpen = false;
function skillPoints() { return (G.level - 1) - G.spent; }
function toggleSkills() {
  if (G.state !== 'play' || factionChoiceOpen) return;
  if (skillsOpen) {
    skillsOpen = false;
    G.paused = false;
    $('skillsScreen').classList.add('hidden');
  } else {
    skillsOpen = true;
    G.paused = true;
    $('pauseScreen').classList.add('hidden');
    $('skillsScreen').classList.remove('hidden');
    updateSkillsUI();
  }
  AudioSys.ui();
}
function buySkill(name) {
  if (G.state !== 'play' || G.skills[name] || skillPoints() < 1) return;
  G.skills[name] = true;
  G.spent++;
  AudioSys.shard();
  updateHUD();
  updateSkillsUI();
  const label = name === 'sharpEdge' ? 'SHARP EDGE' : name === 'quickDraw' ? 'QUICK DRAW' : 'DIMENSION HOPPER';
  toast(`${label} UNLOCKED!`, false);
}
function updateSkillsUI() {
  $('skillPointsNum').textContent = skillPoints();
  for (const card of document.querySelectorAll('.skillCard')) {
    const name = card.dataset.skill;
    const owned = !!G.skills[name];
    const btn = card.querySelector('.skillBtn');
    card.classList.toggle('owned', owned);
    btn.disabled = owned || skillPoints() < 1;
    btn.textContent = owned ? 'OWNED' : 'BUY - 1 SP';
  }
}

/* ------------------------------ HUD / DOM ----------------------------------- */
const $ = (id) => document.getElementById(id);

function showHUD() {
  $('hud').classList.remove('hidden');
  $('weaponPanel').classList.remove('hidden');
  $('vitals').classList.remove('hidden');
}
function hideOverlays() {
  $('startScreen').classList.add('hidden');
  $('pauseScreen').classList.add('hidden');
  $('skillsScreen').classList.add('hidden');
  $('factionScreen').classList.add('hidden');
}

function updateHUD() {
  $('shardText').innerHTML = `Shards Collected: <b>${G.shards}/3</b>`;
  const icons = $('shardIcons').children;
  for (let i = 0; i < 3; i++) icons[i].classList.toggle('on', i < G.shards);
  // hotbar: rebuild the weapon slots from the unlocked inventory array
  $('wslots').innerHTML = (P.inventory || ['GLOVE']).map((id, i) => {
    const def = WEAPON_DEFS[id];
    return `<div class="wslot${i === P.activeSlot ? ' active' : ''}" data-wpn="${id}"><span class="wkey">${i + 1}</span>${def ? def.short : id}</div>`;
  }).join('');
  // ammo counter only for ammo-fed weapons (Void Repeater / Railgun)
  const usesAmmo = !!(WEAPON_DEFS[weapon] && WEAPON_DEFS[weapon].ammo);
  const ammoBox = $('ammoBox');
  ammoBox.classList.toggle('hidden', !usesAmmo);
  if (usesAmmo) $('ammoCount').textContent = `${ammo}/${MAX_AMMO}`;
  // active weapon + armor set names in the top HUD (pretty display names)
  const activeDef = WEAPON_DEFS[weapon];
  $('activeWeapon').innerHTML = `WEAPON: <b>${activeDef ? activeDef.name : weapon}</b>`;
  // armor set + shield hearts (+ BROKEN state after a heavy hit shatters it)
  const as = $('armorStatus');
  const shields = G.armor + (G.shieldHearts || 0);
  const armorName = ARMOR_NAMES[P.currentArmor] || P.currentArmor;
  let armorTxt = `ARMOR: ${armorName}${P.armorBroken ? ' (BROKEN)' : ''}`;
  if (P.currentArmor === 'KRATOS' && G.kratosHearts > 0) armorTxt += ` (${G.kratosHearts} RED HEART${G.kratosHearts > 1 ? 'S' : ''})`;
  else if (shields > 0) armorTxt += ` (${shields} SHIELD)`;
  as.textContent = armorTxt;
  as.classList.toggle('on', (P.currentArmor !== 'NONE' && !P.armorBroken) || shields > 0);
  $('levelNum').textContent = G.level;
  $('dustNum').textContent = G.dust;
  $('dustFill').style.width = `${G.dust % 100}%`;
  // orange Rage Meter
  $('rageFill').style.height = `${clamp(G.rage, 0, 100)}%`;
  const hearts = document.querySelectorAll('#hearts .heart');
  for (let i = 0; i < MAX_HP; i++) hearts[i].classList.toggle('on', i < G.hp);
  updateSoulHUD();
}

/* -------- SOUL / HP HUD -------- */
function updateSoulHUD() {
  const pct = clamp(G.soul / MAX_SOUL, 0, 1);
  $('soulFill').style.background = `conic-gradient(var(--neon-cyan) ${(pct * 360).toFixed(1)}deg, #241d3d ${(pct * 360).toFixed(1)}deg 360deg)`;
  $('soulNum').textContent = G.soul;
}
function pulseSoul() {
  const m = $('soulMeter');
  m.classList.remove('pulse');
  void m.offsetWidth;
  m.classList.add('pulse');
}
function flashHearts() {
  const hb = $('hearts');
  hb.classList.remove('flash');
  void hb.offsetWidth;
  hb.classList.add('flash');
}

let toastTimer = null;
function toast(msg, warn, dur = 1900) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('warn', !!warn);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

/* ------------------------------ main loop ----------------------------------- */
let last = performance.now(), acc = 0;
const STEP = 1 / 60;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.1);

  if (freeze > 0) {
    // hit freeze: every animation (time, particles, ghosts, shake) pauses for weight
    freeze -= dt;
  } else {
    G.time += dt;
    for (const p of platforms) {
      if (p.type === 'ghost') p.alpha = 0.5 + 0.5 * Math.sin(G.time * TAU / p.period + p.off);
    }
    updateParticles(dt);
    if (shakeT > 0) shakeT -= dt;

    if (G.state === 'play' && !G.paused) {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 4) {
        updatePlayer(STEP);
        updateEnemies(STEP);
        updateArrows(STEP);
        updateWaves(STEP);
        updateShocks(STEP);
        updateSpells(STEP);
        updatePickups(STEP);
        G.runTime += STEP;
        acc -= STEP;
        steps++;
      }
      if (steps === 4) acc = 0;
      // camera: smooth follow + look-ahead
      const target = cx() + P.facing * 52 - VW * 0.45;
      camX = lerp(camX, clamp(target, 0, LEVEL_W - VW), 1 - Math.exp(-6 * dt));
      // random KrazyWurld dimensional anomaly → neon-red border warning
      anomalyTimer -= dt;
      if (anomalyTimer <= 0) {
        anomalyFlash = 0.1;
        anomalyTimer = rnd(8, 15);
        AudioSys.glitch();
      }
    }
  }

  // anomaly border flash (always decays, even between triggers)
  if (anomalyFlash > 0) {
    anomalyFlash -= dt;
    $('anomalyFlash').style.opacity = String(clamp(anomalyFlash / 0.1, 0, 1));
  } else if ($('anomalyFlash').style.opacity !== '0') {
    $('anomalyFlash').style.opacity = '0';
  }
  // Krazal Rage — pulsing crimson screen border
  $('rageFlash').style.opacity = G.rageActive ? String(0.55 + 0.2 * Math.sin(G.time * 14)) : '0';

  // input queues consumed each frame
  if (input.weaponQueued && (G.state === 'play' || G.state === 'menu')) {
    setWeapon(input.weaponQueued);
    input.weaponQueued = null;
  }
  if (input.pauseQueued) { togglePause(); input.pauseQueued = false; }
  if (input.skillsQueued) { toggleSkills(); input.skillsQueued = false; }
  if (G.paused) { input.attackQueued = false; input.jumpPressed = false; input.castQueued = false; } // no stray inputs on resume
  if (input.restartQueued) {
    if (G.state === 'play' || G.state === 'win') resetLevel();
    input.restartQueued = false;
  }
  if (input.muteQueued) {
    AudioSys.muted = !AudioSys.muted;
    if (AudioSys.master) AudioSys.master.gain.value = AudioSys.muted ? 0 : 0.5;
    $('soundBtn').textContent = AudioSys.muted ? 'OFF' : 'SND';
    input.muteQueued = false;
  }

  render();
}
requestAnimationFrame(frame);

/* ------------------------------ UI wiring ----------------------------------- */
$('jumpIn').addEventListener('click', startGame);
$('playAgainBtn').addEventListener('click', resetLevel);
$('restartBtn').addEventListener('click', () => { if (G.state === 'play' && !factionChoiceOpen) resetLevel(); });
$('soundBtn').addEventListener('click', () => { input.muteQueued = true; });
$('skillsBtn').addEventListener('click', () => { if (G.state === 'play') toggleSkills(); });
for (const card of document.querySelectorAll('.skillCard')) {
  card.querySelector('.skillBtn').addEventListener('click', () => buySkill(card.dataset.skill));
}
for (const card of document.querySelectorAll('.factionCard')) {
  card.addEventListener('click', () => chooseFaction(card.dataset.faction));
}
// click a hotbar slot to equip it — Q / 1-5 also cycle, but clicking the icon is
// the most discoverable way and keeps pointer-only players in the action
$('wslots').addEventListener('click', (e) => {
  const slotEl = e.target.closest('.wslot');
  if (!slotEl || G.state !== 'play' || G.paused) return;
  const idx = Array.prototype.indexOf.call($('wslots').children, slotEl);
  if (P.inventory[idx] && idx !== P.activeSlot) setWeapon({ slot: idx });
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.state === 'play' && !G.paused) togglePause();
});

// pre-draw one frame so the menu shows the world behind the overlay
G.state = 'menu';
buildLevel();
updateHUD();
render();
