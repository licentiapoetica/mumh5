<script lang="ts">
  import { desktop } from '../lib/native.ts';
  import { session } from '../lib/session.svelte.ts';
  import type { LinkTone } from '../core/link-quality.ts';

  // Slow translucent ribbons that draw the live connection (src/core/link-quality.ts). It only
  // changes the wave's own motion: latency sets the speed, jitter makes the shape choppier, and
  // when answers stop the wave flattens and turns red.
  // The parent needs position: relative and isolation: isolate; the canvas sits under its content.

  // y, a, b are fractions of the bar height. The two edges of a ribbon drift at different
  // speeds, so it twists where they cross. len is in CSS pixels: resizing reveals more wave
  // instead of stretching it.
  const RIBBONS = [
    { y: 0.58, a: 0.30, b: 0.20, len: 900, top: 0.035, bottom: -0.022, alpha: 0.22, phase: 0 },
    { y: 0.46, a: 0.24, b: 0.30, len: 640, top: -0.028, bottom: 0.041, alpha: 0.18, phase: 2.1 },
    { y: 0.70, a: 0.18, b: 0.26, len: 1180, top: 0.019, bottom: 0.031, alpha: 0.28, phase: 4.4 }
  ];
  const TONES: Record<LinkTone, string> = { good: 'var(--wave, var(--speaking))', slow: 'var(--warn)', stalled: 'var(--danger)' };
  const TAU = Math.PI * 2;
  const STEP_PX = 6;
  // The motion is far below a pixel per frame, so 30 fps looks the same as 60 at half the work
  const FRAME_MS = 1000 / 30;
  // With reduced motion the wave holds still and only its shape and color follow the link
  const CALM_FRAME_MS = 1000;
  const EASE_S = 3;

  function wave(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const calm = matchMedia('(prefers-reduced-motion: reduce)');
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0, shown = true;
    let clock = 12, flow = 1, rough = 0, level = 1, tone = '';
    let upper = new Float32Array(0), lower = new Float32Array(0);

    // Jitter strengthens the second harmonic the wave already has
    const edge = (x: number, k: number, amp: number, turn: number, phase: number) =>
      amp * (Math.sin(k * x + turn + phase) + (0.35 + 0.4 * rough) * Math.sin(1.9 * k * x - turn * 0.7 + phase * 2));

    // Moves the drawn values toward the measured ones, so a new reading never makes the wave jump
    function follow(dt: number) {
      const r = session.client?.link.read(Date.now());
      if (!r) return;
      const k = calm.matches || !tone ? 1 : 1 - Math.exp(-dt / EASE_S);
      flow += (r.flow - flow) * k;
      rough += (r.rough - rough) * k;
      level += (r.level - level) * k;
      if (!calm.matches) clock += dt * flow;
      if (r.tone !== tone) {
        tone = r.tone;
        canvas.dataset.tone = tone;
        canvas.style.color = TONES[r.tone];
      }
    }

    function draw() {
      const c = ctx!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      // Read every frame: the color eases through a CSS transition and follows the theme
      const css = getComputedStyle(canvas);
      c.fillStyle = c.strokeStyle = css.color;
      // A theme's wave brightness (custom-themes.ts), 1 when it has none
      const strength = parseFloat(css.getPropertyValue('--wave-strength')) || 1;
      c.lineWidth = 1;
      const count = Math.ceil(w / STEP_PX) + 1;
      if (upper.length !== count) { upper = new Float32Array(count); lower = new Float32Array(count); }
      const height = 0.12 + 0.88 * level;
      const bright = (0.35 + 0.65 * level) * strength;

      for (const r of RIBBONS) {
        const k = TAU / r.len;
        const turnUp = TAU * r.top * clock, turnDown = TAU * r.bottom * clock;
        for (let i = 0; i < count; i++) {
          const x = i * STEP_PX;
          upper[i] = h * (r.y + height * edge(x, k, r.a, turnUp, r.phase));
          lower[i] = h * (r.y + height * edge(x, k * 0.8, r.b, turnDown, r.phase + 1.4));
        }
        c.beginPath();
        for (let i = 0; i < count; i++) c.lineTo(i * STEP_PX, upper[i]);
        for (let i = count - 1; i >= 0; i--) c.lineTo(i * STEP_PX, lower[i]);
        c.closePath();
        c.globalAlpha = Math.min(1, r.alpha * bright);
        c.fill();
        c.globalAlpha = Math.min(1, r.alpha * 3 * bright);
        c.beginPath();
        for (let i = 0; i < count; i++) c.lineTo(i * STEP_PX, upper[i]);
        c.stroke();
      }
      c.globalAlpha = 1;
    }

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (now - last < (calm.matches ? CALM_FRAME_MS : FRAME_MS)) return;
      // Capped so the wave continues where it was after a pause
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      follow(dt);
      draw();
    }

    function update() {
      cancelAnimationFrame(raf);
      raf = 0;
      if (!w || !h || !shown || document.hidden) return;
      last = performance.now();
      follow(0);
      draw();
      raf = requestAnimationFrame(frame);
    }

    const size = new ResizeObserver(() => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      update();
    });
    size.observe(canvas);
    calm.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    // The desktop window never reports hidden to the page (background throttling is off for voice)
    const stopShown = desktop?.onWindowShown(v => { shown = v; update(); });

    return {
      destroy() {
        cancelAnimationFrame(raf);
        size.disconnect();
        calm.removeEventListener('change', update);
        document.removeEventListener('visibilitychange', update);
        stopShown?.();
      }
    };
  }
</script>

<canvas class="conn-wave" use:wave aria-hidden="true"></canvas>

<style>
  .conn-wave {
    position: absolute; inset: 0; z-index: -1; width: 100%; height: 100%; display: block; pointer-events: none;
    color: var(--wave, var(--speaking));
    transition: color 1800ms var(--ease);
    /* Quieter under the server name and the power button */
    mask-image: linear-gradient(90deg, rgb(0 0 0 / 0.45), #000 45%, #000 85%, rgb(0 0 0 / 0.5));
    animation: wave-in 1600ms var(--ease) both;
  }
  @keyframes wave-in { from { opacity: 0; } }
</style>
