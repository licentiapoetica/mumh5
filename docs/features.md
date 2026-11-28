# Features and compatibility

[Back to the README](../README.md)

## Voice

- Voice activity detection with a live level meter and an adjustable threshold, push to talk, or always on
- Noise suppression, echo cancellation and automatic gain control
- Microphone and output selection, input and output volume
- Per-person volume (0 to 300%) and "mute for me"
- Speaking indicators in the channel tree, the member list and your own panel
- Encrypted UDP (Mumble's OCB2-AES128), with fallback to the TCP connection and a TCP-only switch
- Bitrate limited to what the server allows
- Right-click mute or deafen for quick device and volume options
- Microphone test that plays your voice back to you
- Optional: give the microphone back while muted, so a Bluetooth headset stays out of its telephone mode. On by default on phones; not yet tried on a real phone

## Channels and people

- Channel tree that starts collapsed; channels with people in them open up
- Single click selects a channel, double click joins; its description shows when you rest on it or click the marker next to it
- Side chat: write in any channel without leaving yours
- Profile cards next to the person you click, with their picture, channel and formatted description; local nicknames and registration status
- Profile pictures (Mumble avatars), cut square and sized for the server; the desktop Mumble client has them too
- Change your name (mumh5 reconnects for you) and register on a server
- Connection information: ping, packet loss, client version and, for admins, the certificate chain
- Moderation from the right-click menu: move, server mute and deafen, priority speaker, kick, ban, register
- Create, edit, delete and link channels. Drag a channel into another, or in front of or behind it; drag people between channels
- Permission editor: rules per channel with inheritance, groups and members
- If you are kicked, you see who did it and why, with a Reconnect button
- Optional connect at start per server (Add/Edit server): the server connects when mumh5 starts; with several, the first in the list is shown
- Optional automatic reconnect per server (Add/Edit server): retries connection loss, kicks and failed connections after 5 seconds, backing off to 30 seconds. Cancel a pending retry at any time; manual disconnects, bans, login rejections and certificate changes stop retries.

## Chat

- Messages grouped by author, direct messages, unread badges
- Direct messages are listed under the channels where the list sits beside the chat, and are tabs above the chat in the stacked layout and on narrow screens, next to a tab for the channel
- Saving chat history on this device is opt-in in Settings, Chat and files. Retention is configurable in hours and defaults to 24 hours; expired messages are deleted locally on opening the app and while it runs. Private chats follow user identities across reconnects. Closing a chat hides it; Delete history removes it. Turning saving off deletes saved history. Nothing is stored on the server.
- Emoji reactions on messages: the button on a message, its right-click menu, or a click on a reaction to add or take back yours. Only mumh5 users see them
- Pokes like in TeamSpeak: right-click a person, Poke, an optional note; it pops up with its own sound in mumh5 (plus a system notification and a blinking tray icon while the window is in the background) and arrives as a private message in other Mumble clients
- Files of any kind by drag and drop, paste or the attach button, carried by the Mumble server itself, no file host needed ([how](#file-sharing))
- Shared files, pictures, video and audio use one card with the filename, preview or player, and download or open action
- PDFs show a small first-page preview; other documents use the same file card
- YouTube links as click-to-play players (off by default)
- Link previews with title, description and picture
- Incoming HTML is sanitized, and pictures from unknown hosts are never loaded
- Messages stay readable in the Mumble desktop client

## Text channels

- A channel marked as a text channel is read and written without joining it, from any voice channel
- It is a normal Mumble channel on the server, created and removed with the usual channel permissions
- The server keeps no messages. Clients can opt in to local history with configurable retention (24 hours by default), and pass the last 50 recent messages to people who connect later
- Everyone on the server who uses mumh5 can read them; there are no private text channels yet
- Needs a server from version 1.4 that allows HTML

## Screen and camera sharing

- Share a screen, a window or a camera with the mumh5 users in your channel. A dialog shows a preview and lets you choose the sound and the quality first
- Cameras appear in the voice tiles, several at once; a click enlarges one
- A screen opens large, with the people as a strip of tiles below, and can move to its own window
- Sound: on Linux one program or everything except mumh5 (through PipeWire); on Windows the whole system; in a browser what the browser offers
- The stream goes directly between the two clients (WebRTC), up to 8 viewers per stream. Only the setup messages pass through the Mumble server
- Sharer and viewer see each other's IP address; mumh5 says so before the first use
- Direct connections across routers may need STUN; restrictive networks may need a TURN relay. The browser build uses its proxy's STUN and TURN service. Desktop clients can configure a STUN server or relay in Settings > Screen sharing
- The screenshot runner exercises sharing between clients on one machine with a simulated canvas stream. This does not verify real display or system-audio capture, Windows, or connections across the internet

## Interfaces and look

- Three layouts: channels on top (the default), channels left and members right, or chat left and channels right
- 100 color schemes with a search box. Eleven are made by hand, the rest are generated from a hue and an accent

## Sounds

- Configurable sounds for joins, leaves, messages, mute, push to talk, kicks and more. Only connection loss, direct messages and pokes play by default
- Bundled Chatterbox female voice pack. In Settings > Sounds, import a ZIP pack, choose a clip or an individual audio file per event, adjust volume, preview, or restore the standard pack and quiet defaults
- ZIP and notification-folder imports grow a personal pack library. Choose the active pack in the Audio pack selector, including the standard pack at any time. Reimporting identical audio keeps one entry, even from a differently named folder or ZIP. Removing a pack leaves the others saved; resetting to built-in also keeps the library
- ZIP packs have notification folders directly at the root, for example `AudioNotification/SelfMute.wav`, `MessageNotification/PrivateTextMessage.wav` and `PermissionNotification/Denied/ChannelFull.wav`. `manifest.json` and `README.md` are optional. WAV clips are mapped by exact path; missing clips use the standard pack. All clips are available in each event's selector. A pack can also give these events their own clip: `ServerNotification/ConnectionLost.wav`, `UserNotification/UserMovedOut.wav`, `UserNotification/ScreenShareStarted.wav`, `UserNotification/ScreenShareStopped.wav`, `UserNotification/ScreenWatchStarted.wav`, `UserNotification/ScreenWatchStopped.wav`, `MessageNotification/Poked.wav`, `MessageNotification/MessageSent.wav`, `MessageNotification/FileReceived.wav` and `MessageNotification/FileTransferFailed.wav`. App-specific events without a matching clip use short tones
- ZIP packs are limited to 32 MB compressed, 64 MB of audio expanded, 512 entries and 4 MB per clip. Notification folders are saved uncompressed and limited to 32 MB. The standard pack is fetched when the first sound plays or Settings > Sounds opens, so it is not part of the browser build's offline files. TeamSpeak 3 folders (`settings.ini`) and loose audio files are also supported
- Desktop sound preferences and the library list are in `sounds.json` beside identities and other user settings (`~/.config/mumh5` on Linux); library archives are in `sounds/packs/` in that directory. Existing custom sounds migrate there on first use, and a previously imported ZIP becomes a library entry. The browser keeps preferences locally and audio in IndexedDB
- Importing or switching packs sets individual files aside so the selected pack takes effect, without deleting them ("Use my file" brings one back), and keeps your event on/off choices and clip selections. "Reset all to built-in" deletes those files. "Use quiet defaults" restores the three default events, which are also what new installs start with; existing installs keep the sounds they had. Sounds use the selected voice output device and play one at a time, without a backlog. Every new enabled notification stops the current clip and starts from the beginning, including repeated events

## Servers and identity

- Server list with custom icons, your own order, connection status and unread counts
- A start screen with your servers, how many people are on each and the ping, before you connect
- Public server browser with user counts and ping (desktop app)
- Identity setup: create a certificate, import a `.p12`, or reuse the one from the Mumble desktop client
- Several identities, and a different one per server if you like
- Password-protected backups of an identity
- Server certificates are pinned on first use; a certificate viewer shows the chain
- Tray icon that shows whether you are talking, muted or deafened

## File sharing

Files travel through the Mumble server, to other mumh5 users. There is no file host and nothing is stored on the server.

- A file is announced in the chat with its name, size and a preview picture. Regular Mumble users see that and nothing more.
- mumh5 users fetch it with one click, or by themselves when it is small (20 MB by default, Settings, Chat and files). Small pictures are sent inline as they are, so everyone sees them.
- The pieces are chat messages addressed only to the people downloading. Murmur allows about one message a second per user, but a message may be as long as the server's image limit (128 KB of text by default), and mumh5 packs 15 bits into every character. On a server with default limits that is about 200 KB/s, or 12 MB a minute, from each person sending. One message reaches every downloader at once, so ten people fetching the same file cost the sender no more than one.
- Anyone who has a file can send it, not only the person who posted it. A download asks everyone online who has it and splits the pieces between up to four of them (the server limits each sender separately), so it keeps working after the sender has left.
- Each computer keeps the files it sent and received, up to 2 GB, oldest out first. Files are checked against the hash in the announcement.
- Your own chat messages always go out first; files use what is left of the server's message limit.

Servers can raise the limits for faster transfers: `imagemessagelength` (larger pieces, 0 for no limit) and `messagelimit` / `messageburst` in the server's configuration. Needs Mumble 1.4 or newer on the server. Sending a large file uses your upload bandwidth; on a slow line, voice over the TCP tunnel (as in the browser version) can lag while it runs.

## Roadmap

- System-wide push to talk
- Whisper and shout
- Text channels: private ones, and history while nobody is online (needs a helper on the server)
- Rich chat between mumh5 users: replies, edits, typing indicators
- End-to-end encrypted direct messages (OTR or similar): under discussion, see [the plan](otr-plan.md)
- Screen sharing: a media server for large rounds (today every sender uploads once per viewer, up to 8)
- Release builds for all platforms
