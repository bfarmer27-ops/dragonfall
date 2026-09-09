// Dragonfall game loop: wires the film-render modules (render, sky, terrain, water, dressing, dragon, rider)
// around the unchanged flight physics, controls, gates, obstacles, collisions, HUD, audio and settings.
//
// sky.js MUST be the first import: at import time it replaces three's fog shader chunks with the analytic
// height fog, and every material compiled afterwards picks it up with no plumbing (SHARED CONTRACTS v1, 4).
import './sky.js';
import * as THREE from 'three';
import {TIER, setTier, readTierSetting} from './quality.js';
import {createRenderSystem} from './render.js';
import {createSky} from './sky.js';
import {createTerrain, terrainHeight, createArchGeometry, createBoulderGeometry, createRockMaterial, worldSlope} from './terrain.js';
import {createWater} from './water.js';
import {createDressing} from './dressing.js';
import {createDragon, mergeRigid} from './dragon.js';
import {createRider} from './rider.js';
import {wingbeatPose} from './wingbeat.js';
// flight.js is imported without a cache-buster so terrain.js and dressing.js (which import './flight.js')
// share this single module instance with game.js.
import {clamp, damp, centerAt, newFlight, stepFlight, getSpeedMultiplier, PHYSICS_STEP} from './flight.js';
import {readInvertSetting, saveInvertSetting, invertVerticalControls, readControlMode, saveControlMode} from './control-settings.js?v=7';
import {createTilt} from './tilt.js';

const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const query = new URLSearchParams(location.search);
const debug = query.get('debug') === '1';
const showStats = query.get('stats') === '1';

// ---------------------------------------------------------------------------------------------
// Graphics tier. Modules read TIER when their create*() runs, so the choice must happen first.
// ?tier=high|phone overrides for one page load without touching the saved Settings choice.
// ---------------------------------------------------------------------------------------------
{
 const forced = query.get('tier');
 if (forced === 'high' || forced === 'phone') {
  const saved = readTierSetting();
  setTier(forced);
  try { localStorage.setItem('dragonfall-graphics', saved); } catch {}
 }
}
const tier = TIER;

// ---------------------------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------------------------
let viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
const scene = new THREE.Scene();
scene.background = null;   // the sky is a mesh; GTAO needs a null background
const camera = new THREE.PerspectiveCamera(56, viewportWidth / viewportHeight, 0.1, 2200);
let rs;
try {
 rs = createRenderSystem({canvas: $('sky'), scene, camera});
} catch (e) {
 $('error').hidden = false;
 throw e;
}
const renderer = rs.renderer;
rs.setSize(viewportWidth, viewportHeight);

// ---------------------------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------------------------
let flapPhase = 0;
let flight = newFlight(), mode = 'intro', time = 0, lastTime = performance.now(), toastTimer = 0, uiTime = 0, best = 0;
try { best = Number(localStorage.getItem('dragonfall-best-v1')) || 0; } catch {}
$('intro-best').textContent = Math.floor(best).toLocaleString() + ' m';
window.__frames = 0;
window.__hits = 0;

// Deterministic hash shared with the old build so boulders land where they always did (world.html uses the same).
const hash = (a, b = 0) => { const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return n - Math.floor(n); };

// ---------------------------------------------------------------------------------------------
// World: water, terrain, sky, dressing (contract 5)
// ---------------------------------------------------------------------------------------------
const water = createWater({renderer});
const terrain = createTerrain({scene, renderer, water});
const sky = createSky({renderer, scene});
const dressing = createDressing({scene, renderer, sunColor: sky.sunColor, sunDirection: sky.sunDirection});
rs.setSunDirection(sky.sunDirection);
// The lens-flare ghosts draw over the walls whenever the sun disc is unoccluded (three's Lensflare keys occlusion on
// the sun point only); in the real frame they read as two orange discs on the rock, so the flare stays off. Bloom and
// the sun-shaft pass already give the sun its halo.
if (sky.lensflare) sky.lensflare.visible = false;

// ---------------------------------------------------------------------------------------------
// Dragon and rider
// ---------------------------------------------------------------------------------------------
const model = createDragon(renderer);
const {dragon} = model;
scene.add(dragon);
model.setSun(sky.sunDirection, sky.sunColor);
const rider = createRider({saddleAnchor: model.saddleAnchor, bridleAnchors: model.bridleAnchors});
const eyeBase = rider.eye.position.clone();   // rest position of the eye in saddle metres; hit recovery offsets from it
if (tier === 'phone') {
 // Phone budget: the rider's shadow falls behind the eye (sun ahead), and the 43 pommel stitches are one more call.
 rider.group.traverse(m => { if (m.isMesh) { m.castShadow = false; if (m.material === rider.materials.thread) m.visible = false; } });
 if (dressing.hazes && dressing.hazes[3]) dressing.hazes[3].visible = false;
 // The two farthest mist banks (970 m and 1190 m out) sit inside the fog on phone anyway.
 for (const b of (dressing.banks || []).slice(4)) b.sprite.visible = false;
}

// Faint wingtip streamers make lift and banking legible at a glance (chase camera only: they sit behind the eye).
const trailMaterial = new THREE.LineBasicMaterial({color: 0xb2f4e5, transparent: true, opacity: 0.24, depthWrite: false});
const trails = [];
for (let i = 0; i < 2; i++) {
 const g = new THREE.BufferGeometry();
 g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(22 * 3), 3));
 const line = new THREE.Line(g, trailMaterial);
 line.frustumCulled = false;
 scene.add(line);
 trails.push({line, points: []});
}

