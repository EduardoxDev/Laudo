import { total, type Item } from '../cart';

export interface Refund {
  orderId: string;
  amount: number;
}

export function refundOrder(orderId: string, items: Item[], paid: number): Refund {
  const amount = Math.min(total(items), paid);
  if (amount <= 0) throw new Error('nada para devolver');
  return { orderId, amount };
}
