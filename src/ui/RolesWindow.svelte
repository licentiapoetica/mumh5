<script lang="ts">
  import RolesDialog from './RolesDialog.svelte';
  import { session, sessions } from '../lib/session.svelte.ts';
  import type { ui } from '../lib/ui.svelte.ts';

  type Request = NonNullable<typeof ui.rolesDialog>;
  let { open, jump, onclose }: { open: Request; jump: Request | null; onclose: () => void } = $props();

  // It belongs to the server it was opened on: switching servers or losing the connection closes it
  const server = sessions.activeId;
  // After this update, since closing unmounts this component
  $effect(() => { if (sessions.activeId !== server || session.status !== 'connected') queueMicrotask(onclose); });
</script>

<RolesDialog {...open} {jump} {onclose} windowed />
