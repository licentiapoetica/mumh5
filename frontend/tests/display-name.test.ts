import { test } from 'bun:test';
import assert from './assert.ts';
import { MAX_DISPLAY_NAME, cleanDisplayName, labelNames, parseDisplayName, stripDisplayName, withDisplayName } from '../src/core/display-name.ts';

const person = (name: string, chosenName = '') => ({ name, chosenName, displayName: '' });

test('a display name survives the comment and leaves the description alone', () => {
  const comment = withDisplayName('<p>hello</p>', 'Zoë K');
  assert.equal(parseDisplayName(comment), 'Zoë K');
  assert.equal(stripDisplayName(comment), '<p>hello</p>');
  const changed = withDisplayName(comment, 'Other');
  assert.equal(parseDisplayName(changed), 'Other');
  assert.equal(changed.match(/mumh5name/g)?.length, 1);
  assert.equal(withDisplayName(changed, ''), '<p>hello</p>');
});

test('names are cleaned of invisible characters and limited in length', () => {
  assert.equal(cleanDisplayName('  a​ b‮\n  c  '), 'a b c');
  assert.equal(cleanDisplayName('ㅤ⠀‍'), '');
  assert.equal([...cleanDisplayName('x'.repeat(100))].length, MAX_DISPLAY_NAME);
  assert.equal(cleanDisplayName('a' + '́'.repeat(30)).length <= 4, true);
});

test('a broken marker is no name', () => {
  assert.equal(parseDisplayName('<img src="data:,mumh5name:####" width="0" height="0"/>'), '');
  assert.equal(parseDisplayName('<img src="data:,mumh5name:_w" width="0" height="0"/>'), '');
  assert.equal(parseDisplayName('<p>no marker</p>'), '');
});

test('a name someone else uses keeps the account name beside it', () => {
  const admin = person('admin');
  const faker = person('mallory', 'ADMIN');
  const a = person('ann', 'Sam');
  const b = person('bob', 'sam');
  const free = person('carol', 'Carol B');
  const own = person('dave', 'Dave');
  const same = person('erin', 'erin');
  labelNames([admin, faker, a, b, free, own, same]);
  assert.equal(admin.displayName, '');
  assert.equal(faker.displayName, 'ADMIN (mallory)');
  assert.equal(a.displayName, 'Sam (ann)');
  assert.equal(b.displayName, 'sam (bob)');
  assert.equal(free.displayName, 'Carol B');
  assert.equal(own.displayName, 'Dave');
  assert.equal(same.displayName, '');
});
