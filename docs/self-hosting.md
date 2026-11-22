# Self-hosting the browser client

[Back to the README](../README.md)

## Build and run

From a [source checkout](development.md), run:

mumh5 also runs in a browser. Browsers cannot open the TLS connection Mumble uses or present a client certificate, so a small proxy you host yourself does that part: it serves the web app and bridges each browser connection to a Mumble server.

```bash
npm ci
npm run build:web      # web app to dist-web/, proxy to dist-proxy/proxy.mjs
MUMH5_SERVERS="mumble.example.com=My server" node dist-proxy/proxy.mjs
```

Then open `http://127.0.0.1:8080`. For development, `npm run dev:web` starts the proxy and a hot-reloading page together, with any server allowed. To deploy, copy `dist-web/` and `dist-proxy/` next to each other on the server (Node 22 or newer, no `node_modules` needed) and put a reverse proxy with HTTPS in front that forwards WebSocket upgrades. Browsers only allow the microphone on HTTPS pages (or on localhost). Over HTTPS the page can also be installed as an app; it keeps its own files, so it opens without the proxy, but connecting still goes through it. After a new deploy, open pages notice it within about 15 minutes (they ask the site for `version.json`) and offer a reload.

## Docker

With Docker, the same thing is one command; settings go in a `.env` file next to `docker-compose.yml`:

```bash
echo 'MUMH5_SERVERS=mumble.example.com=My server' > .env
echo 'MUMH5_DEFAULT_SERVER=mumble.example.com' >> .env   # optional: already in everyone's server list
docker compose up -d --build
```

The container uses the host's network: the proxy listens on `127.0.0.1:8080` for your reverse proxy, and a Mumble server on the same machine is reachable as `localhost`.

## Screen sharing and relay ports

For screen sharing, open these in the firewall (and forward them on a router in front of the server): port 3478 for UDP and TCP, and UDP 49160-49659. They carry STUN and the relay, which the browser version uses without any setting. Relayed streams pass through your server and use its bandwidth, a few Mbit/s per viewer; anyone who knows the site's address can get credentials for it (the desktop app asks from outside the site), limited by connection quotas per address; there is no bandwidth cap yet.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `MUMH5_SERVERS` | none | Mumble servers people may connect to: `host[:port][=Label]`, comma-separated. Required unless `MUMH5_DEFAULT_SERVER` is set or `MUMH5_ALLOW_ANY=1` |
| `MUMH5_DEFAULT_SERVER` | none | One server, `host[:port][=Label]`, added to the saved servers of each visitor on their first visit (again only if you change it). Allowed without listing it in `MUMH5_SERVERS`. The visitor picks a name on the first connect |
| `MUMH5_ALLOW_ANY` | off | Allow any server on the public internet. Private and loopback addresses stay blocked, except servers listed in `MUMH5_SERVERS` (for a Mumble server on the same machine: `MUMH5_SERVERS=localhost`), or all of them with `MUMH5_ALLOW_PRIVATE=1` |
| `MUMH5_PORT`, `MUMH5_BIND` | `8080`, `127.0.0.1` | Where the proxy listens |
| `MUMH5_ORIGINS` | same host | Origins allowed to use the API, comma-separated, when the page is hosted elsewhere |
| `MUMH5_TRUST_PROXY` | off | Take client addresses from `X-Forwarded-For` (set this behind a reverse proxy) |
| `MUMH5_SEND_PROXY` | off | Announce each visitor's address to the server with the PROXY protocol (see below). Breaks connections to a plain Mumble server |
| `MUMH5_STUN_PORT`, `MUMH5_STUN_BIND` | `3478`, all addresses | Port for screen sharing between browser users: STUN over UDP, and the relay over UDP and TCP. Browsers reach it directly, not through nginx. `0` turns both off |
| `MUMH5_TURN` | on | The relay (TURN) for people who cannot connect directly: mobile networks, strict company networks, browsers that forbid direct UDP such as Vanadium. `0` leaves only STUN |
| `MUMH5_TURN_PORTS` | `49160-49659` | UDP ports the relayed streams use, one per relayed route |
| `MUMH5_TURN_URLS` | none | Extra relay addresses handed to clients, comma-separated, for example `turns:turn.example.com:443?transport=tcp` when a TLS front forwards to port 3478. For networks that only let port 443 out |
| `MUMH5_DEBUG` | off | Log relay events (credentials handed out, routes granted or refused) |
| `MUMH5_TURN_MAX`, `MUMH5_TURN_PER_ADDRESS` | `500`, `64` | Relayed routes in total and per client address. A camera round uses several per person |
| `MUMH5_TURN_IP` | found automatically | The server's public address, announced for relayed streams. Set it when the server sits behind a 1:1 NAT, as on many cloud hosts |
| `MUMH5_STATIC` | `../dist-web` | Folder with the web build |
| `MUMH5_MAX_CONNECTIONS`, `MUMH5_MAX_PER_ADDRESS` | `200`, `8` | Connection limits, in total and per client address |
| `MUMH5_MAX_AUDIO_PACK_MB` | `32` | Maximum imported sound-pack ZIP size, in MiB |
| `MUMH5_MAX_AUDIO_FILE_MB` | `4` | Maximum individual sound clip size, in MiB |
| `MUMH5_MAX_AUDIO_UNPACKED_MB` | `64` | Maximum total unpacked WAV audio in a sound pack, in MiB |

