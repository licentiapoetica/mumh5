<script lang="ts">
  import Icon from './Icon.svelte';

  let { size = 14 }: { size?: number } = $props();
</script>

<span class="admin-badge" role="img" aria-label="Server admin" title="Server admin"><Icon name="crown" {size} /></span>

<style>
  .admin-badge { flex: none; display: inline-flex; vertical-align: -2px; color: var(--warn); }
</style>
