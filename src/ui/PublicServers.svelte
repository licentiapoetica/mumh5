<script lang="ts">
  import { onDestroy } from 'svelte';
  import Modal from './Modal.svelte';
  import { native, type PublicServer, type PingResult } from '../lib/native.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';

  let { onclose }: { onclose: () => void } = $props();

  let servers = $state<PublicServer[]>([]);
  let loading = $state(true);
  let error = $state('');
  let search = $state('');
  let continent = $state('');
  let sort = $state<'users' | 'ping' | 'name' | 'country'>('users');
  let pings = $state<Record<string, PingResult | null>>({});
  let alive = true;
  // Ping queue; the generation drops answers from a previous list
  let queue: PublicServer[] = [];
  let running = 0;
  let generation = 0;
  onDestroy(() => { alive = false; });

  const key = (s: PublicServer) => `${s.host}:${s.port}`;
  const CONTINENTS: Record<string, string> = { eu: 'Europe', na: 'North America', sa: 'South America', as: 'Asia', oc: 'Oceania', af: 'Africa', an: 'Antarctica' };

  async function load() {
    // A new list starts a new ping round; answers from the previous round are dropped
    generation++;
    queue = [];
    running = 0;
    loading = true;
    error = '';
    try {
      servers = (await native?.publicServers(store.settings.publicListUrl)) ?? [];
      if (!native) error = 'The public list needs the desktop app.';
    } catch (e) {
      error = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    }
    loading = false;
    pingVisible();
  }
  load();

  const shown = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const list = servers.filter(s => (!continent || s.continent === continent) &&
      (!q || s.name.toLowerCase().includes(q) || s.country.toLowerCase().includes(q) || s.host.toLowerCase().includes(q)));
    const p = (s: PublicServer) => pings[key(s)];
    return list.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'country') return a.country.localeCompare(b.country) || a.name.localeCompare(b.name);
      if (sort === 'ping') return (p(a)?.ping ?? 1e9) - (p(b)?.ping ?? 1e9);
      return (p(b)?.users ?? -1) - (p(a)?.users ?? -1);
    }).slice(0, 300);
  });

  // Ping what the filter shows, a few at a time; each answer fills in users and latency
  function pingVisible() {
    queue = servers.filter(s => !(key(s) in pings));
    for (let i = running; i < 16; i++) next();
  }
  function next() {
    const s = queue.shift();
    if (!s || !alive || !native) return;
    const round = generation;
    running++;
    pings[key(s)] = null;
    native.pingServer(s.host, s.port).then(r => {
      if (!alive || round !== generation) return;
      pings[key(s)] = r;
      running--;
      next();
    });
  }

  function add(s: PublicServer) {
    ui.addServer = { host: s.host, port: s.port, label: s.name };
    onclose();
  }

  function changeSource() {
    ui.prompt = {
      title: 'Public list address', label: 'URL', confirm: 'Use this list', initial: store.settings.publicListUrl,
      text: 'The official list is publist.mumble.info. Any server returning the same XML format works.',
      onsubmit: v => {
        store.settings.publicListUrl = v.trim() || 'https://publist.mumble.info/v1/list?version=1.5.0';
        store.saveSettings();
        pings = {};
        load();
      }
    };
  }
</script>

<Modal title="Public servers" {onclose} width={900}>
  <div class="bar">
    <input bind:value={search} placeholder="Search by name, country or address" aria-label="Search servers" />
    <select bind:value={continent} aria-label="Continent">
      <option value="">All continents</option>
      {#each Object.entries(CONTINENTS) as [code, name] (code)}<option value={code}>{name}</option>{/each}
    </select>
    <select bind:value={sort} aria-label="Sort by">
      <option value="users">Most people</option>
      <option value="ping">Lowest ping</option>
      <option value="name">Name</option>
      <option value="country">Country</option>
    </select>
  </div>

  {#if loading}
    <p class="dim">Loading the public server list...</p>
  {:else if error}
    <p class="error">Could not load the list: {error}</p>
    <div class="row"><button class="btn" onclick={load}>Try again</button><button class="btn" onclick={changeSource}>Use another list...</button></div>
  {:else}
    <table>
      <thead><tr><th>Server</th><th>Country</th><th class="num">People</th><th class="num">Ping</th><th></th></tr></thead>
      <tbody>
        {#each shown as s (key(s))}
          {@const p = pings[key(s)]}
          <tr>
            <td class="name">
              <span class="title" title={s.name}>{s.name}</span>
              <span class="addr">{s.host}{s.port !== 64738 ? `:${s.port}` : ''}</span>
              {#if s.url}<a class="site" href={s.url} target="_blank" rel="noopener noreferrer">website</a>{/if}
            </td>
            <td>{s.country}</td>
            <td class="num">{p ? `${p.users} / ${p.maxUsers}` : key(s) in pings && p === null ? '...' : ''}</td>
            <td class="num" class:good={p && p.ping < 60} class:bad={p && p.ping > 180}>{p ? `${Math.round(p.ping)} ms` : ''}</td>
            <td class="act"><button class="btn" onclick={() => add(s)}>Add</button></td>
          </tr>
        {:else}
          <tr><td colspan="5" class="dim">No servers match.</td></tr>
        {/each}
      </tbody>
    </table>
    <p class="dim small">{servers.length} servers listed{shown.length < servers.length ? `, ${shown.length} shown` : ''}. Pinging lets each server see your IP address, like in the desktop client.</p>
  {/if}

  {#snippet footer()}
    <button class="link" onclick={changeSource}>List source: {(() => { try { return new URL(store.settings.publicListUrl).host; } catch { return store.settings.publicListUrl; } })()}</button>
    <span class="grow"></span>
    <button class="btn primary" onclick={onclose}>Close</button>
  {/snippet}
</Modal>

<style>
  .bar { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .bar input { flex: 1 1 240px; }
  .bar select { width: auto; flex: 0 0 auto; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
  th { text-align: left; font-size: 12px; color: var(--text-faint); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg-1); }
  td { padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  tr:hover td { background: var(--bg-hover); }
  .name { max-width: 360px; }
  .title { display: block; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .addr { font-size: 12px; color: var(--text-faint); }
  .site { font-size: 12px; margin-left: 8px; }
  .num { text-align: right; white-space: nowrap; }
  .good { color: var(--speaking); }
  .bad { color: var(--warn); }
  .act { width: 1%; }
  .act .btn { padding: 4px 12px; font-size: 13px; }
  .dim { color: var(--text-dim); }
  .small { font-size: 12px; margin-top: 10px; }
  .error { color: var(--danger); }
  .row { display: flex; gap: 8px; }
  .link { color: var(--link); font-size: 13px; }
  .grow { flex: 1; }
  @media (max-width: 640px) { th:nth-child(2), td:nth-child(2) { display: none; } }
</style>
