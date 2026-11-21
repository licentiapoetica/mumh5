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
// may not block on it
let loading: Promise<DeepFilterAssets> | null = null;
export function loadDeepFilter(): Promise<DeepFilterAssets> {
  return loading ??= Promise.all([bytes(wasmUrl).then(b => WebAssembly.compile(b)), bytes(modelUrl)])
    .then(([module, model]) => ({ module, model }))
    .catch(e => { loading = null; throw e; });
}
