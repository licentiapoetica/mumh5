<script lang="ts">
  import { onDestroy } from 'svelte';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { native, type PublicServer, type PingResult } from '../lib/native.ts';
  import { store } from '../lib/settings.svelte.ts';
  import { ui } from '../lib/ui.svelte.ts';
  import { sessions } from '../lib/session.svelte.ts';

  let { onclose }: { onclose: () => void } = $props();

  let servers = $state<PublicServer[]>([]);
  let loading = $state(true);
  let error = $state('');
  let search = $state('');
  let continent = $state('');
  type Sort = 'users' | 'ping' | 'name' | 'country';
  let sort = $state<Sort>('users');
  // Each column has a natural order (most people, lowest ping, A to Z); a second click flips it
  let reversed = $state(false);
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
    // and a list that arrives after the source changed is ignored
    const round = ++generation;
    queue = [];
    running = 0;
    loading = true;
    error = '';
    let list: PublicServer[] = [];
    let failed = '';
    try {
      list = (await native?.publicServers(store.settings.publicListUrl)) ?? [];
      if (!native) failed = 'The public list needs the desktop app.';
    } catch (e) {
      failed = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    }
    if (round !== generation || !alive) return;
    servers = list;
    error = failed;
    loading = false;
    pingVisible();
  }
  load();

  const shown = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const list = servers.filter(s => (!continent || s.continent === continent) &&
      (!q || s.name.toLowerCase().includes(q) || s.country.toLowerCase().includes(q) || s.host.toLowerCase().includes(q)));
    const p = (s: PublicServer) => pings[key(s)];
    const dir = reversed ? -1 : 1;
    return list.sort((a, b) => {
      if (sort === 'name') return dir * a.name.localeCompare(b.name);
      if (sort === 'country') return dir * a.country.localeCompare(b.country) || a.name.localeCompare(b.name);
      // Servers that have not answered stay at the bottom in both directions
      const pa = p(a), pb = p(b);
      if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
      return dir * (sort === 'ping' ? pa.ping - pb.ping : pb.users - pa.users);
    }).slice(0, 300);
  });

  function sortBy(col: Sort) {
    reversed = sort === col && !reversed;
    sort = col;
  }
  // Most people first counts as descending, the other columns start ascending
  const ariaSort = (col: Sort) => sort !== col ? 'none' : reversed === (col === 'users') ? 'ascending' : 'descending';

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

  // Connects right away with the name used last; the server is saved so it shows in the rail.
  // Without a name to reuse, the add dialog asks for one.
  function connect(s: PublicServer) {
    const saved = store.servers.find(x => x.host === s.host && x.port === s.port);
    const username = store.servers.at(-1)?.username;
    if (!saved && !username) return add(s);
    const server = saved ?? { id: crypto.randomUUID(), label: s.name || s.host, host: s.host, port: s.port, username: username!, password: '' };
    if (!saved) store.upsertServer(server);
    sessions.open(server);
    onclose();
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
    <select bind:value={sort} onchange={() => (reversed = false)} aria-label="Sort by">
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
      <thead><tr>
        {#each [['name', 'Server'], ['country', 'Country'], ['users', 'People'], ['ping', 'Ping']] as const as [col, text] (col)}
          <th class:num={col === 'users' || col === 'ping'} aria-sort={ariaSort(col)}>
            <button class="sort" class:on={sort === col} title="Sort by {text.toLowerCase()}" onclick={() => sortBy(col)}>{text}<span class="caret" class:up={ariaSort(col) === 'ascending'}></span></button>
          </th>
        {/each}
        <th></th>
      </tr></thead>
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
            <td class="act">
              <span class="acts">
                <button class="icon-btn" title="Add to your servers" aria-label="Add" onclick={() => add(s)}><Icon name="plus" size={18} /></button>
                <button class="icon-btn go" title="Connect" aria-label="Connect" onclick={() => connect(s)}><Icon name="arrow-right" size={18} /></button>
              </span>
            </td>
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
  .sort { font: inherit; color: inherit; display: inline-flex; align-items: center; gap: 6px; }
  .sort:hover, .sort.on { color: var(--text); }
  /* Triangle from borders; only the active column shows it */
  .caret { border: 4px solid transparent; border-top-color: currentColor; margin-top: 4px; visibility: hidden; }
  .caret.up { border-top-color: transparent; border-bottom-color: currentColor; margin-top: -4px; }
  .sort.on .caret { visibility: visible; }
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
  .acts { display: flex; gap: 4px; }
  .go, .go:hover { color: var(--speaking); }
  .dim { color: var(--text-dim); }
  .small { font-size: 12px; margin-top: 10px; }
  .error { color: var(--danger); }
  .row { display: flex; gap: 8px; }
  .link { color: var(--link); font-size: 13px; }
  .grow { flex: 1; }
  @media (max-width: 640px) { th:nth-child(2), td:nth-child(2) { display: none; } }
</style>
