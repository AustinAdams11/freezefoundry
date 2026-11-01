// The narrator's words: numbers written out, and caption words matched to the voice's sounds.
const { test } = require('node:test');
const assert = require('node:assert');

test('numbers, dates and symbols are written out the way a narrator says them', async () => {
  const { sayWord } = await import('../public/studio/spoken.mjs');
  const say = w => sayWord(w).join(' ');
  assert.equal(say('1918.'), 'nineteen eighteen.');
  assert.equal(say('4,'), 'four,');
  assert.equal(say('10,700'), 'ten thousand seven hundred');
  assert.equal(say('309'), 'three hundred nine');
  assert.equal(say('2005'), 'two thousand five');
  assert.equal(say('1905'), 'nineteen oh five');
  assert.equal(say('1950s'), 'nineteen fifties');
  assert.equal(say('21st'), 'twenty first');
  assert.equal(say('3.5'), 'three point five');
  assert.equal(say('-30C.'), 'minus thirty C.');
  assert.equal(say('$5'), 'five dollars');
  assert.equal(say('Worley'), 'Worley');
});

test('caption words follow the voice even when it runs words together or splits a name', async () => {
  const { sayLine, wordTimes } = await import('../public/studio/spoken.mjs');
  // What Kokoro produced for these lines: "in the" and "for the" merged, "McArthur" split, the year written out.
  const check = (text, ph) => {
    const dur = [5, ...[...ph].map(() => 1), 5]; // one unit per sound, padding at each end
    return wordTimes(sayLine(text), ph, dur, dur.reduce((a, b) => a + b, 0));
  };
  const a = check('No bodies were ever recovered in the ocean.', 'nˈoʊ bˈɑːdiz wɜːɹ ˈɛvɚ ɹᵻkˈʌvɚd ɪnðɪ ˈoʊʃən.');
  const b = check('Donald McArthur was a keeper in 1900.', 'dˈɑːnəld mək ˈɑːɹθɚ wʌz ɐ kˈiːpɚ ɪn nˈaɪntiːn hˈʌndɹɪd.');
  for (const ws of [a, b]) ws.forEach((w, i) => { assert.ok(w.end > w.start, w.w); if (i) assert.ok(w.start >= ws[i - 1].end - 1e-9, `${w.w} starts after ${ws[i - 1].w}`); });
  // "ocean" is the last sound-word; "in" and "the" share the one before it.
  const ph = 'nˈoʊ bˈɑːdiz wɜːɹ ˈɛvɚ ɹᵻkˈʌvɚd ɪnðɪ ˈoʊʃən.';
  const oceanStart = 5 + ph.indexOf('ˈoʊʃən');
  assert.equal(a[7].w, 'ocean.'); assert.equal(Math.round(a[7].start), oceanStart);
  assert.equal(Math.round(a[5].start), 5 + ph.indexOf('ɪnðɪ'));
  // "McArthur" covers both of its sound-words; the year covers both of its.
  assert.equal(Math.round(b[1].start), 5 + 'dˈɑːnəld '.length);
  assert.equal(Math.round(b[1].end), 5 + 'dˈɑːnəld mək ˈɑːɹθɚ'.length);
  // With each word's own sound count (as the voice reports it), a long name is not confused with its neighbours.
  const ph2 = 'dʒˈeɪmz dʒˈuːkæt, tˈɑːməs mˈɑːɹʃəl, ænd dˈɑːnəld mək ˈɑːɹθɚ wɜː sˈiːzənd kˈiːpɚz.';
  const line = sayLine('James Ducat, Thomas Marshall, and Donald McArthur were seasoned keepers.');
  const dur2 = [5, ...[...ph2].map(() => 1), 5];
  const c = wordTimes(line, ph2, dur2, dur2.reduce((x, y) => x + y, 0), [6, 6, 5, 6, 3, 6, 7, 2, 6, 5]);
  const span = w => ph2.slice(Math.round(w.start) - 5, Math.round(w.end) - 5);
  assert.deepEqual(c.slice(6, 9).map(span), ['mək ˈɑːɹθɚ', 'wɜː', 'sˈiːzənd']);
  assert.equal(b[6].w, '1900.'); assert.equal(Math.round(b[6].end), 5 + 'dˈɑːnəld mək ˈɑːɹθɚ wʌz ɐ kˈiːpɚ ɪn nˈaɪntiːn hˈʌndɹɪd'.length);
});
