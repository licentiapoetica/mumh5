<script lang="ts">
  import Icon from './Icon.svelte';
  import { ACCESS_PRESETS, ADMIN_TARGET, PERMISSION_GROUPS, VOICE_BITS, accessTargets, adminsSilenced, applyPreset, broadDenies, cellValue, inheritedValue, isBroadTarget, keepAdminVoice, presetOf, replacedByPreset, setCell, type AccessTarget, type Cell, type PermissionInfo } from '../core/access.ts';
  import { PERM, type ChannelAcl } from '../core/client.ts';

  let { acl, isRoot, label, resolve, onchange, onadvanced }: {
    acl: ChannelAcl;
    isRoot: boolean;
    label: (t: AccessTarget) => string;
    resolve: (name: string) => Promise<number | null>;
    onchange: (next: ChannelAcl) => void;
    onadvanced: () => void;
  } = $props();

  let category = $state(PERMISSION_GROUPS[0].name);
  let extra = $state<AccessTarget[]>([]);
  let undo = $state<{ acl: ChannelAcl; count: number } | null>(null);
  let person = $state('');
  let personError = $state('');

  const columns = $derived((PERMISSION_GROUPS.find(g => g.name === category) ?? PERMISSION_GROUPS[0]).items.filter(p => !p.rootOnly || isRoot));
  const targets = $derived.by(() => {
    const listed = accessTargets(acl);
    return [...listed, ...extra.filter(t => !listed.some(x => x.key === t.key))];
  });
  const active = $derived(presetOf(acl));
  // Quiet means nobody speaks, admins included
  const silenced = $derived(active === 'quiet' ? [] : adminsSilenced(acl));
  const silencedText = $derived(silenced.length === 2 ? 'speak or whisper' : silenced[0] === PERM.Speak ? 'speak' : 'whisper');
  // Allows the grid added for admins, removed again if the deny they offset goes away
  const addedForAdmins = new Set<number>();

  function pickPreset(id: string) {
    const count = replacedByPreset(acl, id);
    undo = count ? { acl, count } : null;
    onchange(applyPreset(acl, id));
  }

  function cycle(t: AccessTarget, p: PermissionInfo) {
    const now = cellValue(acl, t, p.bit);
    const next: Cell = now === null ? 'allow' : now === 'allow' ? 'deny' : null;
    undo = null;
    let out = setCell(acl, t, p.bit, next);
    if (t.key === ADMIN_TARGET.key) addedForAdmins.delete(p.bit);
    else if (isBroadTarget(t) && VOICE_BITS.includes(p.bit)) {
      if (next === 'deny' && adminsSilenced(out).includes(p.bit)) {
        out = keepAdminVoice(out, [p.bit]);
        addedForAdmins.add(p.bit);
      } else if (next !== 'deny' && addedForAdmins.has(p.bit) && !broadDenies(out, p.bit)) {
        // The allow was only there to offset this deny
        out = setCell(out, ADMIN_TARGET, p.bit, null);
        addedForAdmins.delete(p.bit);
      }
    }
    onchange(out);
  }

  function allowAdmins() {
    undo = null;
    onchange(keepAdminVoice(acl, silenced));
  }

  function describe(t: AccessTarget, p: PermissionInfo): string {
    const here = cellValue(acl, t, p.bit);
    if (here) return `${label(t)}, ${p.name}: ${here === 'allow' ? 'allowed' : 'denied'} here`;
    const up = inheritedValue(acl, t, p.bit);
    return `${label(t)}, ${p.name}: not set${up ? `, inherited ${up === 'allow' ? 'allow' : 'deny'}` : ''}`;
  }

  async function addPerson() {
    personError = '';
    const name = person.trim();
    if (!name) return;
    const userId = await resolve(name);
    if (userId == null) { personError = `"${name}" is not a registered user on this server.`; return; }
    extra = [...extra, { key: `u:${userId}`, group: null, userId }];
    person = '';
  }
</script>

