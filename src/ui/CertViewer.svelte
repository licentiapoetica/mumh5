<script lang="ts">
  import Modal from './Modal.svelte';
  import type { CertDetails } from '../core/transport.ts';

  let { title, chain, status, onclose }:
    { title: string; chain: CertDetails[]; status?: { ok: boolean; text: string }; onclose: () => void } = $props();

  let index = $state(0);
  const cert = $derived(chain[index]);

  // "CN=foo\nO=bar" -> [["CN","foo"],["O","bar"]]
  const parts = (dn: string) => dn.split('\n').filter(Boolean).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  });
  const names: Record<string, string> = { CN: 'Common name', O: 'Organization', OU: 'Unit', C: 'Country', ST: 'State', L: 'Locality', emailAddress: 'Email' };
  const date = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const expired = $derived(cert ? new Date(cert.validTo) < new Date() : false);

  function copyPem() { navigator.clipboard.writeText(cert.pem); }
</script>

<Modal {title} {onclose} width={620}>
  {#if status}<p class="status" class:ok={status.ok}>{status.text}</p>{/if}
  {#if chain.length > 1}
    <div class="tabs" role="tablist">
      {#each chain as c, i (c.fingerprint256)}
        <button role="tab" aria-selected={i === index} class:active={i === index} onclick={() => (index = i)}>
          {parts(c.subject).find(p => p[0] === 'CN')?.[1] ?? `Certificate ${i + 1}`}
        </button>
      {/each}
    </div>
  {/if}
  {#if cert}
    <h3>Subject</h3>
    <dl>{#each parts(cert.subject) as [k, v] (k + v)}<dt>{names[k] ?? k}</dt><dd>{v}</dd>{/each}</dl>
    <h3>Issuer {#if cert.selfSigned}<span class="tag">self-signed</span>{/if}</h3>
    <dl>{#each parts(cert.issuer) as [k, v] (k + v)}<dt>{names[k] ?? k}</dt><dd>{v}</dd>{/each}</dl>
    <h3>Validity {#if expired}<span class="tag bad">expired</span>{/if}</h3>
    <dl>
      <dt>Not before</dt><dd>{date(cert.validFrom)}</dd>
      <dt>Not after</dt><dd>{date(cert.validTo)}</dd>
    </dl>
    <h3>Details</h3>
    <dl>
      <dt>Public key</dt><dd>{cert.keyType.toUpperCase()}{cert.keyBits ? ` ${cert.keyBits} bit` : ''}</dd>
      {#if cert.subjectAltName}<dt>Alt names</dt><dd>{cert.subjectAltName}</dd>{/if}
      <dt>Serial</dt><dd class="mono">{cert.serialNumber}</dd>
      <dt>SHA-1</dt><dd class="mono">{cert.fingerprint}</dd>
      <dt>SHA-256</dt><dd class="mono">{cert.fingerprint256}</dd>
    </dl>
  {/if}
  {#snippet footer()}
    <button class="btn" onclick={copyPem}>Copy PEM</button>
    <button class="btn primary" onclick={onclose}>Close</button>
  {/snippet}
</Modal>

<style>
  .status { margin: 8px 0 0; padding: 8px 10px; border-left: 3px solid var(--warn); background: var(--bg-0); font-size: 14px; }
  .status.ok { border-color: var(--speaking); }
  .tabs { display: flex; gap: 2px; margin-top: 12px; overflow-x: auto; }
  .tabs button { padding: 6px 12px; background: var(--bg-3); color: var(--text-dim); white-space: nowrap; font-size: 13px; }
  .tabs button.active { background: var(--accent); color: var(--accent-text); }
  h3 { margin: 18px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim); display: flex; align-items: center; gap: 8px; }
  .tag { text-transform: none; letter-spacing: 0; font-weight: 600; padding: 0 6px; border: 1px solid var(--warn); color: var(--warn); }
  .tag.bad { border-color: var(--danger); color: var(--danger); }
  dl { display: grid; grid-template-columns: 120px 1fr; gap: 4px 12px; margin: 0; font-size: 14px; }
  dt { color: var(--text-faint); }
  dd { margin: 0; overflow-wrap: anywhere; user-select: text; }
  .mono { font: 12px var(--mono); }
  @media (max-width: 500px) { dl { grid-template-columns: 1fr; } dt { margin-top: 6px; } }
</style>
