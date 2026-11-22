<script lang="ts">
  import { tick } from 'svelte';
  import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
  import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

  let { url, name }: { url: string; name: string } = $props();
  let canvas = $state<HTMLCanvasElement>();
  let pages = $state(0);
  let failed = $state(false);
  let loading = $state(true);

  $effect(() => {
    const src = url, target = canvas;
    if (!target) return;
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    let render: RenderTask | undefined;
    const controller = new AbortController();
    pages = 0;
    loading = true;
    failed = false;
    void (async () => {
      try {
        const [pdfjs, response] = await Promise.all([import('pdfjs-dist'), fetch(src, { signal: controller.signal })]);
        if (cancelled) return;
        if (!response.ok) throw new Error('Could not read PDF');
        const data = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        // Render pixels only: no document scripts, links or external resource URLs.
        task = pdfjs.getDocument({ data, useWorkerFetch: false, useSystemFonts: true, useWasm: false, maxImageSize: 16_000_000 });
        const doc = await task.promise;
        if (cancelled) return;
        const page = await doc.getPage(1);
        if (cancelled) return;
        const original = page.getViewport({ scale: 1 });
        const scale = Math.min(500 / original.width, 300 / original.height);
        const viewport = page.getViewport({ scale: scale * Math.min(window.devicePixelRatio || 1, 2) });
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        target.style.width = `${original.width * scale}px`;
        render = page.render({ canvas: target, viewport });
        await render.promise;
        if (!cancelled) {
          pages = doc.numPages;
          loading = false;
          await tick();
          if (!cancelled) target.dispatchEvent(new Event('load'));
        }
        await task.destroy();
        task = undefined;
      } catch {
        if (!cancelled) { failed = true; loading = false; }
        void task?.destroy().catch(() => {});
        task = undefined;
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      render?.cancel();
      void task?.destroy().catch(() => {});
    };
  });
</script>

<div class="pdf-preview" aria-busy={loading}>
  <canvas bind:this={canvas} hidden={loading || failed} aria-label="First page of {name}"></canvas>
  <p role="status">{loading ? 'Loading PDF preview...' : failed ? 'Preview unavailable. Download to open this PDF.' : `Page 1 of ${pages}`}</p>
</div>

<style>
  .pdf-preview { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px; background: var(--bg-0); border-top: 1px solid var(--line); }
  canvas { display: block; max-width: 100%; height: auto; }
  canvas[hidden] { display: none; }
  p { margin: 0; font-size: 12px; color: var(--text-dim); }
</style>
