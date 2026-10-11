// @line-base workflows/booking
import { advance, type BookingStep } from '../../../library/workflows/booking';

export function nextStep(step: BookingStep): BookingStep {
  return advance(step);
}