// ---------------------------------------------------------------------------------------------
// Gates: PBR ring (emissive 1.2, just over the bloom threshold so it glows softly), faint additive halo, four ticks.
// ---------------------------------------------------------------------------------------------
const gates = [];
const gateGeo = new THREE.TorusGeometry(10.5, 0.13, 7, 64), haloGeo = new THREE.TorusGeometry(10.5, 0.52, 6, 64);
const gateMaterial = new THREE.MeshStandardMaterial({color: 0xa7ffdc, emissive: 0x66eec9, emissiveIntensity: 1.2, roughness: 0.35, metalness: 0.4});
const haloMaterial = new THREE.MeshBasicMaterial({color: 0x69edda, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending});
// Ticks share the ring material so mergeRigid bakes ring + 4 ticks into ONE mesh (2 draw calls per gate with the halo).
// Beyond VISIBLE_RANGE the fog hides a gate or rock anyway; phone culls closer to stay under the draw-call budget.
const VISIBLE_RANGE = tier === 'phone' ? 700 : 1100;
function setGate(g, n) {
 g.n = n;
 g.d = 160 + n * 185;
 g.x = centerAt(g.d) + Math.sin(n * 1.8) * 16;
 g.alt = 27 + Math.sin(n * 0.85) * 10;
 g.passed = false;
 g.caught = false;
 g.group.visible = true;
 g.group.position.set(g.x, g.alt - g.d * worldSlope, -g.d);
 g.group.rotation.z = 0;
}
for (let i = 0; i < 10; i++) {
 const group = new THREE.Group();
 group.add(new THREE.Mesh(gateGeo, gateMaterial), new THREE.Mesh(haloGeo, haloMaterial));
 for (let j = 0; j < 4; j++) {
  const tick = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), gateMaterial);
  tick.position.set(Math.cos(j * Math.PI / 2) * 10.5, Math.sin(j * Math.PI / 2) * 10.5, 0);
  group.add(tick);
 }
 scene.add(group);
 mergeRigid(group);
 const gate = {group};
 setGate(gate, i);
 gates.push(gate);
}

// ---------------------------------------------------------------------------------------------
// Obstacles (boulders) and arches: terrain geometries drawn with the shared triplanar rock material.
// ---------------------------------------------------------------------------------------------
const rockGeometry = createBoulderGeometry();
// Boulders share the wall textures but read their height 40 m higher, so they show the warm sandstone banding instead
// of the dark wet-basalt tint every rock under ~50 m gets (they read as flat grey pillars at 150-300 m otherwise).
const boulderMaterial = createRockMaterial(renderer, {heightOffset: 40, textures: terrain.rockMaterial.userData.textures});
const obstacles = [];
function setObstacle(o, n) {
 o.n = n;
 o.d = 300 + n * 240;
 o.x = centerAt(o.d) + (hash(n, 3) - 0.5) * 59;
 o.height = 16 + hash(n, 5) * 40;
 o.radius = 3.1 + hash(n, 6) * 2.4;
 o.mesh.position.set(o.x, o.height * 0.5 - o.d * worldSlope, -o.d);
 o.mesh.scale.set(o.radius / 2, o.height, o.radius / 2);
 o.mesh.rotation.y = hash(n, 7) * Math.PI;
}
for (let i = 0; i < 9; i++) {
 const mesh = new THREE.Mesh(rockGeometry, boulderMaterial);
 scene.add(mesh);
 const o = {mesh};
 setObstacle(o, i);
 obstacles.push(o);
}
// Weathered stone arches frame the descent, like the narrow passages in the reference.
const archGeometry = createArchGeometry();
const arches = [];
function setArch(a, n) {
 a.n = n;
 a.d = 685 + n * 740;
 a.x = centerAt(a.d);
 a.mesh.position.set(a.x, -a.d * worldSlope, -a.d);
}
for (let i = 0; i < 3; i++) {
 const mesh = new THREE.Mesh(archGeometry, terrain.rockMaterial);
 scene.add(mesh);
 const a = {mesh};
 setArch(a, i);
 arches.push(a);
}