<h4>Who is this channel for?</h4>
<div class="presets">
  {#each ACCESS_PRESETS as p (p.id)}
    <button type="button" class="preset" class:on={active === p.id} aria-pressed={active === p.id} onclick={() => pickPreset(p.id)}>
      <b>{p.name}</b><span>{p.help}</span>
    </button>
  {/each}
</div>
{#if undo}
  <p class="replaced">Replaced {undo.count} {undo.count === 1 ? 'rule' : 'rules'}. <button type="button" class="link" onclick={() => { onchange(undo!.acl); undo = null; }}>Undo</button></p>
{/if}

<div class="bar">
  <h4 title="Applies here and in subchannels. Lower rows overrule higher ones.">By group or person</h4>
  <button type="button" class="link" onclick={onadvanced}>Advanced rules</button>
</div>
<div class="cats" role="group" aria-label="Permission category">
  {#each PERMISSION_GROUPS as g (g.name)}
    <button type="button" class:on={category === g.name} aria-pressed={category === g.name} onclick={() => (category = g.name)}>{g.name}</button>
  {/each}
</div>
<div class="wrap">
  <table>
    <thead>
      <tr><th scope="col">Who</th>{#each columns as p (p.bit)}<th scope="col" title={p.help}>{p.name}</th>{/each}</tr>
    </thead>
    <tbody>
      {#each targets as t (t.key)}
        <tr>
          <th scope="row" title={t.group ? `@${t.group}` : undefined}>{label(t)}</th>
          {#each columns as p (p.bit)}
            {@const here = cellValue(acl, t, p.bit)}
            {@const up = inheritedValue(acl, t, p.bit)}
            {@const text = describe(t, p)}
            <td>
              <button type="button" class="cell {here ?? ''}" aria-label={text} title={text} onclick={() => cycle(t, p)}>
                {#if here === 'allow'}<Icon name="check" size={15} />
                {:else if here === 'deny'}<Icon name="x" size={15} />
                {:else if up === 'allow'}<span class="up allow"><Icon name="check" size={13} /></span>
                {:else if up === 'deny'}<span class="up deny"><Icon name="x" size={13} /></span>
                {:else}<span class="unset"></span>{/if}
              </button>
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>
{#if silenced.length}
  <p class="voice" title="The Administrator permission does not include Speak or Whisper.">
    Admins cannot {silencedText} here. <button type="button" class="link" onclick={allowAdmins}>Allow admins</button>
  </p>
{/if}
<div class="add">
  <input bind:value={person} placeholder="Add a registered user" aria-label="Add a registered user" onkeydown={e => { if (e.key === 'Enter') addPerson(); }} />
  <button type="button" class="btn" disabled={!person.trim()} onclick={addPerson}>Add</button>
</div>
{#if personError}<p class="problem">{personError}</p>{/if}

<style>
  h4 { margin: 16px 0 8px; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-dim); }
  .presets { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 6px; }
  .preset { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; text-align: left; background: var(--bg-2); border: 1px solid var(--line-strong); }
  .preset:hover { background: var(--bg-hover); }
  .preset.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .preset b { font-size: 13px; font-weight: 650; color: var(--text); }
  .preset span { font-size: 12px; line-height: 1.3; color: var(--text-dim); }
  .replaced { margin: 8px 0 0; font-size: 13px; color: var(--text-dim); }
  .link { color: var(--link); font-size: 13px; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
  .cats { display: flex; flex-wrap: wrap; gap: 2px; border-bottom: 1px solid var(--line); }
  .cats button { padding: 6px 10px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
  .cats button:hover { color: var(--text); }
  .cats button.on { color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }
  .wrap { overflow-x: auto; }
  table { width: 100%; min-width: 500px; table-layout: fixed; border-collapse: collapse; font-size: 13px; }
  th { padding: 6px 3px; font-weight: 600; line-height: 1.2; color: var(--text-dim); text-align: center; border-bottom: 1px solid var(--line); }
  thead th:first-child { width: 140px; }
  thead th:first-child, tbody th { padding-left: 6px; text-align: left; }
  tbody th { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td { padding: 2px; text-align: center; border-bottom: 1px solid var(--line); }
  .cell { display: inline-flex; align-items: center; justify-content: center; width: 100%; min-width: 44px; height: 32px; background: var(--bg-0); border: 1px solid var(--line); color: var(--text-dim); }
  .cell:hover { border-color: var(--line-strong); background: var(--bg-hover); }
  .cell.allow { background: color-mix(in srgb, var(--speaking) 26%, var(--bg-1)); border-color: var(--speaking); color: var(--text); }
  .cell.deny { background: color-mix(in srgb, var(--danger) 28%, var(--bg-1)); border-color: var(--danger); color: var(--text); }
  .up { display: inline-flex; opacity: 0.75; }
  .up.allow { color: var(--speaking); }
  .up.deny { color: var(--danger); }
  .unset { width: 8px; height: 1px; background: var(--text-faint); }
  .voice { margin: 10px 0 0; font-size: 13px; color: var(--warn); }
  .add { display: flex; gap: 6px; margin-top: 10px; }
  .problem { margin: 6px 0 0; font-size: 13px; color: var(--danger); }
</style>
