export type SelectionAction =
  | { type: 'toggle'; idx: number; free: boolean }
  | { type: 'set'; idxs: readonly number[] }
  | { type: 'clear' };

export function selectionReducer(state: ReadonlySet<number>, action: SelectionAction, max = 8): ReadonlySet<number> {
  switch (action.type) {
    case 'toggle': {
      if (state.has(action.idx)) {
        const next = new Set(state);
        next.delete(action.idx);
        return next;
      }
      if (!action.free || state.size >= max) return state;
      return new Set(state).add(action.idx);
    }
    case 'set':
      return new Set(action.idxs.slice(0, max));
    case 'clear':
      return new Set();
    default: {
      const never: never = action;
      return never;
    }
  }
}
