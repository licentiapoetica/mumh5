// What is being dragged in the channel tree
export const drag = $state<{ item: { kind: 'channel' | 'user'; id: number } | null }>({ item: null });