// ---------------------------------------------------------------------------------------------
// Controls (two thumbs default, tilt, keyboard) - unchanged behaviour
// ---------------------------------------------------------------------------------------------
let controlMode = readControlMode(), invertVertical = readInvertSetting(controlMode);
const tilt = createTilt();
const pointers = {left: null, right: null}, inputs = {left: 0, right: 0}, keys = new Set();
function updatePad(side, v, active) {
 const el = $(side + '-wing');
 el.classList.toggle('active', active);
 if (active) el.classList.add('touched');   // after the first touch the LEFT WING / RIGHT WING labels fade out (CSS)
 el.querySelector('.thumb').style.top = (66 - v * 53) + 'px';
}
function resetInputs() {
 for (const side of ['left', 'right']) {
  if (pointers[side]) { try { $('game').releasePointerCapture(pointers[side].id); } catch {} }
  pointers[side] = null;
  inputs[side] = 0;
  updatePad(side, 0, false);
 }
 keys.clear();
}
const padRange = () => clamp(viewportHeight * 0.115, 55, 105);
$('game').addEventListener('pointerdown', e => {
 if (controlMode === 'tilt' || mode !== 'playing' || e.target.closest('button') || e.target.closest('#modal')) return;
 const side = e.clientX < viewportWidth / 2 ? 'left' : 'right';
 if (pointers[side]) return;
 pointers[side] = {id: e.pointerId, y: e.clientY};
 $('game').setPointerCapture(e.pointerId);
 inputs[side] = 0;
 updatePad(side, 0, true);
 e.preventDefault();
});
$('game').addEventListener('pointermove', e => {
 for (const side of ['left', 'right']) {
  const p = pointers[side];
  if (p?.id === e.pointerId) {
   let v = clamp((p.y - e.clientY) / padRange(), -1, 1);
   v = Math.abs(v) < 0.02 ? 0 : Math.sign(v) * (Math.abs(v) - 0.02) / 0.98;
   inputs[side] = v;
   updatePad(side, v, true);
   e.preventDefault();
  }
 }
});
function pointerEnd(e) {
 for (const side of ['left', 'right']) {
  if (pointers[side]?.id === e.pointerId) { pointers[side] = null; inputs[side] = 0; updatePad(side, 0, false); }
 }
}
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('game').addEventListener(event, pointerEnd);
addEventListener('keydown', e => {
 if ($('settings-dialog').open) return;
 if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Escape', 'w', 's', 'W', 'S', 'i', 'k', 'I', 'K'].includes(e.key)) {
  e.preventDefault();
  if (e.repeat && [' ', 'Escape'].includes(e.key)) return;
  if (e.key === 'Escape' || e.key === ' ') {
   if (mode === 'playing') pause();
   else if (mode === 'paused') resume();
   else if (mode === 'intro' && e.key === ' ') start();
   return;
  }
  keys.add(e.key.toLowerCase());
 }
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
function controls() {
 // ?debug=1 lets a headless test drive the wings through window.__forceInput = [l, r].
 if (debug && Array.isArray(window.__forceInput)) {
  const [fl, fr] = window.__forceInput;
  const l = clamp(fl || 0, -1, 1), r = clamp(fr || 0, -1, 1);
  updatePad('left', l, l !== 0);
  updatePad('right', r, r !== 0);
  return [l, r];
 }
 const t = controlMode === 'tilt' ? tilt.read() : {pitch: 0, bank: 0};
 // Arrow up always climbs: the Invert setting is a thumb/tilt gesture preference, so the arrow term is pre-flipped
 // to cancel the inversion applied at the end of this function.
 const arrowPitch = ((keys.has('arrowup') ? 1 : 0) - (keys.has('arrowdown') ? 1 : 0)) * (invertVertical ? -1 : 1);
 const pitch = t.pitch + arrowPitch;
 const turn = t.bank + (keys.has('arrowleft') ? 1 : 0) - (keys.has('arrowright') ? 1 : 0);
 const l = clamp(inputs.left + (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0) + pitch - turn, -1, 1);
 const r = clamp(inputs.right + (keys.has('i') ? 1 : 0) - (keys.has('k') ? 1 : 0) + pitch + turn, -1, 1);
 updatePad('left', l, !!pointers.left || l !== 0);
 updatePad('right', r, !!pointers.right || r !== 0);
 return invertVerticalControls(l, r, invertVertical);
}

// ---------------------------------------------------------------------------------------------
// HUD helpers, game flow
// ---------------------------------------------------------------------------------------------
function toast(text) {
 $('toast').textContent = text;
 $('toast').classList.add('show');
 clearTimeout(toastTimer);
 toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2000);
}
function updateHealth() {
 document.querySelectorAll('.health i').forEach((el, i) => el.classList.toggle('lost', i >= flight.health));
 document.querySelector('.health').setAttribute('aria-label', flight.health + ' shields remaining');
}
function saveBest() {
 if (flight.distance > best) {
  best = Math.floor(flight.distance);
  try { localStorage.setItem('dragonfall-best-v1', String(best)); } catch {}
 }
}
async function start() {
 if (!await prepareControls()) return;
 resetInputs();
 flapPhase = 0;
 flight = newFlight();
 terrain.reset();
 dressing.reset();
 gates.forEach((g, i) => setGate(g, i));
 obstacles.forEach((o, i) => setObstacle(o, i));
 arches.forEach((a, i) => setArch(a, i));
 trails.forEach(t => t.points = []);
 mode = 'playing';
 document.body.classList.add('playing');
 $('modal').hidden = true;
 updateHealth();
 updateUI();
 if (cameraMode === 'chase') positionCamera(1, true);
 placeWingPads();
 toast(controlMode === 'tilt' ? 'TILT TO STEER · LIFT TOP EDGE TO CLIMB' : 'THUMBS ON WINGS · FIND YOUR FLOW');
 if (audioEnabled) startAudio();
}
function pause() {
 if (mode !== 'playing') return;
 mode = 'paused';
 resetInputs();
 $('modal').hidden = false;
 $('modal-eyebrow').textContent = 'TAKE A BREATH';
 $('modal-title').textContent = 'Flight paused';
 $('modal-message').textContent = 'The canyon will wait.';
 $('run-stats').hidden = true;
 $('resume').innerHTML = 'RESUME FLIGHT <span>↗</span>';
 setAudioLevel(0);
}
async function resume() {
 if (mode === 'over') { start(); return; }
 if (!await prepareControls()) return;
 mode = 'playing';
 resetInputs();
 $('modal').hidden = true;
 lastTime = performance.now();
 if (audioEnabled) startAudio();
}
function gameOver() {
 mode = 'over';
 saveBest();
 resetInputs();
 $('modal').hidden = false;
 $('modal-eyebrow').textContent = flight.distance >= best ? 'A NEW PERSONAL BEST' : 'THE DESCENT ENDS';
 $('modal-title').textContent = 'One more flight?';
 $('modal-message').textContent = 'Every turn brings you closer to the flow.';
 $('run-stats').hidden = false;
 $('final-distance').textContent = Math.floor(flight.distance).toLocaleString();
 $('final-gates').textContent = flight.gates;
 $('resume').innerHTML = 'FLY AGAIN <span>↗</span>';
 setAudioLevel(0.015);
}
function hit(reason) {
 if (flight.invulnerable > 0) return;
 window.__hits++;
 flight.health--;
 flight.invulnerable = 3;
 updateHealth();
 // Hurt feedback: red skin pulse on the dragon, camera shake on the rider, the red screen flash.
 model.setHurt(0.25);
 rider.shake(0.4);
 $('flash').style.opacity = '1';
 setTimeout(() => $('flash').style.opacity = '0', 220);
 if (navigator.vibrate) navigator.vibrate(70);
 if (audioEnabled) chime(95, 0.23);
 if (flight.health <= 0) { gameOver(); return; }
 const altBefore = flight.alt, xBefore = flight.x;
 flight.alt = Math.max(flight.alt + 9, 18);
 flight.x = THREE.MathUtils.lerp(flight.x, centerAt(flight.distance), 0.48);
 hideHitCut(flight.x - xBefore, flight.alt - altBefore);
 flight.speed *= 0.8;
 toast(reason + ' · ' + flight.health + ' SHIELDS LEFT');
}

