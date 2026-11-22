import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chaptersFrom, chapterMarks, chapterIndex } from '../app/js/player/chapters.js';

test('normalizes Plex chapters and Jellyfin ticks to milliseconds', () => {
  const plex = chaptersFrom({
    Chapter: [
      { tag: 'Later', startTimeOffset: 60000, endTimeOffset: 90000 },
      { tag: '', startTimeOffset: 0 },
      { startTimeOffset: 'nope' },
      null,
    ],
  });
  assert.deepEqual(plex.map(c => c.start), [0, 60000]);
  assert.equal(plex[0].title, 'Chapter 2');
  assert.equal(plex[1].title, 'Later');
  assert.equal(plex[1].end, 90000);

  const jf = chaptersFrom({
    Chapters: [{ Name: 'Cold open', StartPositionTicks: 30_000_000 }],
  });
  assert.deepEqual(jf, [{ title: 'Cold open', start: 3000 }]);
  assert.deepEqual(chaptersFrom({}), []);
  assert.deepEqual(chaptersFrom(null), []);
});

test('seek-bar ticks skip the opening and the list knows the current chapter', () => {
  const chapters = [
    { title: 'Start', start: 0 },
    { title: 'One', start: 500 },
    { title: 'Two', start: 10000 },
  ];
  assert.deepEqual(chapterMarks(chapters, 0), []);
  const marks = chapterMarks(chapters, 20000);
  assert.deepEqual(marks.map(m => m.title), ['Two']);
  assert.equal(marks[0].at, 0.5);
  // 800 ms of lead, so a chapter that starts just ahead already counts as current.
  assert.equal(chapterIndex(chapters, 0), 1);
  assert.equal(chapterIndex([{ title: 'Start', start: 0 }, { title: 'Two', start: 10000 }], 0), 0);
  assert.equal(chapterIndex(chapters, 9000), 1);
  assert.equal(chapterIndex(chapters, 9200), 2);
  assert.equal(chapterIndex([], 1000), -1);
});
