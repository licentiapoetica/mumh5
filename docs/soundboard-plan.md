# Soundboard plan

[Back to the README](../README.md)

Status: plan only, nothing built. Nothing here is tested yet.

## Goal

A built-in soundboard: short clips you trigger with a button or a key, that everyone in your channel hears as part of your voice, and that you hear yourself. It must stay compatible with stock Murmur and the desktop Mumble client, so there is no new protocol: a clip is sent as ordinary Opus voice from your own session.

## Decisions to confirm first

1. **Mixed into your voice, not shared as files.** Others need no mumh5 and need no copy of the clip. Cost: they hear it at voice quality (Opus, the server bitrate cap) and cannot mute clips separately from you (they can mute you).
2. **Clips stay local.** Each user has their own board. Sharing a board with others is a later step and can reuse File transfer (`src/core/file-transfer.ts`).
3. **Where a clip plays:** into the channel you talk in, plus local monitoring. Whisper targets are not used.

## Design

### Audio path

`voice.svelte.ts` builds `inputGainNode -> capture worklet -> onFrame -> encoder`. The microphone (and denoiser) feed `inputGainNode`. A clip must not go through the denoiser (it would remove music and effects) or through input gain.

- Add a `clipBus` GainNode that connects straight to the `capture` node. Inputs to one AudioWorkletNode input are summed, so mic and clip mix with no worklet change.
- Each play creates an `AudioBufferSourceNode` from the decoded clip, through a per-clip gain, into `clipBus`. Stop disconnects it.
- Local monitoring: a second connection from the per-clip gain to `outputGainNode`, with its own volume setting, so you hear it even when the mic path is gated.
- Clips are decoded once with `decodeAudioData` and kept as `AudioBuffer`, resampled by the context to 48 kHz.

### Transmit gating

`onFrame` decides whether to send from the mode (continuous, push to talk, voice activity). While a clip plays it must send regardless of mode, and the voice activity measure must not be tripped by the clip alone changing mic state.

- A `clipActive` counter in `Voice`; `wanted = wanted || clipActive > 0` in `onFrame`.
- A clip cannot start when `canTalk()` is false (muted, deafened, suppressed). Show why on the button rather than failing silently.
- Mic muted by the user is the common case for soundboard use: the microphone is closed while muted (`syncInput`), so the clip path alone must keep the capture node running. Check that the capture worklet and the encoder still run with no `source`.
- Hold the "speaking" indicator for the clip duration; the existing talking state comes from sent packets, so this should follow with no extra code. Verify.
- Optional setting: duck the microphone while a clip plays, off by default.

### Limits

- Clip length cap (default 20 s) and total library size cap (default 50 MB in IndexedDB), both checked on import with a plain error message. Reuse the idea of `src/core/audio-pack-limits.ts`.
- Rate: a clip is voice, so it is bounded by the server bitrate; no chat rate limit applies.
- Peak limiting on `clipBus` (a DynamicsCompressor) so a loud clip does not clip the encoder.
- A global stop button and "stop on key release" for hold-to-play clips.

### Storage

- Clip files in IndexedDB through `src/lib/blobstore.ts` (`putBlob` / `getBlob` / `deleteBlob`), key `soundboard:<id>`. Not localStorage.
- Board metadata (id, name, color, icon, key binding, volume, mode `once | loop | hold`) in a small store `src/lib/audio/soundboard.svelte.ts`, saved like other settings (only non-default values, see `changedFrom` in `storage.ts`). A new `Settings` key needs its place in `PARTS`; the Sounds tab's reset covers soundboard settings, not the clips themselves.
- Clips are per profile, not per server, so they follow you.
- The Settings > Sounds pack code (`sounds.svelte.ts`) is separate: that is for app event sounds. Do not mix them, but the WAV and ZIP readers in `src/core/audio-pack.ts` can be reused for importing.

### Formats

WAV, MP3, Ogg, Opus, FLAC and whatever `decodeAudioData` accepts in Chromium. Show the supported list from what actually decodes; reject the rest with the browser's error. Browser build and desktop use the same code.

### UI

- `Soundboard.svelte` in `src/ui/`: a grid of buttons (name, color, key hint), a stop button, add/rename/delete/reorder, drag and drop import of audio files. Sentence case labels, no rounded corners, icons from `src/lib/icons.ts`.
- Entry point in both interfaces: a button next to the other voice controls in `UserBar` and `VoiceControls` (stacked), and a place on `VoiceScreen` / `You` in Rooms. The project rule applies: a feature added to one interface needs its place in the other.
- Settings > Sounds gets a Soundboard section for volume, monitoring volume, the clip limits, ducking, and the global shortcuts.
- Keys: reuse the push to talk shortcut mechanism in `voice.svelte.ts`. Desktop can register global shortcuts through the preload API (narrow additions only); the browser build only gets in-window keys. Say that in the help text.
- Playing state shown on the button (progress bar line, no animation beyond `--ease`).

### What others see

Nothing special. They see you speaking. Optionally later: a plugin data message (`mumh5.sb`, like `mumh5.react`) naming the clip being played so mumh5 clients can show "name is playing: Airhorn". Optional, off by default, and it would leak clip names, so it is not part of the first version.

## Phases

1. **Engine.** `soundboard.svelte.ts` with decode, play, stop, hold and loop; `clipBus` in `voice.svelte.ts`; `clipActive` in the gating; monitoring. Unit-test the pure parts (limits, naming, id handling). No UI beyond a debug call.
2. **Library.** IndexedDB storage, import with limits, rename, delete, color, volume.
3. **UI.** Board dialog or panel, controls in both interfaces, Settings section, in-window shortcuts.
4. **Desktop global shortcuts** through the preload API.
5. **Later, only if wanted:** sharing a board through File transfer, the optional "playing" announcement, board per server.

## Tests

- Unit: clip limit checks, import validation, metadata save and reset through `changedFrom`.
- E2E step in `test/e2e/app.e2e.ts`: with the fake microphone off, play a clip and check a second client in the same channel receives voice packets from the first, and that nothing is sent while muted by the server. The fake test microphone's tone does not matter because the clip path skips the denoiser, but the E2E must use the `browser` noise engine as the others do.
- Manual: listen on a stock desktop Mumble client for clipping, latency and the speaking indicator.

## Risks and open questions

- Muted-microphone case: whether the capture worklet and encoder keep running when the microphone track is closed. This decides how much of `syncInput` changes. Check first.
- A user who is self-muted may expect clips not to play. Decide: clips play while self-muted (the usual soundboard behavior) or require an unmuted state. Recommendation: play while self-muted, never while deafened or server-muted.
- Abuse: loud clips in a shared channel. Mitigation is the peak limiter and the per-user local volume other people already have for you. Consider a server-side admin concern out of scope.
- Copyright of imported clips is the user's own; the app ships none (no default board).
- Voice runs on one server at a time; clips play only on the server where voice is active.
