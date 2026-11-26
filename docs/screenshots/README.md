# README screenshots

[Back to the README](../../README.md)

`test/e2e/screenshots.ts` drives fresh mumh5 clients against a real local Mumble server. It creates identities, joins channels, sends chat messages, attaches a file, opens a profile and settings, changes layouts and themes, and streams an animated canvas to three viewers. The screenshots capture the running UI; no UI is drawn or composited afterwards.

The images in this directory were captured from the browser build using headless Chromium. Microphone and camera devices are simulated. The racing scene replaces `getDisplayMedia` with a canvas stream: the runner verifies that all three viewers receive video, but does not exercise an operating system's display picker, system-audio capture, real phones, Windows, or connections across the internet.

## Regenerate with a test client

Use Node.js 22 or newer, Docker, and a Chromium installation. Run these commands from the repository root. **Use a disposable server:** the script deletes its existing channels and replaces them with the screenshot scene. Never point it at a community server.

```bash
npm ci
npm run build:web

docker run -d --name mumh5-readme-murmur \
  -p 127.0.0.1:64740:64738 -p 127.0.0.1:64740:64738/udp \
  -e MUMBLE_SUPERUSER_PASSWORD=shots \
  -e MUMBLE_CONFIG_AUTOBANATTEMPTS=0 \
  -e 'MUMBLE_CONFIG_WELCOMETEXT=Welcome to the community voice server.' \
  mumblevoip/mumble-server

MUMBLE_TEST_HOST=127.0.0.1:64740 \
MUMBLE_SUPERUSER_PASSWORD=shots \
MUMH5_SCREENSHOT_WEB=1 \
CHROMIUM_PATH=/usr/bin/chromium \
npm run screenshots

docker rm -f mumh5-readme-murmur
```

Set `CHROMIUM_PATH` to your Chromium executable. The runner starts its own proxy on `127.0.0.1:18440` and STUN/TURN on port `18441`. It uses separate browser contexts for each client, needs no external websites for previews, and closes its clients and proxy on success or failure. Images are written here.

For Electron captures, run `npm run build` and omit `MUMH5_SCREENSHOT_WEB` and `CHROMIUM_PATH`. On Linux, Electron needs an X11 display; a virtual display such as Xvfb keeps test windows off your desktop. The same disposable Mumble server is required.

## Image inventory

| File | View |
| --- | --- |
| `stacked.png` | Default Stacked layout, channels above chat |
| `main.png` | Modern layout, channels left and members right |
| `profile.png` | A member's profile card |
| `voice-settings.png` | Voice settings |
| `settings-appearance.png` | Appearance settings |
| `theme-win95.png`, `theme-light.png`, `theme-frost.png`, `theme-midnight.png` | The same conversation in four color schemes |
| `sharing.png` | Simulated screen capture with three connected viewers |