Sound-pack limits are runtime settings: for example, set `MUMH5_MAX_AUDIO_PACK_MB=128`,
`MUMH5_MAX_AUDIO_FILE_MB=16` and `MUMH5_MAX_AUDIO_UNPACKED_MB=256` in the Docker
container's environment, then recreate the container and reload the browser page.
Values must be positive whole numbers of MiB; empty values use the defaults.
The proxy sends the limits to the browser through `/api/config`. Imports and saved
packs use these limits locally in the browser; sound packs are not uploaded to the
proxy or the Mumble server. Nginx's request-body limit does not affect them.
Desktop imports keep the defaults. The 512-entry archive limit and WAV/path checks
still apply. Larger limits increase the browser memory needed to import a pack.

## HTTPS reverse proxy

Example for nginx. `Host` must be passed on unchanged, because the proxy only accepts requests whose origin matches it. `X-Forwarded-For` carries the visitor's address; start the proxy with `MUMH5_TRUST_PROXY=1` so its per-address limits use it.

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
    listen 443 ssl;
    server_name voice.example.com;
    # ssl_certificate and ssl_certificate_key go here

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
        proxy_buffering off;
    }
}
```

## Client IP addresses

By default the Mumble server sees every browser user coming from the proxy's address, and that is the address other people and admins get in a user's information. No nginx setting changes that. Bans by IP on the Mumble server would then hit all users of the proxy; ban by certificate instead. In your own information mumh5 shows the address the proxy saw for you, next to the one the server sees.

## Showing the Mumble server the visitor's real address

Mumble does not understand the PROXY protocol ([mumble#4769](https://github.com/mumble-voip/mumble/issues/4769)), so the only way is to make the connection to it really come from the visitor's address. [go-mmproxy](https://github.com/path-network/go-mmproxy) does this on Linux: it accepts a connection that starts with a PROXY line and opens the connection to the server with that address as the source. It has to run on the same machine as the Mumble server, as root or with `CAP_NET_ADMIN`, with routing rules that send the server's replies back to it:

```bash
# on the Mumble server's machine
ip rule add from 127.0.0.1/8 iif lo table 123
ip route add local 0.0.0.0/0 dev lo table 123
ip -6 rule add from ::1/128 iif lo table 123
ip -6 route add local ::/0 dev lo table 123
go-mmproxy -l 127.0.0.1:64750 -4 127.0.0.1:64738 -6 "[::1]:64738"

# the mumh5 proxy then connects to go-mmproxy instead of Mumble
MUMH5_SEND_PROXY=1 MUMH5_TRUST_PROXY=1 MUMH5_SERVERS="127.0.0.1:64750=My server" node dist-proxy/proxy.mjs
```

The routing rules and options are go-mmproxy's; check its README for your system. mumh5's side (sending the PROXY line) is covered by tests, the go-mmproxy setup itself has not been tested with mumh5. People on the desktop client keep connecting to Mumble directly.

## Differences from the desktop app

What is different from the desktop app:

- **The proxy is trusted.** Your certificate and its private key are kept in the browser's storage and sent to the proxy on every connect, and everything you send, including the server password, passes through it. Whoever runs the proxy could act as you. Use a proxy you run yourself or trust.
- **Voice goes over TCP.** Browsers have no UDP sockets, so voice uses Mumble's TCP tunnel through the proxy. It works, with more delay on lossy connections.
- **Clearing the browser's data removes your identity.** Download a backup; the same `.p12` file works in the desktop app and in Mumble.
- **Not available:** the public server browser, link previews fetched by your own computer, the tray icon, importing the desktop Mumble certificate automatically.
- Voice uses the browser's own audio codec where there is one, and a built-in one otherwise (Firefox on Android). Both are tested in Chromium only.

