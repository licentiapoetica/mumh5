import wasmUrl from '@evan/opus/wasm/opus.wasm?url';
import { instantiateOpus, type Opus } from './opus-wasm.ts';

// Fetched once, and only in browsers that need it
let loading: Promise<Opus> | null = null;
export function loadOpus(): Promise<Opus> {
  return loading ??= fetch(wasmUrl).then(r => r.arrayBuffer()).then(instantiateOpus).catch(e => { loading = null; throw e; });
}
