import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.window = { addEventListener() {} };
globalThis.document = {
  documentElement: { classList: { contains() { return false; }, toggle() {} } },
  addEventListener() {},
  activeElement: null,
};

const { gateKey, releaseKey } = await import('../app/js/input.js');

test('a held Back, OK or Play does not repeat, and a second press does', () => {
  assert.equal(gateKey('back', false, 1000), true);
  assert.equal(gateKey('back', true, 1050), false);
  assert.equal(gateKey('back', false, 1200), false);
  releaseKey('back');
  assert.equal(gateKey('back', false, 1210), true);
  releaseKey('back');

  assert.equal(gateKey('enter', false, 2000), true);
  assert.equal(gateKey('enter', true, 2060), false);
  releaseKey('enter');
  assert.equal(gateKey('playpause', false, 3000), true);
  assert.equal(gateKey('playpause', false, 3100), false);
  releaseKey('playpause');
});

test('direction and seek keys keep repeating', () => {
  assert.equal(gateKey('right', true, 4000), true);
  assert.equal(gateKey('right', true, 4030), true);
  assert.equal(gateKey('ff', true, 5000), true);
  assert.equal(gateKey(null, false, 5000), false);
});

test('a key whose release was lost works again after a pause', () => {
  assert.equal(gateKey('stop', false, 6000), true);
  assert.equal(gateKey('stop', false, 6400), false);
  assert.equal(gateKey('stop', false, 7300), true);
  releaseKey('stop');
});
