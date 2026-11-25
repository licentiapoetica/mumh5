import wasmUrl from '../../../vendor/deepfilternet/df.wasm?url';
// Upstream's DeepFilterNet3_onnx.tar.gz. Not named .gz: servers then mark it as compressed and
// the browser unpacks it before the engine, which expects the archive, gets it.
import modelUrl from '../../../vendor/deepfilternet/DeepFilterNet3_onnx.bin?url';

export interface DeepFilterAssets { module: WebAssembly.Module; model: ArrayBuffer }

const bytes = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.arrayBuffer();
});

// Large, so fetched only when the strong filter is in use, and compiled here because a worklet
// may not block on it. The compiled module is kept (the worklet shares its code); the model's 8 MB
// are copied into the worklet, so this page does not hold on to them.
let compiling: Promise<WebAssembly.Module> | null = null;
export function loadDeepFilter(): Promise<DeepFilterAssets> {
  const module = compiling ??= bytes(wasmUrl).then(b => WebAssembly.compile(b))
    .catch(e => { compiling = null; throw e; });
  return Promise.all([module, bytes(modelUrl)]).then(([module, model]) => ({ module, model }));
}
