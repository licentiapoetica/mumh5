# Changelog

All notable changes to mumh5. Versions follow the `version` in `package.json`.

## Unreleased

### Added

- Profile cards: a click on someone (in the channel list, the member list, the chat or a voice tile) opens their card next to them, like in Discord: picture, name, channel, description and Send message. On phones it is a sheet at the bottom. Your own card has Edit description, Change name and your picture.
- Profile pictures, as Mumble textures, so they go through the server like everything else and the desktop Mumble client has them too. Your picture is cut square, made small enough for the server's image limit, kept on this computer and sent to every server you connect to, since servers keep pictures only for registered users.
- A start screen while not connected: your saved servers with how many people are on them and their ping, a notice when you were kicked or the connection was lost, and your mute and deafen buttons. The counts come from a ping at start and once a minute; in the browser version the proxy pings the servers it allows.
- The interface font is Inter, shipped with the app (nothing is fetched from outside).

### Changed

- New look throughout, still with square corners: one type scale, fields and buttons of one height with a visible focus ring, calmer spacing in the chat, the message box set in from the edges, softer shadows on menus and dialogs, sentence-case labels.
- New app icon: a lowercase m that is also a speech bubble, white on near black; the tray icon uses the same black while idle.
- Stacked is the default layout for new installations; saved settings keep their layout.
- Settings lists its sections on the left and keeps one size between them.
- Message times: just the time for today, "Yesterday" and the date before that; the full date stays on hover.
- The buttons under your name fit one row at the default sidebar width.
- A single click on a channel only selects it (a double click joins). The description opens from the marker next to the channel or from its menu, next to the channel instead of in the side panel.
- A stream opened in a separate window leaves only its bar in the main window, and the chat gets the room.
- Resized panels return to their size when a window that was made smaller grows again.

### Fixed

- The desktop app no longer downloads spellchecker dictionaries from Google (redirector.gvt1.com); the spellchecker is off.
- The stacked layout keeps the message box and the picture of a stream visible however small the window or the chat is made, and the channel list can no longer be dragged over them.
- Connecting while muted, or voice coming back to a server, no longer plays the mute or undeafen sound; unmuting plays the unmute sound instead of undeafen.
- Settings tabs no longer run off the edge, and the identity setup no longer ends in an empty bar.

## 0.2.0 - 2026-10-17

### Added

- Linux: `install.sh` and `uninstall.sh` in the `.tar.gz`. They install for one user (`~/.local`) or for everyone (`/opt`, with sudo), with a `mumh5` command and a menu entry; running the installer again updates. Uninstalling keeps settings and identities unless `--purge` is given.
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
