import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BANNER_BYTES, bannerImageUrl, bannerMark, cleanColor, parseBanner, stripProfileMarks, withBanner } from '../src/core/banner.ts';
import { parseDisplayName, withDisplayName } from '../src/core/display-name.ts';

const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 0xfb, 0xff]);

test('a banner survives the comment beside the display name', () => {
  const comment = withBanner(withDisplayName('<p>hello</p>', 'Zoe'), bannerMark({ color: '#A1B2C3', image: webp }));
  assert.deepEqual(parseBanner(comment), { color: '#a1b2c3', image: webp });
  assert.equal(parseDisplayName(comment), 'Zoe');
  assert.equal(stripProfileMarks(comment), '<p>hello</p>');
  const changed = withBanner(comment, bannerMark({ color: '#000000', image: null }));
  assert.equal(changed.match(/mumh5banner/g)?.length, 1);
  assert.deepEqual(parseBanner(changed), { color: '#000000', image: null });
  assert.equal(stripProfileMarks(withBanner(changed, '')), '<p>hello</p>');
});

test('no color and no picture is no banner', () => {
  assert.equal(bannerMark({ color: '', image: null }), '');
  assert.equal(parseBanner('<p>nothing</p>'), null);
  assert.equal(parseBanner('<img src="data:,mumh5banner::" width="0" height="0"/>'), null);
});

test('only known picture formats and small pictures are taken from other people', () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.equal(bannerMark({ color: '', image: svg }), '');
  const forged = `<img src="data:,mumh5banner:112233:${Buffer.from(svg).toString('base64url')}" width="0" height="0"/>`;
  assert.deepEqual(parseBanner(forged), { color: '#112233', image: null });
  const big = new Uint8Array(MAX_BANNER_BYTES + 1);
  big.set(webp);
  const tooBig = `<img src="data:,mumh5banner::${Buffer.from(big).toString('base64url')}" width="0" height="0"/>`;
  assert.equal(parseBanner(tooBig), null);
  assert.equal(parseBanner('<img src="data:,mumh5banner:12345g:" width="0" height="0"/>'), null);
});

test('colors are checked', () => {
  assert.equal(cleanColor('#ABCDEF'), '#abcdef');
  assert.equal(cleanColor('abcdef'), '#abcdef');
  assert.equal(cleanColor('red'), '');
  assert.equal(cleanColor('#abc'), '');
  assert.equal(cleanColor('#abcdef;background:url(x)'), '');
});

test('the picture becomes a data URL of its own type', () => {
  const url = bannerImageUrl(webp);
  assert.match(url, /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/);
  assert.deepEqual(new Uint8Array(Buffer.from(url.split(',')[1], 'base64')), webp);
});

test('the crop picks the part of the picture the frame shows', async () => {
  const { bannerSourceRect } = await import('../src/lib/images.ts');
  // Wide picture: the frame is as tall as the picture, x slides it
  assert.deepEqual(bannerSourceRect(2000, 200, { x: 0, y: 0.5, zoom: 1 }), { sx: 0, sy: 0, sw: 1000, sh: 200 });
  assert.deepEqual(bannerSourceRect(2000, 200, { x: 1, y: 0.5, zoom: 1 }), { sx: 1000, sy: 0, sw: 1000, sh: 200 });
  // Tall picture: as wide as the picture, y slides it
  assert.deepEqual(bannerSourceRect(500, 1000, { x: 0.5, y: 0.25, zoom: 1 }), { sx: 0, sy: 225, sw: 500, sh: 100 });
  // Zoom shows less, and values out of range are held in it
  assert.deepEqual(bannerSourceRect(500, 1000, { x: 2, y: -1, zoom: 2 }), { sx: 250, sy: 0, sw: 250, sh: 50 });
  assert.equal(bannerSourceRect(500, 1000, { x: 0.5, y: 0.5, zoom: 99 }).sw, 125);
});
