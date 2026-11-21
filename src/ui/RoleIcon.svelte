<script lang="ts">
  import Icon from './Icon.svelte';
  import type { RoleInfo } from '../core/roles.ts';

  let { role, size = 14 }: { role: Pick<RoleInfo, 'i'>; size?: number } = $props();
</script>

{#if role.i.startsWith('data:')}
  <img src={role.i} width={size} height={size} alt="" />
{:else}
  <Icon name={role.i} {size} />
{/if}

<style>
  img { display: block; flex: none; object-fit: contain; }
</style>
