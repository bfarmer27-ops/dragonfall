import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(process.env.DRAGONFALL_SOURCE_ROOT ?? path.join(testsDir, '..', 'dist'));
const flight = await import(`${pathToFileURL(path.join(sourceRoot, 'flight.js')).href}?regression=flight`);

const closeTo = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${message}: expected ${expected}, got ${actual}`);

const dampExpected = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

 test('accepted flight tuning constants are locked', () => {
  assert.equal(flight.FLIGHT_SPEED_MULTIPLIER, 2.45, 'forward speed default is 2.45x original (flight.FLIGHT_SPEED_MULTIPLIERx accepted build x 1.4, Ryan 2026-09-09)');
  assert.equal(flight.TURN_STRENGTH_MULTIPLIER, 1.5, 'sideways strength is 1.5x original');
  assert.equal(flight.VERTICAL_SPEED_MULTIPLIER, 2, 'vertical speed is 2x original');
  assert.equal(flight.PHYSICS_STEP, 1 / 120, 'flight uses the accepted fixed physics step');
});

test('wing commands average pitch and preserve differential bank', () => {
  closeTo(flight.wingCommand(0.8, 0.2).pitch, 0.5, 'pitch averages both wings');
  closeTo(flight.wingCommand(0.8, 0.2).bank, -0.3, 'bank is the wing difference');
  assert.deepEqual(flight.wingCommand(-4, 4), { pitch: 0, bank: 1 });
  assert.deepEqual(flight.wingCommand(4, -4), { pitch: 0, bank: -1 });
});

test('new flight applies accepted forward and vertical tuning', () => {
  const state = flight.newFlight();
  assert.equal(state.speed, 35 * flight.FLIGHT_SPEED_MULTIPLIER);
  assert.equal(state.vy, -0.5 * 2);
  assert.equal(state.alt, 29);
});

test('neutral flight step uses the accepted forward multiplier', () => {
  const state = flight.newFlight();
  const dt = 0.1;
  flight.stepFlight(state, 0, 0, dt);
  closeTo(state.speed, dampExpected(35 * flight.FLIGHT_SPEED_MULTIPLIER, 37 * flight.FLIGHT_SPEED_MULTIPLIER, 0.65, dt), 'neutral forward speed');
  closeTo(state.distance, state.speed * dt, 'neutral forward distance');
});

test('bank steering uses the accepted sideways-strength multiplier', () => {
  const state = flight.newFlight();
  const dt = 0.1;
  const bank = 0.5;
  const targetYaw = Math.atan(1.5 * Math.tan(bank * 0.83 * 0.64));
  flight.stepFlight(state, -0.5, 0.5, dt);
  closeTo(state.yaw, dampExpected(0, targetYaw, 12, dt), 'bank response');
  // bank = (right - left) / 2, so right wing up is a POSITIVE bank, which yaws left: x decreases (see stepFlight vx = -sin(yaw) * speed).
  assert.ok(state.x < flight.centerAt(0), 'positive bank (right wing up) steers toward negative x');
});

test('climb input uses the accepted vertical-speed multiplier', () => {
  const state = flight.newFlight();
  const dt = 0.1;
  flight.stepFlight(state, 1, 1, dt);
  closeTo(state.vy, dampExpected(-0.5 * 2, (16 - 0.65) * 2, 2.4, dt), 'climb vertical speed');
  assert.ok(state.alt > 29, 'positive pitch climbs');
});


test('speed multiplier is live: two different settings change the starting speed and the cruise target', () => {
  const a = flight.setSpeedMultiplier(1.4);
  assert.equal(a, 1.4);
  assert.equal(flight.getSpeedMultiplier(), 1.4);
  closeTo(flight.newFlight().speed, 35 * 1.4, 'start speed follows 1.4x');
  const b = flight.setSpeedMultiplier(3);
  assert.equal(b, 3);
  closeTo(flight.newFlight().speed, 35 * 3, 'start speed follows 3x');
  // Cruise target after settling at neutral input scales with the multiplier.
  const run = (m) => { flight.setSpeedMultiplier(m); const f = flight.newFlight(); for (let i = 0; i < 2400; i++) flight.stepFlight(f, 0, 0, 1 / 120); return f.speed; };
  const s14 = run(1.4), s3 = run(3);
  assert.ok(s3 > s14 * 2.0 && s3 < s14 * 2.3, `3x cruise (${s3.toFixed(1)}) is ~2.14x the 1.4x cruise (${s14.toFixed(1)})`);
  assert.equal(flight.setSpeedMultiplier(99), flight.SPEED_MULTIPLIER_MAX, 'clamped to max');
  assert.equal(flight.setSpeedMultiplier(0), flight.SPEED_MULTIPLIER_MIN, 'clamped to min');
  flight.setSpeedMultiplier(flight.FLIGHT_SPEED_MULTIPLIER);
});

test('landscape vertical gain scales only the shared pitch part of the wing commands', () => {
  const [a, b] = flight.applyVerticalGain(0.4, 0.4, 1.5);
  closeTo(a, 0.6, 'both wings 0.4 with gain 1.5 -> 0.6'); closeTo(b, 0.6, 'right wing');
  const [l, r] = flight.applyVerticalGain(0.2, 0.6, 2);
  closeTo(l, 0.8 - 0.2, 'pitch 0.4 doubled to 0.8, bank 0.2 kept: left = 0.6');
  closeTo(r, 0.8 + 0.2, 'right = 1.0');
  assert.deepEqual(flight.applyVerticalGain(-1, -1, 1.5), [-1, -1], 'clamped');
  assert.deepEqual(flight.applyVerticalGain(-1, 1, 1.5), [-1, 1], 'pure bank unchanged by gain');
});

test('nose dive starts after a full dive is held for more than 2 s and ends when the dive input eases off', () => {
  flight.setSpeedMultiplier(flight.FLIGHT_SPEED_MULTIPLIER);
  const f = flight.newFlight();
  f.alt = 88;
  const dt = 1 / 120;
  for (let i = 0; i < 120 * 1.9; i++) flight.stepFlight(f, -1, -1, dt);
  assert.equal(f.noseDive, false, 'not yet after 1.9 s');
  const pitchBefore = f.pitch, speedBefore = f.speed;
  for (let i = 0; i < 120 * 1.5; i++) flight.stepFlight(f, -1, -1, dt);
  assert.equal(f.noseDive, true, 'nose dive after 3.4 s of full dive');
  for (let i = 0; i < 120 * 2; i++) flight.stepFlight(f, -1, -1, dt);
  assert.ok(f.pitch < pitchBefore - 0.4, `pitch steepens (${pitchBefore.toFixed(2)} -> ${f.pitch.toFixed(2)})`);
  assert.ok(f.speed > speedBefore * 1.15, `speed surges (${speedBefore.toFixed(1)} -> ${f.speed.toFixed(1)})`);
  for (let i = 0; i < 30; i++) flight.stepFlight(f, 0, 0, dt);
  assert.equal(f.noseDive, false, 'released when the dive input eases off');
  assert.equal(f.diveHold, 0);
  // A gentle dive never triggers it.
  const g = flight.newFlight(); g.alt = 88;
  for (let i = 0; i < 120 * 5; i++) flight.stepFlight(g, -0.5, -0.5, dt);
  assert.equal(g.noseDive, false, 'half dive held 5 s does not trigger');
});
