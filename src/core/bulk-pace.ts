// How fast a bulk message (a file piece, a few hundred KB) is written to the connection.
// Written all at once, a piece fills the queue in front of a home uplink, and the pings, chat
// and voice sharing that uplink wait behind it (measured on a 10 Mbit/s uplink: pings and
// voice up to 900 ms late). Written at a pace the uplink keeps up with, the queue stays short.
//
// The pace follows the ping sent right after each piece. Its round trip beyond the link's usual
// one is the queue the piece left behind; from that and how fast the piece was written follows
// what the uplink carries. Below the target the pace rises, quickly until the first queue, then
// slowly, so it keeps near what the link carries without filling its queue again.

const START_RATE = 512 * 1024;
export const MIN_RATE = 64 * 1024;
// Past this, the server's message limit decides the transfer's speed anyway
export const MAX_RATE = 8 * 1024 * 1024;
// Queue a piece may leave behind before the pace drops
const TARGET_MS = 50;
const SHARE = 0.85;
// Round trips with nothing of ours ahead, to know the usual one
const CLEAN_KEPT = 8;

export class BulkPace {
  rate = START_RATE;
  private clean: number[] = [];
  private probing = true;

  // A round trip with no bulk in front of it
  idle(rtt: number): void {
    if (rtt < 0) return;
    this.clean.push(rtt);
    if (this.clean.length > CLEAN_KEPT) this.clean.shift();
  }

  get base(): number {
    return this.clean.length ? Math.min(...this.clean) : -1;
  }

  // The round trip of the ping that followed `bytes` written at `rate` bytes per second
  after(rtt: number, bytes: number, rate: number): void {
    const base = this.base;
    if (base < 0 || rtt < 0 || bytes <= 0) return;
    const queued = rtt - base;
    if (queued > TARGET_MS) {
      // The uplink took (write time + queue) for the piece
      const carried = bytes / (bytes / rate + queued / 1000);
      this.rate = Math.min(this.rate, Math.max(MIN_RATE, carried * SHARE));
      this.probing = false;
    } else {
      this.rate = Math.min(MAX_RATE, Math.max(this.rate, rate) * (this.probing ? 1.5 : 1.1));
    }
  }
}
