// Data hooks, RTK Query style. The real ones fetch; tests replace them.
export interface Item { id: string; name: string; price: number; tier: 'free' | 'pro' | 'team' }
export interface ItemsResponse { items: Item[]; total: number }

export function useGetItemsQuery(_arg: { tier: string }, _opts?: { skip?: boolean }): { data?: ItemsResponse; isLoading: boolean; isError: boolean } {
  throw new Error('useGetItemsQuery needs the network');
}

export function useBuyItemMutation(): [(arg: { id: string }) => { unwrap: () => Promise<{ ok: boolean }> }, { isLoading: boolean }] {
  throw new Error('useBuyItemMutation needs the network');
}