// ---------------------------------------------------------------------------------------------
// Settings dialog: controls, invert, graphics tier, camera mode
// ---------------------------------------------------------------------------------------------
let resumeAfterSettings = false;
async function prepareControls() {
 if (controlMode !== 'tilt') return true;
 try {
  await tilt.enable();
  $('tilt-status').textContent = 'Ready. Your current phone position is level flight.';
  return true;
 } catch (e) {
  $('tilt-status').textContent = e.message;
  resumeAfterSettings = false;
  syncSettings();
  if (!$('settings-dialog').open) $('settings-dialog').showModal();
  return false;
 }
}
function syncSettings() {
 const isTilt = controlMode === 'tilt';
 $('control-mode').value = controlMode;
 $('tilt-options').hidden = !isTilt;
 document.body.classList.toggle('tilt-mode', isTilt);
 $('invert-vertical').checked = invertVertical;
 $('invert-description').textContent = isTilt
  ? (invertVertical ? 'Lower the top edge to climb; lift it to dive.' : 'Lift the top edge to climb; lower it to dive.')
  : (invertVertical ? 'Slide both thumbs down to climb, up to dive.' : 'Slide both thumbs up to climb, down to dive.');
 $('climb-gesture').textContent = isTilt ? (invertVertical ? 'LOWER' : 'LIFT') : (invertVertical ? '↓ ↓' : '↑ ↑');
 $('dive-gesture').textContent = isTilt ? (invertVertical ? 'LIFT' : 'LOWER') : (invertVertical ? '↑ ↑' : '↓ ↓');
 $('bank-left-gesture').textContent = isTilt ? 'TILT ←' : '↓ ↑';
 $('bank-right-gesture').textContent = isTilt ? 'TILT →' : '↑ ↓';
 document.querySelector('.mobile-hint').textContent = isTilt
  ? 'Hold your phone comfortably, then tap Take flight. Tilt left/right to turn.'
  : 'Slide each thumb to steer. Rotate your phone for landscape.';
 $('graphics').value = readTierSetting();
 $('graphics-description').textContent = 'Auto picks Phone on handhelds. Now running: ' + (tier === 'high' ? 'High (film)' : 'Phone (fast)') + '. Changing it restarts the game.';
 $('camera-mode').value = cameraMode;
}
$('control-mode').addEventListener('change', () => {
 controlMode = $('control-mode').value;
 saveControlMode(controlMode);
 invertVertical = readInvertSetting(controlMode);
 resetInputs();
 syncSettings();
});
$('calibrate-tilt').onclick = async () => { await prepareControls(); };
$('settings').onclick = () => {
 resumeAfterSettings = mode === 'playing';
 if (resumeAfterSettings) pause();
 resetInputs();
 syncSettings();
 $('settings-dialog').showModal();
};
$('invert-vertical').addEventListener('change', () => {
 invertVertical = $('invert-vertical').checked;
 saveInvertSetting(invertVertical, controlMode);
 resetInputs();
 syncSettings();
});
$('graphics').addEventListener('change', () => {
 // Modules read the tier when they are created, so a reload is the honest way to apply a new tier.
 setTier($('graphics').value);
 toast('RESTARTING WITH NEW GRAPHICS');
 setTimeout(() => location.reload(), 350);
});
$('camera-mode').addEventListener('change', () => {
 setCameraMode($('camera-mode').value);
 try { localStorage.setItem('dragonfall-camera', cameraMode); } catch {}
});
$('settings-dialog').addEventListener('close', () => {
 resetInputs();
 if (resumeAfterSettings && mode === 'paused' && !document.hidden) resume();
 resumeAfterSettings = false;
});
$('start').onclick = start;
$('pause').onclick = pause;
$('resume').onclick = resume;
$('restart').onclick = start;
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('blur', () => { resetInputs(); pause(); });
async function allowRotation() {
 try {
  screen.orientation?.unlock?.();
  if (document.fullscreenElement && screen.orientation?.lock) await screen.orientation.lock('any');
 } catch { /* The browser may require device Auto-rotate to be enabled. */ }
}
$('fullscreen').onclick = async () => {
 try {
  if (document.fullscreenElement) {
   await document.exitFullscreen();
  } else if (document.documentElement.requestFullscreen) {
   await document.documentElement.requestFullscreen({navigationUI: 'hide'});
   await allowRotation();
  } else {
   toast('ROTATE YOUR PHONE · ENABLE AUTO-ROTATE');
  }
  scheduleViewportResize();
 } catch {
  toast('ENABLE AUTO-ROTATE, THEN TURN YOUR PHONE');
 }
};

