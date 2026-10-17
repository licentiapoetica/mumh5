# Changelog

All notable changes to mumh5. Versions follow the `version` in `package.json`.

## 0.2.0 - 2026-10-17

### Added

- File sharing through the Mumble server itself, with no file host: any file up to 2 GB, announced in the chat with a preview picture (all that regular Mumble clients see) and sent in pieces to the mumh5 users who fetch it. Small files are fetched by themselves (up to 20 MB, Settings, Chat and files). About 12 MB a minute per sender on a server with default limits; anyone who has the file can send it, and a download shares the pieces out between up to four of them. Files sent and received are kept on the computer, up to 2 GB.
- 95 more color schemes, 100 in all: six made by hand (Forest, Ember, Ocean, Plum, Paper, High contrast) and 89 generated from a hue and an accent (`npm run themes`), 64 dark and 25 light. The picker can be narrowed by name and by dark or light.
- Voice setting "Give the microphone back while muted", on by default on phones and tablets: a Bluetooth headset then stays out of its telephone mode while you are muted, so what you hear keeps its full quality.
- A second interface, "Rooms" (Settings, Appearance, Interface), made for phones first: one screen at a time with a bar for Rooms, Chat, Voice, People and You. Rooms are a list with the people inside shown inline and a Join button; your room and a mute and deafen dock stay in reach; the voice screen shows the room as tiles with large controls. Wide windows keep the rooms next to the chosen screen. It uses the same dialogs and menus as the standard interface. Not in it yet: moving channels and people by dragging.
- Text channels (mumh5 only): a channel marked as a text channel in its dialog is read and written without joining it, from any voice channel. Messages travel between mumh5 clients; other Mumble clients see an ordinary channel and none of the messages. The server keeps nothing: each client keeps the last 200 messages per channel and hands the last 50 to people who connect later. Everyone on the server who uses mumh5 can read them.
- Channels can be dragged in front of or behind another channel, not only into one. A line shows where the channel will land, the dragged channel is dimmed, the people under a channel count as part of its drop target, and resting on a closed channel opens it.
- Voice in browsers without an audio codec of their own (Firefox on Android): a built-in Opus codec takes over there.
- Cameras of people in your channel show by themselves, like in a video call; each one can be hidden from its right-click menu, and all of them switched off with one button.
- Camera sharing, as a second source in the screen sharing dialog, and camera rounds: several people's cameras at once in the voice tiles.
- A relay for streams in the web proxy, used automatically by the browser version and, with its address entered in Settings, by the desktop app, for networks and browsers that allow no direct connection.
- Screen sharing between mumh5 users in a channel: a dialog to choose the screen or window (with preview), the sound and the quality; sound from one program or the whole system on Linux through PipeWire. Viewers watch in the voice tiles, enlarge a stream like in a meeting and set its volume. Streams go directly between clients; a STUN server can be set in Settings, Voice.
- Browser version: `npm run build:web` builds the web app and a small self-hosted proxy that bridges browsers to Mumble servers on an allowlist. Identities are kept in the browser, voice goes through the TCP tunnel. See "Browser version" in the README.
- Link previews in chat: title, description and image for web links (up to two per message), fetched by this computer when turned on in Settings, Chat and files (off by default).
- Voice tiles on small windows: when the window is too narrow for the member list, the people in your voice channel appear as tiles above the chat, light up while they talk, and keep mute and deafen at hand. The tiles can be collapsed.
- Per-person volume slider (0 to 300%) directly in the user context menu. Double-click resets it to 100%.

### Changed

- Profile panel: the current channel sits on its own line under the name, and the badge row wraps on narrow panels.
- Profile panel: guests no longer get a "Guest" badge; registered users keep the "Registered" badge.
- Profile panel: volume, "mute for me" and nickname moved to the user context menu, which has them for every place a user appears.
- User context menu: "Information" moved to the end of the menu.
- User information dialog updates every second, so online and idle times tick live.
- Channel tree: channels no longer show an icon in front of the name; only channels you cannot enter show a lock.
- Channel details header without the channel icon.

### Removed

- Uploads to a f0ckm instance, its settings (upload host, key, expiry) and link previews fetched through it. Files now go through the Mumble server.

### Fixed

- A description preview could open after dropping a channel and stay on screen.
- Messages sent in quick, irregular bursts could still be dropped by the server's rate limit. The client now mirrors Murmur's bucket exactly (it only leaks whole seconds and restarts its timer on every message) and queues instead of losing messages.

## 0.1.0

- Initial version.
