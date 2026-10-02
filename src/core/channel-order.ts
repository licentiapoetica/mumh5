// Where a channel sits among its siblings. Mumble sorts by position, then by name, so a
// channel dropped between two others needs a position that puts it exactly there.
export interface Ordered { id: number; position: number; name: string }

export const byOrder = (a: Ordered, b: Ordered) => a.position - b.position || a.name.localeCompare(b.name);

// Position changes that put `moved` at `index` among `siblings` (which need not contain it).
// One change when there is room between the neighbours; otherwise the row is numbered again.
export function planMove(siblings: Ordered[], moved: Ordered, index: number): { id: number; position: number }[] {
  const rest = siblings.filter(c => c.id !== moved.id).sort(byOrder);
  const at = Math.max(0, Math.min(index, rest.length));
  const prev = rest[at - 1];
  const next = rest[at];
  const fits = (position: number) => {
    const m = { ...moved, position };
    return (!prev || byOrder(prev, m) < 0) && (!next || byOrder(m, next) < 0);
  };
  const tries = [moved.position, prev?.position, next?.position, prev && prev.position + 1, next && next.position - 1];
  for (const p of tries) {
    if (p == null || !fits(p)) continue;
    return p === moved.position ? [] : [{ id: moved.id, position: p }];
  }
  const order = [...rest.slice(0, at), moved, ...rest.slice(at)];
  return order.map((c, i) => ({ id: c.id, position: i })).filter((u, i) => order[i].position !== u.position);
}
