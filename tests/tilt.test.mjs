import assert from 'node:assert/strict';
import { test } from 'node:test';
import { screenTilt, tiltCommands, tiltAngles, upVector } from '../dist/tilt.js';

// Helper: commands for a current (beta,gamma) hold relative to a neutral (beta,gamma) hold.
const cmd = (neutral, current, angle = 0) => tiltCommands(screenTilt(current[0], current[1], angle), screenTilt(neutral[0], neutral[1], angle));

test('flat phone: lowering the top edge dives, raising it climbs (two strengths)', () => {
  // beta is front-to-back tilt; positive beta = top edge raised.
  const dive10 = cmd([0, 0], [-10, 0]), dive25 = cmd([0, 0], [-25, 0]), climb25 = cmd([0, 0], [25, 0]);
  assert.ok(dive10.pitch < 0 && dive10.pitch > -1, `10 deg lowered = partial dive (${dive10.pitch.toFixed(2)})`);
  assert.equal(dive25.pitch, -1, '25 deg lowered = full dive');
  assert.equal(climb25.pitch, 1, '25 deg raised = full climb');
  assert.equal(dive10.bank, 0, 'no bank from a pure pitch');
});

test('upright phone (held facing you, beta 60-90): tilting the top edge still pitches, leaning sideways banks', () => {
  const n = [70, 0];
  const dive = cmd(n, [45, 0]), climb = cmd(n, [88, 0]);
  assert.equal(dive.pitch, -1, 'lowering the top edge 25 deg from an upright hold = full dive');
  assert.ok(climb.pitch > 0.6, `raising it 18 deg = strong climb (${climb.pitch.toFixed(2)})`);
  // Leaning the phone left/right while upright rotates the up vector inside the screen plane.
  const upRight = tiltAngles({ x: Math.sin(20 * Math.PI / 180), y: Math.cos(20 * Math.PI / 180), z: 0 });
  const upNeutral = tiltAngles({ x: 0, y: 1, z: 0 });
  const bank = tiltCommands(upRight, upNeutral);
  assert.ok(Math.abs(bank.bank) > 0.7, `20 deg lean while upright = strong bank (${bank.bank.toFixed(2)})`);
  assert.equal(bank.pitch, 0, 'lean alone does not pitch');
});

test('one corner down does both: top-left corner lowered = dive + bank left, top-right = dive + bank right', () => {
  const n = [40, 0];
  // Lower the top edge (beta -20) and lower the left edge (gamma -20) at once.
  const topLeft = cmd(n, [20, -20]), topRight = cmd(n, [20, 20]);
  assert.ok(topLeft.pitch < -0.5, `top-left corner down dives (${topLeft.pitch.toFixed(2)})`);
  assert.ok(topRight.pitch < -0.5, `top-right corner down dives (${topRight.pitch.toFixed(2)})`);
  assert.ok(topLeft.bank !== 0 && topRight.bank !== 0, 'both corners bank');
  assert.ok(Math.sign(topLeft.bank) === -Math.sign(topRight.bank), 'left and right corners bank opposite ways');
  const leftEdgeOnly = cmd(n, [40, -20]);
  assert.equal(Math.sign(leftEdgeOnly.bank), Math.sign(topLeft.bank), 'left edge down alone banks the same way as the top-left corner');
  assert.equal(leftEdgeOnly.pitch, 0, 'left edge down alone does not pitch');
  // Strength scales: 10 deg lean is weaker than 20 deg.
  const weak = cmd(n, [40, -10]);
  assert.ok(Math.abs(weak.bank) < Math.abs(leftEdgeOnly.bank), 'smaller lean = smaller bank');
});

test('landscape (screen angle 90): the same physical corner motions map the same way after rotation', () => {
  const up = upVector(0, -20, 90);
  const upPortrait = upVector(-20, 0, 0);
  // In landscape the phone's physical left/right axis is the portrait top/bottom axis; rotating by the screen angle re-aligns them.
  assert.ok(Math.abs(Math.abs(up.y) - Math.abs(upPortrait.y)) < 1e-9, 'rotated up vector lines up with the portrait case');
  const a = tiltCommands(screenTilt(0, -20, 90), screenTilt(0, 0, 90));
  assert.ok(Math.abs(a.pitch) > 0.5 || Math.abs(a.bank) > 0.5, 'a 20 deg tilt in landscape still produces a strong command');
});
