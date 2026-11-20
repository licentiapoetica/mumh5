<script lang="ts">
  import Modal from './Modal.svelte';
  import { ui, type Poke } from '../lib/ui.svelte.ts';
  import { session, sessions } from '../lib/session.svelte.ts';

  const close = () => (ui.pokes = []);
  // Several servers open: say which one each poke came from
  const many = $derived(new Set(sessions.list.map(s => s.server?.id)).size > 1);
  const title = $derived(ui.pokes.length === 1 ? `${ui.pokes[0].name} poked you` : `${ui.pokes.length} pokes`);
  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  function reply(p: Poke): void {
    const s = sessions.byServer(p.server);
    if (!s || s.status !== 'connected' || !s.client?.users.has(p.from)) return;
    sessions.select(p.server);
    session.selectView(`dm:${p.from}`);
    close();
  }
  const canReply = (p: Poke) => {
    const s = sessions.byServer(p.server);
    void s?.tick;
    return !!s && s.status === 'connected' && !!s.client?.users.has(p.from);
  };
</script>

<Modal {title} onclose={close} width={420}>
  <ul class="pokes">
    {#each ui.pokes as p (p.id)}
      <li class="poke">
        <div class="head">
          <span class="who">{p.name}</span>
          <span class="meta">{many && p.serverName ? `${p.serverName}, ` : ''}{time(p.time)}</span>
          <button class="btn" onclick={() => reply(p)} disabled={!canReply(p)} title={canReply(p) ? 'Open a private conversation' : 'No longer on the server'}>Reply</button>
        </div>
        {#if p.note}<p class="note">{p.note}</p>{/if}
      </li>
    {/each}
  </ul>
  {#snippet footer()}
    <button class="btn primary" onclick={close}>OK</button>
  {/snippet}
</Modal>

<style>
  .pokes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .poke { padding: 10px 0; border-bottom: 1px solid var(--line); }
  .poke:last-child { border-bottom: none; }
  .head { display: flex; align-items: center; gap: 10px; }
  .who { font-weight: 650; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { flex: 1; color: var(--text-dim); font-size: 12px; white-space: nowrap; }
  .head .btn { padding-block: 3px; }
  .note { margin: 6px 0 0; font-size: 15px; overflow-wrap: anywhere; white-space: pre-wrap; }
</style>
