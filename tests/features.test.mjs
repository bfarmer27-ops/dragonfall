import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesFireWord, normalize, DEFAULT_FIRE_WORD } from '../dist/speech.js';
import { roomCode, peerIdFor } from '../dist/net.js';

test('fire word matching: exact, close misses and unrelated speech (two words tested)', () => {
  assert.equal(DEFAULT_FIRE_WORD, 'dracarys');
  for (const heard of ['dracarys', 'Dracarys!', 'I said dracarus', 'drakaris now', 'DRACARYS dracarys']) assert.equal(matchesFireWord(heard, 'dracarys'), true, heard);
  for (const heard of ['the crisis', 'hello there', 'dragon', 'fire', '']) assert.equal(matchesFireWord(heard, 'dracarys'), false, heard);
  assert.equal(matchesFireWord('fire', 'fire'), true);
  assert.equal(matchesFireWord('tire', 'fire'), false, 'short words get no slack');
  assert.equal(matchesFireWord('fireball now', 'fire ball'), true, 'spaces in the custom word are ignored');
  assert.equal(matchesFireWord('open sesame please', 'open sesame'), true);
  assert.equal(normalize('  Héllo, World!! '), 'hello world');
});

test('room codes are 4 letters from the safe alphabet and map to stable peer ids', () => {
  for (let i = 0; i < 50; i++) { const c = roomCode(); assert.match(c, /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/, c); }
  assert.equal(peerIdFor('ab-cd'), 'dragonfall-ABCD');
  assert.equal(peerIdFor(' xkqz '), 'dragonfall-XKQZ');
});