// ---------------------------------------------------------------------------------------------
// Audio (wind + chimes) - unchanged
// ---------------------------------------------------------------------------------------------
let audioEnabled = false, audioContext, windGain, windFilter;
function startAudio() {
 try {
  if (!audioContext) {
   audioContext = new (window.AudioContext || window.webkitAudioContext)();
   const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 3, audioContext.sampleRate), data = buffer.getChannelData(0);
   let p = 0;
   for (let i = 0; i < data.length; i++) { p = (p + Math.random() * 0.04 - 0.02) / 1.02; data[i] = p * 5; }
   const src = audioContext.createBufferSource();
   src.buffer = buffer;
   src.loop = true;
   windFilter = audioContext.createBiquadFilter();
   windFilter.type = 'lowpass';
   windFilter.frequency.value = 600;
   windGain = audioContext.createGain();
   windGain.gain.value = 0;
   src.connect(windFilter).connect(windGain).connect(audioContext.destination);
   src.start();
  }
  audioContext.resume();
  setAudioLevel(0.14);
 } catch {
  audioEnabled = false;
 }
}
function setAudioLevel(v) {
 if (windGain) windGain.gain.setTargetAtTime(audioEnabled ? v : 0, audioContext.currentTime, 0.2);
}
function chime(freq, duration) {
 if (!audioContext) return;
 const osc = audioContext.createOscillator(), g = audioContext.createGain();
 osc.type = 'sine';
 osc.frequency.setValueAtTime(freq, audioContext.currentTime);
 osc.frequency.exponentialRampToValueAtTime(freq * 1.4, audioContext.currentTime + duration);
 g.gain.setValueAtTime(0.075, audioContext.currentTime);
 g.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
 osc.connect(g).connect(audioContext.destination);
 osc.start();
 osc.stop(audioContext.currentTime + duration);
}
$('sound').onclick = () => {
 audioEnabled = !audioEnabled;
 if (audioEnabled) startAudio(); else setAudioLevel(0);
 $('sound').setAttribute('aria-label', audioEnabled ? 'Mute sound' : 'Enable sound');
 $('sound-waves').setAttribute('d', audioEnabled ? 'M15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14' : 'm16 9 6 6m0-6-6 6');
};

// ---------------------------------------------------------------------------------------------
// Camera rig: 'rider' (from the saddle, default) or 'chase' (behind the dragon, the old framing)
// ---------------------------------------------------------------------------------------------
let cameraMode = 'rider';
try { if (localStorage.getItem('dragonfall-camera') === 'chase') cameraMode = 'chase'; } catch {}
if (query.get('camera') === 'chase' || query.get('camera') === 'rider') cameraMode = query.get('camera');
const cameraWorldPos = new THREE.Vector3(), headWorldPos = new THREE.Vector3();
function setCameraMode(next) {
 cameraMode = next === 'chase' ? 'chase' : 'rider';
 const isRider = cameraMode === 'rider';
 // The rider's hands, reins and saddle only exist from the saddle; the streamers only make sense from behind.
 rider.group.visible = isRider;
 for (const t of trails) t.line.visible = !isRider;
 if (isRider) {
  scene.remove(camera);
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);
  camera.up.set(0, 1, 0);
  rider.eye.add(camera);
  rs.setFocusDistance(12);
 } else {
  rider.eye.remove(camera);
  scene.add(camera);
  rs.setMotion(0, 0, 0);
  rs.setFocusDistance(17);
  positionCamera(1, true);
 }
 placeWingPads();
}

