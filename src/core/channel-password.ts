// Channel passwords the way the desktop client writes them, so both can read and change them:
// a rule denying @all and a rule granting the group "#<password>", which matches people who
// sent that password as an access token. Anyone with Write there or on root can read it.
import { PERM, type AclEntry, type ChannelAcl } from './client.ts';

const OLD_BITS = PERM.Enter | PERM.Speak | PERM.Whisper | PERM.TextMessage | PERM.LinkChannel;
const BITS = OLD_BITS | PERM.Traverse;
const isBits = (v: number) => v === BITS || v === OLD_BITS;

const isGrant = (r: AclEntry) => !r.inherited && r.applyHere && r.userId == null
  && !!r.group && r.group.length > 1 && r.group.startsWith('#') && isBits(r.grant) && r.deny === 0;
const isDenyAll = (r: AclEntry) => !r.inherited && r.applyHere && r.userId == null
  && r.group === 'all' && r.grant === 0 && isBits(r.deny);

const lastIndex = (acls: AclEntry[], test: (r: AclEntry) => boolean) => acls.map(test).lastIndexOf(true);

export function channelPassword(acl: ChannelAcl): string {
  const at = lastIndex(acl.acls, isGrant);
  return at < 0 ? '' : acl.acls[at].group!.slice(1);
}

// Murmur reads these as operators even after the #: "!x" would admit everyone not holding "x"
export function passwordProblem(password: string): string | null {
  return /^[!~#$]/.test(password) ? 'A channel password cannot start with !, ~, # or $.' : null;
}

export function withPassword(acl: ChannelAcl, password: string): ChannelAcl {
  const acls = acl.acls.map(r => ({ ...r }));
  const at = lastIndex(acls, isGrant);
  if (!password) {
    if (at >= 0) {
      acls.splice(at, 1);
      const deny = lastIndex(acls, isDenyAll);
      if (deny >= 0) acls.splice(deny, 1);
    }
  } else if (at >= 0) {
    acls[at].group = `#${password}`;
  } else {
    const rule = { applyHere: true, applySubs: false, inherited: false, userId: null };
    acls.push(
      { ...rule, group: 'all', grant: 0, deny: BITS },
      { ...rule, group: `#${password}`, grant: BITS, deny: 0 }
    );
  }
  return { ...acl, acls };
}
