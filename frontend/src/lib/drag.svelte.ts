// What is being dragged in the channel tree
export const drag = $state<{ item: { kind: 'channel'; id: number } | { kind: 'user'; ids: number[]; serverId: string | undefined } | null }>({ item: null });
