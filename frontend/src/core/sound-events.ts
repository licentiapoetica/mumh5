// ts: the TeamSpeak 3 sound pack key for the same event, so a TS pack's settings.ini maps exactly.
// keys: file name fragments for packs without a settings.ini.
export const SOUND_EVENTS = [
  { id: 'connected', group: 'Connection', name: 'You connected', ts: 'CONNECTION_CONNECTED', keys: ['connected_welcome', 'connected', 'login', 'welcome'] },
  { id: 'disconnected', group: 'Connection', name: 'You disconnected', ts: 'CONNECTION_DISCONNECTED', keys: ['disconnected', 'disconnect', 'logout'] },
  { id: 'connectionLost', group: 'Connection', name: 'Connection lost', ts: 'CONNECTION_LOST_CONNECTION', keys: ['connection_lost', 'lost'] },
  { id: 'error', group: 'Connection', name: 'Server refused or error', ts: 'SERVER_ERROR', keys: ['error'] },
  { id: 'switchedChannel', group: 'You', name: 'You switched channel', ts: 'YOU_SWITCHED_CHANNEL', keys: ['channel_switched', 'switched'] },
  { id: 'moved', group: 'You', name: 'You were moved', ts: 'YOU_WERE_MOVED_TO_DIFFERENT_CHANNEL', keys: ['you_were_moved', 'moved'] },
  { id: 'kicked', group: 'You', name: 'You were kicked', ts: 'YOU_WERE_KICKED_FROM_SERVER', keys: ['you_kicked_server', 'kicked'] },
  { id: 'banned', group: 'You', name: 'You were banned', ts: 'YOU_WERE_BANNED', keys: ['you_were_banned', 'banned'] },
  { id: 'denied', group: 'You', name: 'Permission denied', ts: 'SERVER_INSUFFICIENT_PERMISSIONS', keys: ['insufficient_permissions', 'denied'] },
  { id: 'userConnected', group: 'Your channel', name: 'Someone connected into your channel', ts: 'CLIENT_CONNECTION_CONNECTED_CURRENT_CHANNEL', keys: ['connection_connected_currentchannel', 'user_connected'] },
  { id: 'userDisconnected', group: 'Your channel', name: 'Someone in your channel disconnected', ts: 'CLIENT_CONNECTION_DISCONNECTED_CURRENT_CHANNEL', keys: ['connection_disconnected_currentchannel', 'user_disconnected'] },
  { id: 'userJoined', group: 'Your channel', name: 'Someone joined your channel', ts: 'CLIENT_SWITCHED_TO_CURRENT_CHANNEL_APPEARS', keys: ['switched_tocurrentchannel', 'user_joined', 'joined', 'join'] },
  { id: 'userLeft', group: 'Your channel', name: 'Someone left your channel', ts: 'CLIENT_SWITCHED_FROM_CURRENT_CHANNEL_DISAPPEARS', keys: ['switched_awayfromcurrentchannel', 'user_left', 'left', 'leave'] },
  { id: 'userMovedIn', group: 'Your channel', name: 'Someone was moved into your channel', ts: 'CLIENT_MOVED_TO_CURRENT_CHANNEL_APPEARS', keys: ['moved_tocurrentchannel'] },
  { id: 'userMovedOut', group: 'Your channel', name: 'Someone was moved out of your channel', ts: 'CLIENT_MOVED_FROM_CURRENT_CHANNEL_DISAPPEARS', keys: ['moved_awayfromcurrentchannel'] },
  { id: 'userKicked', group: 'Your channel', name: 'Someone in your channel was kicked', ts: 'CLIENT_WAS_KICKED_FROM_SERVER_CURRENT_CHANNEL', keys: ['kicked_server_currentchannel'] },
  { id: 'userBanned', group: 'Your channel', name: 'Someone in your channel was banned', ts: 'CLIENT_WAS_BANNED_CURRENT_CHANNEL', keys: ['banned_server_currentchannel'] },
  { id: 'recordingStarted', group: 'Your channel', name: 'Someone started recording', ts: 'CLIENT_RECORDING_START', keys: ['recording_started'] },
  { id: 'recordingStopped', group: 'Your channel', name: 'Someone stopped recording', ts: 'CLIENT_RECORDING_STOP', keys: ['recording_stopped'] },
  { id: 'shareStarted', group: 'Screen sharing', name: 'A screen share started (yours or in your channel)', ts: 'MUMH5_SHARE_STARTED', keys: ['share_started', 'stream_started'] },
  { id: 'shareStopped', group: 'Screen sharing', name: 'A screen share stopped', ts: 'MUMH5_SHARE_STOPPED', keys: ['share_stopped', 'stream_stopped'] },
  { id: 'viewerJoined', group: 'Screen sharing', name: 'Someone started watching your screen', ts: 'MUMH5_VIEWER_JOINED', keys: ['viewer_joined'] },
  { id: 'viewerLeft', group: 'Screen sharing', name: 'Someone stopped watching your screen', ts: 'MUMH5_VIEWER_LEFT', keys: ['viewer_left'] },
  { id: 'message', group: 'Chat', name: 'Channel message', ts: 'CHAT_RECEIVED_MESSAGE_CHANNEL', keys: ['chat_message_inbound', 'message'] },
  { id: 'privateMessage', group: 'Chat', name: 'Direct message', ts: 'CHAT_RECEIVED_MESSAGE_CLIENT', keys: ['private', 'direct', 'pm'] },
  { id: 'poke', group: 'Chat', name: 'Someone poked you', ts: 'OTHER_RECEIVED_POKE', keys: ['poke'] },
  { id: 'messageSent', group: 'Chat', name: 'You sent a message', ts: 'CHAT_SENT_MESSAGE_CHANNEL', keys: ['chat_message_outbound', 'sent'], off: true },
  { id: 'uploadDone', group: 'Chat', name: 'A file arrived', ts: 'OTHER_FILETRANSFER_COMPLETE', keys: ['filetransfer_complete', 'upload_done'] },
  { id: 'uploadFailed', group: 'Chat', name: 'A file could not be sent or received', ts: 'OTHER_FILETRANSFER_FAILED', keys: ['filetransfer_failed', 'upload_failed'] },
  { id: 'mute', group: 'Microphone and sound', name: 'You muted', ts: 'SOUND_CAPTURE_MUTED', keys: ['mic_muted', 'mute'] },
  { id: 'unmute', group: 'Microphone and sound', name: 'You unmuted', ts: 'SOUND_CAPTURE_UNMUTED', keys: ['mic_activated', 'unmute'] },
  { id: 'deafen', group: 'Microphone and sound', name: 'You deafened', ts: 'SOUND_PLAYBACK_MUTED', keys: ['sound_muted', 'deafen'] },
  { id: 'undeafen', group: 'Microphone and sound', name: 'You undeafened', ts: 'SOUND_PLAYBACK_UNMUTED', keys: ['sound_resumed', 'undeafen'] },
  { id: 'pttDown', group: 'Microphone and sound', name: 'Push to talk pressed', ts: 'SPECIAL_MIC_CLICK_SELF_ON', keys: ['mic_click_on', 'ptt_on'] },
  { id: 'pttUp', group: 'Microphone and sound', name: 'Push to talk released', ts: 'SPECIAL_MIC_CLICK_SELF_OFF', keys: ['mic_click_off', 'ptt_off'] },
  { id: 'talkingWhileMuted', group: 'Microphone and sound', name: 'You are talking while muted', ts: 'SPECIAL_TALKING_WHILE_MUTED', keys: ['stop_talking', 'talking_while_muted'] },
  { id: 'channelCreated', group: 'Channels', name: 'You created a channel', ts: 'CHANNEL_CREATED_BY_YOU', keys: ['channel_created'] },
  { id: 'channelDeleted', group: 'Channels', name: 'You deleted a channel', ts: 'CHANNEL_DELETED_BY_YOU', keys: ['channel_deleted'] },
  { id: 'channelEdited', group: 'Channels', name: 'You edited a channel', ts: 'CHANNEL_EDITED_CURRENT_BY_YOU', keys: ['channel_edited'] },
  { id: 'channelMoved', group: 'Channels', name: 'You moved a channel', ts: 'CHANNEL_MOVED_BY_YOU', keys: ['channel_moved'] }
] as const;

