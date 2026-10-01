import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioApps, planLinks, VIRTUAL_MIC } from '../electron/pipewire.ts';

// A cut-down pw-dump: the virtual microphone (10), this app (20, process 500), a browser whose
// stream has no name of its own (30, named by its client), a mono game (40) and a music player (50)
const node = (id: number, props: Record<string, unknown>) => ({ id, type: 'PipeWire:Interface:Node', info: { props } });
const client = (id: number, name: string, pid: number) => ({ id, type: 'PipeWire:Interface:Client', info: { props: { 'application.name': name, 'application.process.id': pid } } });
const port = (id: number, nodeId: number, direction: string, channel: string) => ({ id, type: 'PipeWire:Interface:Port', info: { direction, props: { 'node.id': nodeId, 'audio.channel': channel } } });
const link = (id: number, outPort: number, inPort: number, inNode: number) =>
  ({ id, type: 'PipeWire:Interface:Link', info: { 'output-port-id': outPort, 'input-port-id': inPort, 'input-node-id': inNode } as any });

const graph = [
  node(10, { 'node.name': VIRTUAL_MIC, 'media.class': 'Audio/Source/Virtual' }), port(11, 10, 'input', 'FL'), port(12, 10, 'input', 'FR'),
  port(13, 10, 'output', 'FL'), port(14, 10, 'output', 'FR'),
  client(2, 'mumh5', 500), node(20, { 'media.class': 'Stream/Output/Audio', 'node.name': 'mumh5', 'client.id': 2 }), port(21, 20, 'output', 'FL'), port(22, 20, 'output', 'FR'),
  client(3, 'Firefox', 600), node(30, { 'media.class': 'Stream/Output/Audio', 'node.name': 'Firefox', 'client.id': 3 }), port(31, 30, 'output', 'FL'), port(32, 30, 'output', 'FR'),
  node(40, { 'media.class': 'Stream/Output/Audio', 'application.name': 'Game', 'application.process.id': 700 }), port(41, 40, 'output', 'MONO'),
  node(50, { 'media.class': 'Stream/Output/Audio', 'application.name': 'Spotify' }), port(51, 50, 'output', 'FL'), port(52, 50, 'output', 'FR'), port(53, 50, 'output', 'LFE'),
  node(60, { 'media.class': 'Audio/Sink', 'node.name': 'speakers' })
];

test('lists programs that play sound, without this app', () => {
  assert.deepEqual(audioApps(graph, [500]), ['Firefox', 'Game', 'Spotify']);
});

test('whole system links every program but this app', () => {
  const { add, remove } = planLinks(graph, { kind: 'all' }, [500]);
  assert.deepEqual(add.sort(), [[31, 11], [32, 12], [41, 11], [41, 12], [51, 11], [52, 12]].sort());
  assert.deepEqual(remove, []);
});

test('one program links only that program', () => {
  assert.deepEqual(planLinks(graph, { kind: 'app', name: 'Firefox' }, [500]).add, [[31, 11], [32, 12]]);
});

test('existing links are kept, stale ones removed', () => {
  const linked = [...graph, link(90, 31, 11, 10), link(91, 51, 11, 10), link(92, 21, 60, 60)];
  const { add, remove } = planLinks(linked, { kind: 'app', name: 'Firefox' }, [500]);
  assert.deepEqual(add, [[32, 12]]);
  // Spotify's link goes; the link to the speakers is none of our business
  assert.deepEqual(remove, [91]);
});

test('nothing without the virtual microphone', () => {
  assert.deepEqual(planLinks(graph.slice(5), { kind: 'all' }, []), { add: [], remove: [] });
});
