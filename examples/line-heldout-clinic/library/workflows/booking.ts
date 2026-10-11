export type BookingStep = 'pick' | 'confirm' | 'booked';

export function advance(step: BookingStep): BookingStep {
  return step === 'pick' ? 'confirm' : 'booked';
}
