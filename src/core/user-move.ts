export interface MovePerson { id: number; name: string; channelId: number }
export interface MoveResult extends MovePerson {
  status: 'pending' | 'password' | 'moved' | 'already' | 'failed';
  reason: string;
}
export interface UserMove {
  channelId: number;
  channelName: string;
  people: MoveResult[];
}

// Unknown permissions stay actionable; the server has the final say.
export function planUserMove(people: MovePerson[], channelId: number, channelName: string,
  self: number | undefined, canMove: (channelId: number) => boolean | null): UserMove {
  return { channelId, channelName, people: [...new Map(people.map(p => [p.id, p])).values()].map(p => {
    const already = p.channelId === channelId;
    const denied = !already && p.id !== self && canMove(p.channelId) === false;
    return { ...p, status: already ? 'already' : denied ? 'failed' : 'pending',
      reason: denied ? 'You cannot move people out of this channel.' : '' };
  }) };
}

export function movePending(move: UserMove | null): boolean {
  return !!move?.people.some(p => p.status === 'pending' || p.status === 'password');
}

export function confirmUserMove(move: UserMove, id: number, channelId: number): void {
  if (channelId !== move.channelId) return;
  const person = move.people.find(p => p.id === id && (p.status === 'pending' || p.status === 'password'));
  if (person) { person.status = 'moved'; person.reason = ''; }
}

export function failUserMove(move: UserMove, reason: string, id?: number): void {
  for (const person of move.people) {
    if ((person.status === 'pending' || person.status === 'password') && (id === undefined || person.id === id)) {
      person.status = 'failed';
      person.reason = reason;
    }
  }
}

export function remainingSelection(move: UserMove, selected: number[]): number[] {
  const done = new Set(move.people.filter(p => p.status === 'moved' || p.status === 'already').map(p => p.id));
  return selected.filter(id => !done.has(id));
}
