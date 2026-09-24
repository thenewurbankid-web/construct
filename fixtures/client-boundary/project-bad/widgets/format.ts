import { charge } from '../features/shop/services/payments';

// No directive: it only counts as client because a 'use client' file imports it.
export const formatAndCharge = (amount: number) => charge(amount);
