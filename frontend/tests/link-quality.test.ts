import { test } from 'bun:test';
import assert from './assert.ts';
import { LinkMeter, describeLink } from '../src/core/link-quality.ts';

function feed(m: LinkMeter, rtts: number[], start = 1000): number {
  let at = start;
  for (const rtt of rtts) {
    m.sent(at);
    m.answered(rtt, at);
    at += 5000;
  }
  return at;
}

test('a fast steady link flows at full speed without ripple', () => {
  const m = new LinkMeter();
  const now = feed(m, [30, 30, 31, 30]);
  const r = m.read(now);
  assert.equal(r.tone, 'good');
  assert.equal(r.flow, 1);
  assert.ok(r.rough < 0.05);
  assert.equal(r.level, 1);
  assert.equal(r.answers, 4);
});

test('higher latency slows the wave and turns it to slow', () => {
  const m = new LinkMeter();
  const now = feed(m, [600, 600, 600]);
  const r = m.read(now);
  assert.equal(r.tone, 'slow');
  assert.ok(Math.abs(r.flow - 0.3) < 1e-9);
});

test('uneven round trips add ripple', () => {
  const m = new LinkMeter();
  const now = feed(m, [20, 180, 20, 180, 20, 180]);
  const r = m.read(now);
  assert.ok(r.jitter >= 60, `jitter ${r.jitter}`);
  assert.equal(r.tone, 'slow');
  assert.ok(r.rough > 0.7);
});

test('an unanswered ping flattens the wave, and an answer restores it', () => {
  const m = new LinkMeter();
  const now = feed(m, [30, 30]);
  m.sent(now);
  assert.equal(m.read(now + 2000).tone, 'good');
  const early = m.read(now + 4000);
  assert.equal(early.tone, 'stalled');
  assert.ok(early.level > 0 && early.level < 1);
  assert.equal(m.read(now + 9000).level, 0);
  assert.match(describeLink(m.read(now + 9000)), /No answer from the server for 9 s/);
  m.answered(40, now);
  const back = m.read(now + 9001);
  assert.equal(back.tone, 'good');
  assert.equal(back.level, 1);
});

test('answers held up by a stall leave no lasting mark', () => {
  const m = new LinkMeter();
  const now = feed(m, [30, 30, 9000, 5000, 1200, 30]);
  const r = m.read(now);
  assert.equal(r.tone, 'good');
  assert.equal(r.jitter, 0);
});

test('a link that stays slow keeps reading slow', () => {
  const m = new LinkMeter();
  const now = feed(m, [30, 4000, 4000, 4000, 4000]);
  assert.equal(m.read(now).tone, 'slow');
});

test('waiting counts from the oldest open ping', () => {
  const m = new LinkMeter();
  m.sent(1000);
  m.sent(6000);
  assert.equal(m.read(7000).waited, 6000);
  m.answered(10, 1000);
  assert.equal(m.read(7000).waited, 1000);
});

test('a clock jump does not count as a measurement', () => {
  const m = new LinkMeter();
  m.sent(1000);
  m.answered(-500, 1000);
  assert.equal(m.answers, 0);
  assert.equal(m.rtt, 0);
  assert.equal(m.read(2000).waited, 0);
});

test('the tooltip states the measured numbers', () => {
  const m = new LinkMeter();
  assert.equal(describeLink(undefined), '');
  assert.equal(describeLink(m.read(0)), 'Measuring the connection');
  const now = feed(m, [40, 40]);
  assert.equal(describeLink(m.read(now)), 'Stable: 40 ms, varies by 0 ms');
});
