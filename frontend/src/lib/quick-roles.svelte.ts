import { sessions, type Session } from './session.svelte.ts';
import { ui } from './ui.svelte.ts';
import type { MenuItem } from './menu.svelte.ts';
import type { ChannelAcl } from '../core/client.ts';
import { isBuiltinRole, roleMembers, rolesFromAcl, setMember } from '../core/roles.ts';

// Several switches in a row become one save: ACL and description writes are rate limited
const SAVE_DELAY = 350;

class QuickRoles {
  acl = $state.raw<ChannelAcl | null>(null);
  problem = $state('');
  private owner: Session;
  private pending = new Map<string, { group: string; userId: number; on: boolean }>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;

  constructor(owner: Session) {
    this.owner = owner;
  }

  private get busy(): boolean {
    return !!this.running || this.pending.size > 0;
  }

  async load(): Promise<void> {
    // While a change is on its way, the list on screen is the newer one
    if (this.busy) return;
    this.problem = '';
    this.acl = null;
    const got = await this.owner.readRootAcl();
    if (this.busy) return;
    this.acl = got;
    this.problem = got ? '' : 'Could not load roles';
  }

  toggle(group: string, userId: number, on: boolean): void {
    if (!this.acl) return;
    this.acl = setMember(this.acl, group, userId, on);
    this.pending.set(`${group}:${userId}`, { group, userId, on });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), SAVE_DELAY);
  }

  // Also waited for before the full dialog reads the rules
  save(): Promise<void> {
    clearTimeout(this.timer);
    this.running ??= this.drain().finally(() => { this.running = null; });
    return this.running;
  }

  private async drain(): Promise<void> {
    while (this.pending.size) {
      const changes = [...this.pending.values()];
      this.pending.clear();
      if (await this.owner.changeMembers(changes)) continue;
      this.pending.clear();
      this.acl = null;
      this.problem = 'Could not change roles';
    }
  }
}

const perSession = new WeakMap<Session, QuickRoles>();

export function roleSubmenu(userId: number): NonNullable<MenuItem['submenu']> {
  const owner = sessions.active;
  let quick = perSession.get(owner);
  if (!quick) perSession.set(owner, quick = new QuickRoles(owner));
  const q = quick;
  const manage: MenuItem = {
    label: 'Manage roles...',
    action: () => { q.save().then(() => { ui.rolesDialog = { tab: 'members', userId }; }); }
  };
  const sep: MenuItem = { separator: true, label: '' };
  return {
    onopen: () => { q.load(); },
    items: () => {
      if (q.problem) return [{ label: q.problem, disabled: true }, sep, manage];
      const acl = q.acl;
      if (!acl) return [{ label: 'Loading roles...', disabled: true }];
      const isSelf = owner.client?.self?.userId === userId;
      const rows = rolesFromAcl(acl, owner.roleDoc).filter(r => !isBuiltinRole(r.g)).map((r): MenuItem => {
        const on = roleMembers(acl, r.g).includes(userId);
        const locked = on && isSelf && owner.keepsRootWrite(acl) && !owner.keepsRootWrite(setMember(acl, r.g, userId, false));
        return {
          label: r.n, role: r, checked: on, keepOpen: true, disabled: locked,
          title: locked ? 'This would remove your own admin access' : undefined,
          action: () => q.toggle(r.g, userId, !on)
        };
      });
      return [...(rows.length ? rows : [{ label: 'No roles yet', disabled: true }]), sep, manage];
    }
  };
}
