import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesFireWord, normalize, DEFAULT_FIRE_WORD, fireWordList, soundKey } from '../dist/speech.js';
import { roomCode, peerIdFor } from '../dist/net.js';

test('fire word matching: exact, close misses and unrelated speech (two words tested)', () => {
  assert.equal(DEFAULT_FIRE_WORD, 'dracarys');
  for (const heard of ['dracarys', 'Dracarys!', 'I said dracarus', 'drakaris now', 'DRACARYS dracarys']) assert.equal(matchesFireWord(heard, 'dracarys'), true, heard);
  for (const heard of ['hello there', 'dragon', 'fire', '', 'turn left now']) assert.equal(matchesFireWord(heard, 'dracarys'), false, heard);
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


test('fire word: sound-alike spellings the phone returns still fire, and a comma list adds your own words', () => {
  for (const heard of ['drac aries', 'draco reyes', 'dracaryus', 'the car is', 'truck aries', 'Dracarys, dracarys']) assert.equal(matchesFireWord(heard, 'dracarys'), true, heard);
  assert.equal(soundKey('dracarys'), 'drkrs');
  assert.equal(soundKey('drac aries'), 'drkrs');
  assert.deepEqual(fireWordList('burn, Flame!').slice(0, 2), ['burn', 'flame']);
  assert.equal(matchesFireWord('burn it', 'dracarys, burn'), true, 'second word in the list fires');
  assert.equal(matchesFireWord('flame on', 'dracarys, burn'), false, 'a word not in the list does not fire');
  assert.ok(fireWordList('dracarys').length > 5, 'default word carries its alias spellings');
  assert.ok(!fireWordList('burn').includes('dracarys'), 'a custom list without the default gets no aliases');
});
