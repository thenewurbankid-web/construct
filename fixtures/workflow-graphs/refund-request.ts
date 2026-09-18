import { setup } from 'xstate';

// A richer, guarded example used by the workflow narrator's golden tests:
// a retry loop, a delay, two end states and guarded branches.
export const RefundRequestWorkflow = setup({
  guards: {
    isLowValue: ({ context }) => context.amount < 50,
    isSuspicious: ({ context }) => context.flagged,
  },
}).createMachine({
  id: 'refundRequest',
  initial: 'submitted',
  states: {
    submitted: {
      on: { REQUEST_REFUND: 'autoCheck' },
    },
    autoCheck: {
      entry: 'logCheckStarted',
      always: [
        { target: 'approved', guard: 'isLowValue' },
        { target: 'manualReview', guard: 'isSuspicious' },
        { target: 'manualReview' },
      ],
    },
    manualReview: {
      after: { 172800000: 'escalated' },
      on: {
        APPROVE: { target: 'approved', actions: ['notifyCustomer'] },
        REJECT: { target: 'rejected', actions: 'notifyCustomer' },
        NEED_MORE_INFO: 'submitted',
      },
    },
    escalated: {
      on: { APPROVE: 'approved', REJECT: 'rejected' },
    },
    approved: {
      invoke: { src: 'issueRefund', onDone: 'refunded', onError: { target: 'approved', actions: 'alertFinance' } },
    },
    refunded: {
      on: { CLOSE: 'closed' },
    },
    closed: { type: 'final' },
    rejected: { type: 'final' },
  },
});