// Chase camera. The spot 17 m behind and 6.4 m above the dragon is often inside the rock next to a wall (terrainHeight
// now includes spires and terraces), so the camera is pulled in along the dragon->camera line while rock stands above
// that line (3 samples, down to 8 m) and then lifted to at least 2.5 m over the collision profile at its final spot.
// terrainHeight is conservative (the visible mesh only ever recedes from it), so clearing it clears the mesh.
const target = new THREE.Vector3(), desiredCamera = new THREE.Vector3(), lookTarget = new THREE.Vector3();
function chaseGroundAt(x, d) { return terrainHeight(x, d) - d * worldSlope; }
function keepChaseCameraOutOfRock(cam, dist) {
 const h = flight.alt - flight.distance * worldSlope;
 let camDist = dist;
 for (let attempt = 0; attempt < 4; attempt++) {
  let blocked = false;
  for (const t of [0.4, 0.7, 1]) {
   const d = flight.distance - camDist * t;
   const x = flight.x + (cam.x - flight.x) * t, y = h + (cam.y - h) * t;
   if (chaseGroundAt(x, d) > y - 1.5) blocked = true;
  }
  if (!blocked || camDist <= 8) break;
  camDist = Math.max(8, camDist - 3);
 }
 cam.z = -flight.distance + camDist;
 cam.y = Math.max(cam.y, chaseGroundAt(cam.x, flight.distance - camDist) + 2.5);
}
const cameraAnchor = new THREE.Vector3(), newAnchor = new THREE.Vector3(), cameraTravel = new THREE.Vector3();
function positionCamera(dt, instant = false) {
 const aspect = viewportWidth / viewportHeight, dist = aspect < 0.85 ? 19 : aspect < 1.2 ? 18 : 17, h = flight.alt - flight.distance * worldSlope;
 newAnchor.set(flight.x, h, -flight.distance);
 if (!instant) {
  cameraTravel.subVectors(newAnchor, cameraAnchor);
  camera.position.add(cameraTravel);
  lookTarget.add(cameraTravel);
 }
 cameraAnchor.copy(newAnchor);
 const steeringLead = flight.vx / getSpeedMultiplier();
 desiredCamera.set(flight.x + steeringLead * 0.035, h + 6.4, -flight.distance + dist);
 keepChaseCameraOutOfRock(desiredCamera, dist);
 target.set(flight.x + clamp(steeringLead * 0.14, -7, 7), h + 1.5, -flight.distance - 35);
 camera.position.lerp(desiredCamera, instant ? 1 : 1 - Math.exp(-15 * dt));
 lookTarget.lerp(target, instant ? 1 : 1 - Math.exp(-12 * dt));
 camera.up.set(-flight.roll * 0.06, 1, 0);
 camera.lookAt(lookTarget);
 const targetFov = (aspect < 0.85 ? 67 : 61) + (flight.speed / getSpeedMultiplier() - 35) * 0.11;
 camera.fov = instant ? targetFov : damp(camera.fov, targetFov, 2, dt);
 camera.aspect = aspect;
 camera.updateProjectionMatrix();
}

// A hit moves the dragon 8-12 m in one physics step (up and toward the canyon centre). The rider camera is hard-parented
// to the saddle, so without this the view would cut. The eye is offset by the opposite of that jump (dragon-local
// metres) and the offset is damped back to zero over ~0.5 s, so the correction reads as a smooth recovery.
const hitOffset = new THREE.Vector3(), _hitLocal = new THREE.Vector3(), _hitQuat = new THREE.Quaternion();
function hideHitCut(dx, dAlt) {
 if (cameraMode !== 'rider') return;
 _hitLocal.set(-dx, -dAlt, 0).applyQuaternion(_hitQuat.copy(dragon.quaternion).invert());
 hitOffset.add(_hitLocal);
}

// Rider camera: the camera hangs off rider.eye (which owns pitch, roll, yaw, bob and shake); here we only
// widen the field of view with speed, feed the reins the steering, and drive DOF focus and turn motion blur.
let prevRoll = 0;
function updateRiderCamera(dt, l, r) {
 const aspect = viewportWidth / viewportHeight;
 const mult = getSpeedMultiplier();
 rider.setSteeringLead(flight.vx / mult);
 rider.update(l, r, flight, dt);
 hitOffset.x = damp(hitOffset.x, 0, 6, dt);
 hitOffset.y = damp(hitOffset.y, 0, 6, dt);
 hitOffset.z = damp(hitOffset.z, 0, 6, dt);
 rider.eye.position.x = eyeBase.x + hitOffset.x;   // rider.update owns y (bob + thump); x/z are ours
 rider.eye.position.y += hitOffset.y;
 rider.eye.position.z = eyeBase.z + hitOffset.z;
 // 16:9 base fov 62 (was 56) so both wing leading edges cross the frame; portrait stays 74.
 const targetFov = (aspect < 0.85 ? 74 : 62) + (flight.speed / mult - 35) * 0.11 + (flight.pitch < -0.15 ? 4 : 0);
 camera.fov = damp(camera.fov, targetFov, 2, dt);
 camera.aspect = aspect;
 camera.updateProjectionMatrix();
 dragon.updateMatrixWorld(true);
 camera.getWorldPosition(cameraWorldPos);
 model.headAnchor.getWorldPosition(headWorldPos);
 rs.setFocusDistance(cameraWorldPos.distanceTo(headWorldPos));
 // Turn motion blur: walls streak sideways on a hard bank, slightly forward at speed.
 const dRoll = dt > 0 ? (flight.roll - prevRoll) / dt : 0;
 prevRoll = flight.roll;
 const strength = clamp(Math.abs(dRoll) * 0.35 + Math.max(0, flight.speed / mult - 45) / 40, 0, 1);
 rs.setMotion(strength, -Math.sign(dRoll) * 0.9, 0.35);
}

