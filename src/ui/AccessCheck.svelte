<script lang="ts">
  import Icon from './Icon.svelte';
  import { session } from '../lib/session.svelte.ts';
  import { PERM, type AclEntry } from '../core/client.ts';
  import { PERMISSION_GROUPS, explain, type AccessLevel, type Person } from '../core/access.ts';

  let { levels, isRoot, dirty, ruleLabel }: {
    levels: AccessLevel[] | null;
    isRoot: boolean;
    dirty: boolean;
    ruleLabel: (r: AclEntry) => string;
  } = $props();

  const VERBS: Record<number, string> = {
    [PERM.Traverse]: 'pass through this channel', [PERM.Enter]: 'join this channel', [PERM.Speak]: 'speak here',
    [PERM.Whisper]: 'whisper to this channel', [PERM.TextMessage]: 'send messages here', [PERM.Listen]: 'listen to this channel',
    [PERM.MuteDeafen]: 'mute others here', [PERM.Move]: 'move people here', [PERM.Kick]: 'kick people', [PERM.Ban]: 'ban people',
    [PERM.ResetUserContent]: 'remove the content of others', [PERM.MakeChannel]: 'create channels here',
    [PERM.MakeTempChannel]: 'create temporary channels here', [PERM.LinkChannel]: 'link this channel',
    [PERM.Register]: 'register others', [PERM.SelfRegister]: 'register themselves', [PERM.Write]: 'administer this channel'
  };

  const users = $derived(session.allUsers());
  const mine = session.client?.self?.session ?? -1;
  let picked = $state(mine);
  let bit = $state<number>(PERM.Enter);

  const user = $derived(users.find(u => u.session === picked) ?? users[0]);
  const parents = (id: number) => session.channel(id)?.parent;
  const person = $derived<Person | null>(user ? {
    userId: user.userId, hash: user.hash, channelId: user.channelId,
    // Only your own tokens are known
    tokens: user.session === mine ? session.ownTokens() : undefined
  } : null);
  const result = $derived(levels && person ? explain(levels, person, bit, parents) : null);

  const headline = $derived.by(() => {
    if (!result || !user) return '';
    const word = result.verdict === 'allowed' ? 'can' : result.verdict === 'denied' ? 'cannot' : 'may be able to';
    return `${user.name} ${word} ${VERBS[bit]}`;
  });

  const reason = $derived.by(() => {
    const r = result;
    if (!r) return '';
    if (r.superUser) return 'SuperUser can do everything except speak and whisper.';
    if (r.verdict === 'depends') return r.steps.length ? 'It depends on a password, access token or certificate that clients cannot see.' : 'Not enough is known to answer this.';
    if (r.blockedAt) return `They cannot pass through ${r.blockedAt}.`;
    if (r.byBan) return 'Anyone who can ban can also kick.';
    if (r.byAdministrator) return 'Administrator overrides the rules that deny this.';
    const decides = r.steps.find(s => s.decides);
    if (decides) return `Decided by ${ruleLabel(decides.rule)} in ${decides.channel}.`;
    return r.verdict === 'allowed' ? 'Allowed by default.' : 'No rule allows this.';
  });
</script>

<div class="picks">
  <div>
    <label for="check-who">Person</label>
    <select id="check-who" bind:value={picked}>
      {#each users as u (u.session)}<option value={u.session}>{u.name}{u.session === mine ? ' (you)' : ''}</option>{/each}
    </select>
  </div>
  <div>
    <label for="check-what">Action</label>
    <select id="check-what" bind:value={bit}>
      {#each PERMISSION_GROUPS as g (g.name)}
        <optgroup label={g.name}>
          {#each g.items as p (p.bit)}<option value={p.bit}>{p.name}{p.rootOnly && !isRoot ? ' (server)' : ''}</option>{/each}
        </optgroup>
      {/each}
    </select>
  </div>
</div>

{#if !levels}
  <p class="dim">Loading rules...</p>
{:else if result}
  <div class="answer {result.verdict}" role="status">
    <span class="mark"><Icon name={result.verdict === 'allowed' ? 'check' : result.verdict === 'denied' ? 'x' : 'info'} size={18} /></span>
    <div><strong>{headline}</strong><p>{reason}</p></div>
  </div>
  {#if result.steps.length}
    <h4>Rules, in the order the server applies them</h4>
    <ol>
      {#each result.steps as s, i (i)}
        <li class:decides={s.decides}>
          <span class="effect {s.effect}"><Icon name={s.effect === 'allow' ? 'check' : 'x'} size={13} /></span>
          <span class="who">{ruleLabel(s.rule)}</span>
          <span class="where">{s.channel}</span>
          <span class="tag">{s.uncertain ? 'If they have it' : s.decides ? 'Decides' : s.effect === 'allow' ? 'Allows' : 'Denies'}</span>
        </li>
      {/each}
    </ol>
  {/if}
  {#if result.incomplete}<p class="dim small">Some parent channels cannot be read with your rights, so this may be incomplete.</p>{/if}
  {#if dirty}<p class="dim small">Includes your unsaved changes.</p>{/if}
{/if}

<style>
  .picks { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .answer { display: flex; align-items: center; gap: 12px; margin-top: 16px; padding: 12px; background: var(--bg-2); border: 1px solid var(--line); }
  .mark { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; background: var(--bg-3); color: var(--text-dim); }
  .allowed .mark { background: color-mix(in srgb, var(--speaking) 30%, var(--bg-1)); color: var(--text); }
  .denied .mark { background: color-mix(in srgb, var(--danger) 32%, var(--bg-1)); color: var(--text); }
  .depends .mark { background: color-mix(in srgb, var(--warn) 28%, var(--bg-1)); color: var(--text); }
  strong { font-size: 15px; font-weight: 650; }
  .answer p { margin: 2px 0 0; font-size: 13px; color: var(--text-dim); }
  h4 { margin: 16px 0 6px; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-dim); }
  ol { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); }
  li { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 4px 10px; font-size: 13px; }
  li + li { border-top: 1px solid var(--line); }
  li.decides { background: var(--bg-3); }
  .effect { flex: none; display: inline-flex; }
  .effect.allow { color: var(--speaking); }
  .effect.deny { color: var(--danger); }
  .who { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .where { flex: none; max-width: 40%; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { flex: none; width: 92px; text-align: right; font-size: 12px; font-weight: 600; color: var(--text-dim); }
  .decides .tag { color: var(--text); }
  .dim { color: var(--text-dim); }
  .small { margin: 8px 0 0; font-size: 12px; }
</style>
