export interface Item {
  price: number;
  qty: number;
}

export function total(items: Item[]): number {
  return items.reduce(
    (sum, item) => sum + item.price * item.qty,
    0,
  );
}

// Desconto em porcentagem, até 50%.
export function discount(value: number, pct: number): number {
  if (pct > 50) throw new Error("desconto acima do limite");
  return value * (1 - (pct / 100));
}
