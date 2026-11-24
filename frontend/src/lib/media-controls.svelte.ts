import { sessions } from './session.svelte.ts';
import { voice } from './audio/voice.svelte.ts';

// The media notification of phones (see VoiceEngine.startOutputElement): it names the channel and
// toggles your microphone. Firefox offers only play and pause there, so both toggle it; the
// playback state stays "playing", since a paused session lets Android stop the page.
export function startMediaControls(): void {
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
  if (!ms) return;
  const target = () => sessions.voiceSession;
  const toggleMute = () => {
    const s = target();
    if (!s?.client) return;
    s.setSelfMute(!(s.self?.selfMute ?? sessions.mute));
  };
  const handle = (action: string, fn: (() => void) | null) => {
    try { ms.setActionHandler(action as MediaSessionAction, fn); } catch { /* not offered by this browser */ }
  };

  $effect.root(() => {
    $effect(() => {
      const s = target();
      const self = s?.self;
      const on = voice.playingMedia && !!self;
      if (!on || !s || !self) {
        ms.metadata = null;
        ms.playbackState = 'none';
        for (const a of ['play', 'pause', 'togglemicrophone', 'hangup']) handle(a, null);
        return;
      }
      const state = self.selfDeaf ? 'Deafened' : self.selfMute ? 'Muted' : 'Microphone on';
      ms.metadata = new MediaMetadata({ title: s.channel(self.channelId)?.name ?? 'Voice', artist: `${state} - ${s.server?.label ?? ''}` });
      ms.playbackState = 'playing';
      (ms as MediaSession & { setMicrophoneActive?: (on: boolean) => void }).setMicrophoneActive?.(!self.selfMute);
      handle('play', toggleMute);
      handle('pause', toggleMute);
      handle('togglemicrophone', toggleMute);
      handle('hangup', () => target()?.disconnect());
    });
  });
}
