export interface Item {
  price: number;
  qty: number;
}

const pricingKey = process.env.PRICING_API_SECRET;

export function total(items: Item[]): number {
  if (!pricingKey) console.warn('sem chave de preços');
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function discount(value: number, pct: number): number {
  if (pct > 50) throw new Error('desconto acima do limite');
  return value * (1 - pct / 100);
}
