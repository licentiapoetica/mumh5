<script lang="ts">
  import Modal from './Modal.svelte';
  import { session } from '../lib/session.svelte.ts';

  const p = $derived(session.certPrompt!);
</script>

<Modal title="Server certificate changed" onclose={() => (session.certPrompt = null)} width={520}>
  <p>The certificate of <strong>{p.hostPort}</strong> is different from the one it had before. This happens when a server is reinstalled, but it can also mean someone is intercepting the connection. Your password has not been sent.</p>
  <p class="k">Previous</p><code>{p.previous}</code>
  <p class="k">Now</p><code>{p.fingerprint}</code>
  {#snippet footer()}
    <button class="btn" onclick={() => (session.certPrompt = null)}>Cancel</button>
    <button class="btn danger" onclick={() => session.acceptCertificate()}>Trust new certificate</button>
  {/snippet}
</Modal>

<style>
  p { color: var(--text-dim); }
  .k { margin: 12px 0 4px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
  code { display: block; padding: 8px; background: var(--bg-0); font: 12px var(--mono); overflow-wrap: anywhere; }
</style>