// Thumb pads. Landscape: CSS anchors them to the bottom corners (inline styles cleared so the stylesheet wins).
// Portrait: rider mode keeps the stylesheet's default spots; chase mode projects the wing roots like before.
function placeWingPads() {
 const landscape = viewportWidth > viewportHeight;
 // pads-corner: the stylesheet parks both pads in the bottom corners (landscape, and portrait rider mode).
 document.body.classList.toggle('pads-corner', landscape || cameraMode === 'rider');
 if (landscape || cameraMode === 'rider') {
  for (const side of ['left', 'right']) { const el = $(side + '-wing'); el.style.left = ''; el.style.top = ''; }
  return;
 }
 camera.updateMatrixWorld();
 for (const [side, x] of [['left', -3.9], ['right', 3.9]]) {
  const p = new THREE.Vector3(flight.x + x, flight.alt - flight.distance * worldSlope + 0.2, -flight.distance - 1).project(camera);
  const el = $(side + '-wing');
  el.style.left = ((p.x * 0.5 + 0.5) * 100) + '%';
  el.style.top = ((0.5 - p.y * 0.5) * viewportHeight + 8) + 'px';
 }
}

// ---------------------------------------------------------------------------------------------
// Dragon animation, world updates
// ---------------------------------------------------------------------------------------------
function animateDragon(dt, l, r) {
 const h = flight.alt - flight.distance * worldSlope;
 dragon.position.set(flight.x, h, -flight.distance);
 dragon.rotation.set(flight.pitch, flight.yaw, flight.roll, 'YXZ');
 const pose = wingbeatPose(flapPhase, (l + r) * 0.5, flight.speed / getSpeedMultiplier());
 const prevPhase = ((flapPhase % TAU) + TAU) % TAU;
 flapPhase += dt * Math.PI * 2 * pose.frequency;
 // The start of the power stroke (phase wrapped) is the wingbeat thump the rider feels.
 if (((flapPhase % TAU) + TAU) % TAU < prevPhase) rider.beat();
 dragon.position.y += pose.body * 1.6;   // the dragon is scaled 1.6, so the bob stays proportional
 model.update(pose, flight, l, r, time);
 dragon.updateMatrixWorld(true);
 if (cameraMode === 'chase') {
  for (let i = 0; i < 2; i++) {
   const tip = model.wingTip(i, pose), t = trails[i];
   t.points.unshift(tip);
   if (t.points.length > 22) t.points.pop();
   const pos = t.line.geometry.attributes.position;
   for (let j = 0; j < 22; j++) {
    const v = t.points[Math.min(j, t.points.length - 1)];
    pos.setXYZ(j, v.x, v.y, v.z);
   }
   pos.needsUpdate = true;
   t.line.visible = mode !== 'over';
  }
 }
}

function updateWorld(dt) {
 const mult = getSpeedMultiplier();
 for (const g of gates) {
  const relative = g.d - flight.distance;
  if (!g.passed && relative < 0) {
   g.passed = true;
   if (mode === 'playing' && Math.hypot(flight.x - g.x, flight.alt - g.alt) < 10.5) {
    flight.gates++;
    flight.speed = Math.min(flight.speed + 4 * mult, 72 * mult);
    g.caught = true;
    toast(flight.gates % 5 === 0 ? 'BEAUTIFUL LINE · ' + flight.gates + ' GATES' : 'GATE CAUGHT +1');
    if (audioEnabled) chime(600 + flight.gates % 5 * 90, 0.32);
   }
  }
  if (relative < -100) setGate(g, g.n + gates.length);
  g.group.visible = !g.caught && relative < VISIBLE_RANGE;
  g.group.rotation.z += dt * 0.12;
  const pulse = 1 + Math.sin(time * 1.9 + g.n) * 0.015;
  g.group.scale.setScalar(pulse);
 }
 for (const o of obstacles) {
  const relative = o.d - flight.distance;
  const bodyRadius = o.radius * (1.4 - 0.7 * clamp(flight.alt / o.height, 0, 1)) * 1.2;
  if (mode === 'playing' && Math.hypot(relative, flight.x - o.x) < bodyRadius + 1.4 && flight.alt < o.height + 1.5) hit('ROCK GRAZE');
  if (relative < -130) setObstacle(o, o.n + obstacles.length);
  o.mesh.visible = relative < VISIBLE_RANGE;
 }
 for (const a of arches) {
  const rel = a.d - flight.distance, x = flight.x - a.x;
  const top = 66 * (1 - (x / 55) ** 2);
  // The arch tube is now 10 m thick (was 6.7), so the graze band widened from 8 to 10; the curve is unchanged.
  if (mode === 'playing' && Math.abs(rel) < 9 && Math.abs(x) < 56 && Math.abs(flight.alt - top) < 10) hit('ARCH GRAZE');
  if (rel < -160) setArch(a, a.n + arches.length);
  a.mesh.visible = rel < VISIBLE_RANGE;
 }
 if (mode === 'playing') {
  const ground = terrainHeight(flight.x, flight.distance);
  // The wings (7 m either side) and the head (3 m ahead) test the rock too, so the 1.6-scale dragon can no longer
  // fly with a wing or the rider's eye inside a wall beside it (single-point test before; cheap CPU noise calls).
  const wingRock = Math.max(terrainHeight(flight.x - 7, flight.distance), terrainHeight(flight.x + 7, flight.distance));
  const headRock = terrainHeight(flight.x, flight.distance + 3);
  if (flight.alt < 3) hit('WATER GRAZE');
  else if (flight.alt < ground + 1.8 || flight.alt < headRock + 1.8) hit('CLIFF GRAZE');
  else if (flight.alt + 1.8 < wingRock) hit('WING GRAZE');
  if (flight.alt > 84 && flight.elapsed % 4 < dt) toast('THIN AIR · LOWER YOUR WINGS');
 }
}
function updateUI() {
 $('meters').textContent = Math.floor(flight.distance).toLocaleString();
 $('speed').textContent = Math.round(flight.speed * 3.6);
 $('altitude').textContent = Math.max(0, Math.round(flight.alt));
 $('gates').textContent = flight.gates;
}

