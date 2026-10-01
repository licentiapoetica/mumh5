# Changelog

All notable changes to mumh5. Versions follow the `version` in `package.json`.

## Unreleased

### Added

- Browser version: `npm run build:web` builds the web app and a small self-hosted proxy that bridges browsers to Mumble servers on an allowlist. Identities are kept in the browser, voice goes through the TCP tunnel. See "Browser version" in the README.
- Link previews in chat: title, description and image for web links (up to two per message). By default they are fetched by your f0ckm upload host, so the linked sites never see your IP address. Can be switched to "fetched by this computer" or off in Settings, Chat and files.
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

### Fixed

- Messages sent in quick, irregular bursts could still be dropped by the server's rate limit. The client now mirrors Murmur's bucket exactly (it only leaks whole seconds and restarts its timer on every message) and queues instead of losing messages.

## 0.1.0

- Initial version.
