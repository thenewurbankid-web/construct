export function checkoutMachine() {
  return { id: 'checkout', initial: 'idle', states: { idle: {} } };
}