// ---------------------------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------------------------
let resizeFrame = 0, rotationTimer = 0;
function resizeViewport() {
 resizeFrame = 0;
 const rect = $('game').getBoundingClientRect();
 const width = Math.max(1, Math.round(rect.width || window.innerWidth)), height = Math.max(1, Math.round(rect.height || window.innerHeight));
 const changed = width !== viewportWidth || height !== viewportHeight;
 if (!changed) return;
 const rotated = (width > height) !== (viewportWidth > viewportHeight);
 viewportWidth = width;
 viewportHeight = height;
 rs.setSize(width, height);
 camera.aspect = width / height;
 camera.updateProjectionMatrix();
 if (rotated) resetInputs();
 if (cameraMode === 'chase') positionCamera(1, true);
 placeWingPads();
}
function scheduleViewportResize() { if (!resizeFrame) resizeFrame = requestAnimationFrame(resizeViewport); }
function handleRotation() {
 tilt.rotate();
 resetInputs();
 scheduleViewportResize();
 clearTimeout(rotationTimer);
 rotationTimer = setTimeout(resizeViewport, 250);
}
addEventListener('resize', scheduleViewportResize);
addEventListener('orientationchange', handleRotation);
window.visualViewport?.addEventListener('resize', scheduleViewportResize);
window.screen?.orientation?.addEventListener('change', handleRotation);
document.addEventListener('fullscreenchange', () => {
 allowRotation();
 handleRotation();
 $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
});
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(scheduleViewportResize).observe($('game'));
allowRotation();

// ---------------------------------------------------------------------------------------------
// ?stats=1 overlay: tier, fps, draw calls, triangles, pass count, pixel ratio (every 0.5 s)
// ---------------------------------------------------------------------------------------------
const statsEl = $('stats');
let statsTime = 0, statsFrames = 0;
const fpsSamples = [];
function updateStats(dt) {
 // dt here is the real wall-clock frame time (unclamped) so the fps number is honest on slow machines.
 fpsSamples.push(dt);
 if (fpsSamples.length > 30) fpsSamples.shift();
 statsTime += dt;
 statsFrames++;
 if (statsTime < 0.5) return;
 statsTime = 0;
 const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
 const info = renderer.info.render;
 statsEl.textContent = `tier ${tier} | fps ${(avg > 0 ? 1 / avg : 0).toFixed(0)} | calls ${info.calls} | tris ${info.triangles} | passes ${rs.composer.passes.length} | ratio ${rs.getPixelRatio().toFixed(2)} | camera ${cameraMode} | d ${Math.floor(flight.distance)} hits ${window.__hits}`;
}
if (showStats) statsEl.hidden = false;
// ?debug=1 also exposes the live objects for headless inspection (never used by the game itself).
if (debug) window.__game = {camera, rider, model, dragon, scene, rs, sky, terrain, dressing, hitOffset, positionCamera, get flight() { return flight; }, get mode() { return mode; }, get cameraMode() { return cameraMode; }, setCameraMode, hit};

// ---------------------------------------------------------------------------------------------
// Frame loop: controls -> physics + world -> dragon -> camera -> terrain/water/dressing/sky -> UI -> render
// ---------------------------------------------------------------------------------------------
syncSettings();
setCameraMode(cameraMode);
updateUI();
function frame(now) {
 requestAnimationFrame(frame);
 const rawDt = (now - lastTime) / 1000;
 const dt = clamp(rawDt, 0, 0.1);
 lastTime = now;
 time += dt;
 let l = 0, r = 0;
 if (mode === 'playing') {
  [l, r] = controls();
  const steps = Math.max(1, Math.ceil(dt / PHYSICS_STEP)), step = dt / steps;
  for (let i = 0; i < steps && mode === 'playing'; i++) {
   stepFlight(flight, l, r, step);
   updateWorld(step);
  }
 } else if (mode === 'intro') {
  const mult = getSpeedMultiplier();
  flight.distance += dt * 20 * mult;
  flight.x = centerAt(flight.distance);
  flight.alt = 29 + Math.sin(time * 0.28) * 2;
  flight.roll = Math.cos(time * 0.28) * 0.05;
  flight.yaw = 0;
  flight.speed = 32 * mult;
  updateWorld(dt);
 }
 if (mode === 'playing' || mode === 'intro') {
  animateDragon(dt, l, r);
  if (cameraMode === 'rider') updateRiderCamera(dt, l, r);
  else positionCamera(dt);
 }
 terrain.update(flight.distance);
 water.update(time);
 dressing.update(time, flight);
 camera.getWorldPosition(cameraWorldPos);
 sky.update(time, cameraWorldPos, dragon.position);
 uiTime += dt;
 if (uiTime > 0.12) {
  uiTime = 0;
  if (mode === 'playing') updateUI();
  if (audioEnabled && mode === 'playing') {
   const windSpeed = flight.speed / getSpeedMultiplier();
   setAudioLevel(0.08 + windSpeed * 0.0025);
   windFilter.frequency.setTargetAtTime(350 + windSpeed * 11, audioContext.currentTime, 0.3);
  }
 }
 rs.render(dt);
 window.__frames++;
 if (showStats) updateStats(rawDt);
}
requestAnimationFrame(frame);
