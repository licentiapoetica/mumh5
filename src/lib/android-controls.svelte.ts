import { sessions } from './session.svelte.ts';
import { androidVoiceListen, androidVoiceOnStarted, androidVoiceUpdate } from './android-shell.ts';

// The buttons of the Android app's ongoing notification: they act on the server voice is on, and
// the notification shows its channel and your state.
export function startAndroidControls(): void {
  const target = () => sessions.voiceSession;
  const on = androidVoiceListen(action => {
    const s = target();
    if (!s?.client) return;
    const self = s.self;
    if (action === 'mute') s.setSelfMute(!(self?.selfMute ?? sessions.mute));
    else if (action === 'deafen') s.setSelfDeaf(!(self?.selfDeaf ?? sessions.deaf));
    else if (action === 'leave') s.disconnect();
  });
  if (!on) return;
  const push = () => {
    const s = target();
    const self = s?.self;
    androidVoiceUpdate({
      text: self ? `${s.channel(self.channelId)?.name ?? 'In voice'} - ${s.server?.label ?? ''}` : 'In voice',
      muted: self ? self.selfMute : sessions.mute,
      deafened: self ? self.selfDeaf : sessions.deaf
    });
  };
  androidVoiceOnStarted(push);
  $effect.root(() => { $effect(push); });
}