export type SoundEvent = (typeof SOUND_EVENTS)[number]['id'];

export const QUIET_EVENTS: ReadonlySet<SoundEvent> = new Set(['connectionLost', 'privateMessage', 'poke']);

// The last one heard must match the real mic state, so these are never dropped or throttled.
export const STATE_EVENTS: ReadonlySet<SoundEvent> = new Set(['mute', 'unmute', 'deafen', 'undeafen', 'pttDown', 'pttUp']);

// Exact, case-sensitive paths in the Mumble voice pack format. App-specific events
// without a counterpart keep their short tone unless the user assigns a clip.
export const PACK_PATHS: Partial<Record<SoundEvent, string>> = {
  connected: 'ServerNotification/ServerConnected.wav',
  disconnected: 'ServerNotification/ServerDisconnected.wav',
  connectionLost: 'ServerNotification/ServerDisconnected.wav',
  error: 'SystemNotification/CriticalError.wav',
  switchedChannel: 'ChannelNotification/SelfChannelJoin.wav',
  moved: 'ChannelNotification/SelfChannelJoinOther.wav',
  kicked: 'ModerationNotification/YouWereKicked.wav',
  banned: 'ModerationNotification/YouWereBanned.wav',
  denied: 'PermissionNotification/PermissionDenied.wav',
  userConnected: 'ChannelNotification/ChannelJoinConnect.wav',
  userDisconnected: 'ChannelNotification/ChannelLeaveDisconnect.wav',
  userJoined: 'ChannelNotification/ChannelJoin.wav',
  userLeft: 'ChannelNotification/ChannelLeave.wav',
  userMovedIn: 'UserNotification/UserMoved.wav',
  userMovedOut: 'UserNotification/UserMoved.wav',
  userKicked: 'ModerationNotification/UserKicked.wav',
  userBanned: 'ModerationNotification/UserBanned.wav',
  recordingStarted: 'RecordingNotification/UserRecordingStarted.wav',
  recordingStopped: 'RecordingNotification/UserRecordingStopped.wav',
  message: 'MessageNotification/TextMessage.wav',
  privateMessage: 'MessageNotification/PrivateTextMessage.wav',
  mute: 'AudioNotification/SelfMute.wav',
  unmute: 'AudioNotification/SelfUnmute.wav',
  deafen: 'AudioNotification/SelfDeaf.wav',
  undeafen: 'AudioNotification/SelfUndeaf.wav',
  pttDown: 'InputNotification/KeyPressed.wav',
  pttUp: 'InputNotification/KeyReleased.wav',
  talkingWhileMuted: 'TalkingNotification/TalkingMuted.wav',
  channelCreated: 'ChannelNotification/ChannelCreated.wav',
  channelDeleted: 'ChannelNotification/ChannelDeleted.wav',
  channelEdited: 'ChannelNotification/ChannelStateChanged.wav',
  channelMoved: 'ChannelNotification/ChannelMoved.wav'
};

