import assert from 'node:assert/strict';
import { test } from 'node:test';
import { letterStarts, lettersIfCurrent } from '../app/js/util/shape.js';

test('letter jumps survive a missing size and ignore an older sort', () => {
  const directory = [{ title: 'A', size: 4 }, { title: 'B' }, { title: 'C', size: '12' }, null];
  assert.deepEqual(letterStarts(directory), [
    { title: 'A', start: 0 },
    { title: 'B', start: 4 },
    { title: 'C', start: 4 },
    { title: '', start: 16 },
  ]);
  assert.deepEqual(letterStarts(null), []);
  assert.equal(lettersIfCurrent(1, 2, directory), null);
  assert.deepEqual(lettersIfCurrent(2, 2, [{ title: 'M', size: 3 }]), [{ title: 'M', start: 0 }]);
});
