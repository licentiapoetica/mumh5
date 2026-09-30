// Minimal typed event emitter that works in both browser and Node.
export class Emitter<Events extends Record<string, (...args: any[]) => void>> {
  private handlers = new Map<keyof Events, Set<Function>>();

  on<K extends keyof Events>(event: K, fn: Events[K]): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    for (const fn of this.handlers.get(event) ?? []) fn(...args);
  }
}