// Clips the standard pack lacks. A pack that has one plays it for that event;
// otherwise the event keeps its PACK_PATHS clip or short tone.
export const PACK_VARIANTS: Partial<Record<SoundEvent, string>> = {
  connectionLost: 'ServerNotification/ConnectionLost.wav',
  userMovedOut: 'UserNotification/UserMovedOut.wav',
  shareStarted: 'UserNotification/ScreenShareStarted.wav',
  shareStopped: 'UserNotification/ScreenShareStopped.wav',
  viewerJoined: 'UserNotification/ScreenWatchStarted.wav',
  viewerLeft: 'UserNotification/ScreenWatchStopped.wav',
  poke: 'MessageNotification/Poked.wav',
  messageSent: 'MessageNotification/MessageSent.wav',
  uploadDone: 'MessageNotification/FileReceived.wav',
  uploadFailed: 'MessageNotification/FileTransferFailed.wav'
};

export function defaultSoundSettings(): SoundSettings {
  return { enabled: true, volume: 0.6, on: {}, custom: {}, clips: {}, packs: [] };
}

export interface SoundPack { id: string; name: string }
export const isSoundPackId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);

export function normalizeSoundSettings(value: unknown): SoundSettings {
  const out = defaultSoundSettings();
  if (!value || typeof value !== 'object') return out;
  const v = value as Partial<SoundSettings>;
  if (typeof v.enabled === 'boolean') out.enabled = v.enabled;
  if (typeof v.volume === 'number' && Number.isFinite(v.volume)) out.volume = Math.max(0, Math.min(1, v.volume));
  if (Array.isArray(v.packs)) {
    for (const p of v.packs) if (p && isSoundPackId(p.id) && typeof p.name === 'string' && !out.packs.some(e => e.id === p.id)) {
      out.packs.push({ id: p.id, name: p.name.slice(0, 255) });
    }
  }
  if (typeof v.pack?.name === 'string') {
    out.pack = { name: v.pack.name.slice(0, 255) };
    if (isSoundPackId(v.pack.id) && out.packs.some(p => p.id === v.pack!.id)) out.pack.id = v.pack.id;
  }
  for (const { id } of SOUND_EVENTS) {
    if (typeof v.on?.[id] === 'boolean') out.on[id] = v.on[id];
    if (typeof v.custom?.[id]?.name === 'string') {
      out.custom[id] = { name: v.custom[id]!.name.slice(0, 255) };
      if (typeof v.custom[id]!.data === 'string') out.custom[id]!.data = v.custom[id]!.data;
      if (v.custom[id]!.parked === true) out.custom[id]!.parked = true;
    }
    if (typeof v.clips?.[id] === 'string') out.clips![id] = v.clips[id];
  }
  return out;
}

// Before quiet defaults a missing choice meant on. Settings from then have neither clips
// nor packs; people who never opened Sounds have none at all but did hear every event.
export function upgradeSoundSettings(saved: unknown, earlierInstall: boolean): SoundSettings {
  const out = normalizeSoundSettings(saved);
  const legacy = saved && typeof saved === 'object' ? !('packs' in saved) && !('clips' in saved) : earlierInstall;
  if (legacy) for (const e of SOUND_EVENTS) out.on[e.id] ??= !(e as { off?: boolean }).off;
  return out;
}

export interface SoundSettings {
  enabled: boolean;
  volume: number;
  // Explicit choices survive switching packs; missing choices use QUIET_EVENTS.
  on: Partial<Record<SoundEvent, boolean>>;
  packs: SoundPack[];
  pack?: { id?: string; name: string }; // no id: legacy single-pack storage
  clips?: Partial<Record<SoundEvent, string>>;
  // File names only; audio is stored separately. parked: kept, but set aside by a pack switch.
  custom: Partial<Record<SoundEvent, { name: string; data?: string; parked?: boolean }>>;
}

// recovered: sounds.json was damaged and this was rebuilt from the saved files.
export type LoadedSoundSettings = SoundSettings & { recovered?: boolean };
