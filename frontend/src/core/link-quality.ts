// How the connection to the server is doing, measured from the answers to our pings.
// The wave in the server header draws this, so its numbers have to stay real measurements.

const RTT_GAIN = 1 / 3;
// Recovers faster than it rises, so the wave settles soon after a bad moment
const RTT_FALL_GAIN = 0.7;
const JITTER_GAIN = 1 / 4;
// Answers this late were held up by a stall, which the wave already shows; they count as this
// much at most and not as jitter
const BACKLOG_MS = 1000;
// A ping unanswered for this long counts as trouble; the wave is flat after the fade
const STALL_AFTER_MS = 3000;
const STALL_FADE_MS = 6000;
const SLOW_RTT_MS = 250;
const UNEVEN_JITTER_MS = 60;
const FAST_RTT_MS = 50;
const HEAVY_RTT_MS = 500;
const MIN_FLOW = 0.3;
const ROUGH_JITTER_MS = 80;

export type LinkTone = 'good' | 'slow' | 'stalled';

export interface LinkReading {
  rtt: number;       // smoothed round trip, ms
  jitter: number;    // smoothed change between round trips, ms
  answers: number;   // pings answered so far
  waited: number;    // how long the oldest open ping has been waiting, ms
  tone: LinkTone;
  flow: number;      // wave speed, 1 on a fast link down to MIN_FLOW
  rough: number;     // ripple, 0 on a steady link to 1
  level: number;     // wave height and brightness, 1 until pings stop being answered, then 0
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export class LinkMeter {
  rtt = 0;
  jitter = 0;
  answers = 0;
  private lastRtt = -1;
  // Send times of open pings, oldest first (TCP answers them in order)
  private open: number[] = [];

  sent(at: number): void {
    this.open.push(at);
  }

  answered(rtt: number, sentAt: number): void {
    this.open = this.open.filter(at => at > sentAt);
    // The system clock moved between the ping and its answer
    if (rtt < 0) return;
    const sample = Math.min(rtt, BACKLOG_MS);
    if (this.lastRtt < 0) this.rtt = sample;
    else {
      this.rtt += (sample - this.rtt) * (sample < this.rtt ? RTT_FALL_GAIN : RTT_GAIN);
      if (sample < BACKLOG_MS && this.lastRtt < BACKLOG_MS) {
        this.jitter += (Math.abs(sample - this.lastRtt) - this.jitter) * JITTER_GAIN;
      }
    }
    this.lastRtt = sample;
    this.answers++;
  }

  read(now: number): LinkReading {
    const waited = this.open.length ? Math.max(0, now - this.open[0]) : 0;
    const stalled = clamp01((waited - STALL_AFTER_MS) / STALL_FADE_MS);
    const tone: LinkTone = waited > STALL_AFTER_MS ? 'stalled'
      : this.rtt >= SLOW_RTT_MS || this.jitter >= UNEVEN_JITTER_MS ? 'slow' : 'good';
    return {
      rtt: this.rtt, jitter: this.jitter, answers: this.answers, waited, tone,
      flow: 1 - (1 - MIN_FLOW) * clamp01((this.rtt - FAST_RTT_MS) / (HEAVY_RTT_MS - FAST_RTT_MS)),
      rough: clamp01(this.jitter / ROUGH_JITTER_MS),
      level: 1 - stalled
    };
  }
}

// The tooltip on the connection status
export function describeLink(r: LinkReading | undefined): string {
  if (!r) return '';
  if (r.tone === 'stalled') return `No answer from the server for ${Math.round(r.waited / 1000)} s`;
  if (!r.answers) return 'Measuring the connection';
  const numbers = `${Math.round(r.rtt)} ms, varies by ${Math.round(r.jitter)} ms`;
  return `${r.tone === 'slow' ? 'Slow or uneven' : 'Stable'}: ${numbers}`;
}
