import type { SoundEvent } from '../../core/sound-events.ts';

// Default tones: [frequency Hz, start s, length s] per event, with a short fade
const TONES: Record<SoundEvent, [number, number, number][]> = {
  connected: [[523, 0, 0.09], [659, 0.09, 0.09], [784, 0.18, 0.16]],
  disconnected: [[784, 0, 0.09], [659, 0.09, 0.09], [523, 0.18, 0.16]],
  connectionLost: [[523, 0, 0.12], [392, 0.13, 0.12], [262, 0.26, 0.2]],
  error: [[311, 0, 0.1], [277, 0.11, 0.14]],
  switchedChannel: [[659, 0, 0.06], [784, 0.07, 0.08]],
  moved: [[587, 0, 0.06], [880, 0.07, 0.06], [587, 0.14, 0.06]],
  kicked: [[220, 0, 0.12], [196, 0.13, 0.2]],
  banned: [[196, 0, 0.14], [165, 0.15, 0.24]],
  denied: [[311, 0, 0.08], [277, 0.09, 0.1]],
  userConnected: [[740, 0, 0.07], [988, 0.08, 0.1]],
  userDisconnected: [[988, 0, 0.07], [740, 0.08, 0.1]],
  userJoined: [[660, 0, 0.07], [880, 0.08, 0.1]],
  userLeft: [[880, 0, 0.07], [660, 0.08, 0.1]],
  userMovedIn: [[587, 0, 0.06], [880, 0.07, 0.08]],
  userMovedOut: [[880, 0, 0.06], [587, 0.07, 0.08]],
  userKicked: [[330, 0, 0.1], [262, 0.11, 0.12]],
  userBanned: [[294, 0, 0.12], [220, 0.13, 0.16]],
  recordingStarted: [[1175, 0, 0.08], [1175, 0.12, 0.08]],
  recordingStopped: [[880, 0, 0.12]],
  shareStarted: [[523, 0, 0.07], [784, 0.08, 0.07], [1047, 0.16, 0.12]],
  shareStopped: [[1047, 0, 0.07], [784, 0.08, 0.07], [523, 0.16, 0.12]],
  viewerJoined: [[880, 0, 0.05], [1109, 0.06, 0.08]],
  viewerLeft: [[1109, 0, 0.05], [880, 0.06, 0.08]],
  message: [[1047, 0, 0.06]],
  privateMessage: [[1047, 0, 0.05], [1319, 0.07, 0.07]],
  poke: [[880, 0, 0.07], [1175, 0.08, 0.07], [880, 0.16, 0.07], [1175, 0.24, 0.12]],
  messageSent: [[1319, 0, 0.04]],
  uploadDone: [[784, 0, 0.06], [1047, 0.07, 0.08]],
  uploadFailed: [[392, 0, 0.08], [330, 0.09, 0.1]],
  mute: [[392, 0, 0.07]],
  unmute: [[784, 0, 0.07]],
  deafen: [[330, 0, 0.06], [262, 0.07, 0.08]],
  undeafen: [[262, 0, 0.06], [330, 0.07, 0.08]],
  pttDown: [[1200, 0, 0.03]],
  pttUp: [[900, 0, 0.03]],
  talkingWhileMuted: [[440, 0, 0.08], [440, 0.12, 0.08]],
  channelCreated: [[659, 0, 0.06], [988, 0.07, 0.08]],
  channelDeleted: [[988, 0, 0.06], [659, 0.07, 0.08]],
  channelEdited: [[784, 0, 0.08]],
  channelMoved: [[659, 0, 0.06], [784, 0.07, 0.06]]
};

// Renders a tone sequence to a WAV blob URL, so defaults and custom files play the same way
export async function renderTones(ev: SoundEvent): Promise<string> {
  const notes = TONES[ev];
  const rate = 44100;
  const length = Math.ceil((Math.max(...notes.map(n => n[1] + n[2])) + 0.05) * rate);
  const ctx = new OfflineAudioContext(1, length, rate);
  for (const [freq, start, dur] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.35, start + 0.008);
    gain.gain.setValueAtTime(0.35, start + dur - 0.02);
    gain.gain.linearRampToValueAtTime(0, start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur);
  }
  const buf = await ctx.startRendering();
  return URL.createObjectURL(toWav(buf.getChannelData(0), rate));
}

function toWav(samples: Float32Array, rate: number): Blob {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Blob([out.buffer], { type: 'audio/wav' });
}
