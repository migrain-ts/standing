export type HoldInfo = { id: string; expiresAt: string; totalCents: number; seatIdxs: number[] };

/** idle -> queued -> selecting -> holding -> paying -> paid | declined | expired. `ticket` is null when no queue applies. */
export type CheckoutState =
  | { phase: 'idle' }
  | { phase: 'queued'; position?: number; queueLength?: number }
  | { phase: 'selecting'; ticket: string | null }
  | { phase: 'holding'; ticket: string | null }
  | { phase: 'paying'; ticket: string | null; hold: HoldInfo; key: string; submitting: boolean }
  | { phase: 'declined'; ticket: string | null; hold: HoldInfo }
  | { phase: 'expired'; ticket: string | null }
  | { phase: 'paid'; orderId: string };

export type CheckoutAction =
  | { type: 'start' }
  | { type: 'queue'; position: number; queueLength: number }
  | { type: 'admit'; ticket: string | null }
  | { type: 'reserve' }
  | { type: 'reserveFailed' }
  | { type: 'held'; hold: HoldInfo; key: string }
  | { type: 'submit' }
  | { type: 'paid'; orderId: string }
  | { type: 'declined' }
  | { type: 'submitFailed' }
  | { type: 'requeue' }
  | { type: 'retry'; key: string }
  | { type: 'cancel' }
  | { type: 'expire' }
  | { type: 'restart' };

export const initialCheckout: CheckoutState = { phase: 'idle' };

export function checkoutReducer(state: CheckoutState, action: CheckoutAction): CheckoutState {
  switch (action.type) {
    case 'start':
      return state.phase === 'idle' ? { phase: 'queued' } : state;
    case 'queue':
      return state.phase === 'queued' ? { phase: 'queued', position: action.position, queueLength: action.queueLength } : state;
    case 'admit':
      return state.phase === 'queued' ? { phase: 'selecting', ticket: action.ticket } : state;
    case 'reserve':
      return state.phase === 'selecting' ? { phase: 'holding', ticket: state.ticket } : state;
    case 'reserveFailed':
      return state.phase === 'holding' ? { phase: 'selecting', ticket: state.ticket } : state;
    case 'held':
      return state.phase === 'holding' ? { phase: 'paying', ticket: state.ticket, hold: action.hold, key: action.key, submitting: false } : state;
    case 'submit':
      return state.phase === 'paying' && !state.submitting ? { ...state, submitting: true } : state;
    case 'paid':
      return state.phase === 'paying' ? { phase: 'paid', orderId: action.orderId } : state;
    case 'declined':
      return state.phase === 'paying' && state.submitting ? { phase: 'declined', ticket: state.ticket, hold: state.hold } : state;
    case 'submitFailed':
      return state.phase === 'paying' && state.submitting ? { ...state, submitting: false } : state;
    case 'requeue':
      return state.phase === 'selecting' || state.phase === 'holding' || state.phase === 'expired' ? { phase: 'queued' } : state;
    case 'retry':
      return state.phase === 'declined' ? { phase: 'paying', ticket: state.ticket, hold: state.hold, key: action.key, submitting: false } : state;
    case 'cancel':
      return state.phase === 'paying' || state.phase === 'declined' ? { phase: 'selecting', ticket: state.ticket } : state;
    case 'expire':
      // A payment already in flight is settled by the server, not by the clock.
      if (state.phase === 'paying') return state.submitting ? state : { phase: 'expired', ticket: state.ticket };
      if (state.phase === 'declined') return { phase: 'expired', ticket: state.ticket };
      return state;
    case 'restart':
      return state.phase === 'expired' ? { phase: 'selecting', ticket: state.ticket } : state;
    default: {
      const never: never = action;
      return never;
    }
  }
}
