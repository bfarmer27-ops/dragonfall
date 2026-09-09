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
  assert.equal(flight.FLIGHT_SPEED_MULTIPLIER, 1.75, 'forward speed is 1.75x original');
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
  assert.equal(state.speed, 35 * 1.75);
  assert.equal(state.vy, -0.5 * 2);
  assert.equal(state.alt, 29);
});

test('neutral flight step uses the accepted forward multiplier', () => {
  const state = flight.newFlight();
  const dt = 0.1;
  flight.stepFlight(state, 0, 0, dt);
  closeTo(state.speed, dampExpected(35 * 1.75, 37 * 1.75, 0.65, dt), 'neutral forward speed');
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
