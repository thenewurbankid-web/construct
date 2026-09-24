const secret = process.env.STRIPE_SECRET;

export const stripe = { charges: { create: (args: { amount: number }) => ({ secret, ...args }) } };
