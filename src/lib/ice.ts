import { isWeb } from './native.ts';
import { proxyIce, relayIce } from './web.svelte.ts';
import { store } from './settings.svelte.ts';

/** The STUN and relay servers for WebRTC links (screen sharing, direct files), from Settings. */
export async function iceServers(direct = false): Promise<RTCIceServer[]> {
  const stun = store.settings.stunServer.trim();
  const chosen: RTCIceServer[] = stun ? [{ urls: /^stuns?:/.test(stun) ? stun : `stun:${stun}` }] : [];
  if (direct) return chosen;
  // A mumh5 proxy adds its STUN and its relay, which takes over by itself when no direct
  // connection comes up (mobile and company networks, browsers that forbid direct UDP). The
  // browser build has the proxy it is served from; the desktop app the one set in Settings.
  const relay = store.settings.relayServer.trim();
  return [...chosen, ...(relay ? await relayIce(relay) : isWeb ? await proxyIce() : [])];
}

/** Candidates travel inside the description, so wait for them instead of sending each one. */
export function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const timer = setTimeout(done, 3000);
    pc.addEventListener('icegatheringstatechange', check);
  });
}
