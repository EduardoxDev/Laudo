import { describe, expect, it } from 'vitest';
import { discount, total } from '../src/cart';

describe('total', () => {
  it('soma preço vezes quantidade', () => {
    expect(total([{ price: 10, qty: 2 }, { price: 11, qty: 2 }])).toBe(42);
  });

  it('carrinho vazio vale zero', () => {
    expect(total([])).toBe(0);
  });
});

describe('discount', () => {
  it('aplica a porcentagem', () => {
    expect(discount(100, 10)).toBe(90);
  });

  it('recusa desconto acima de 50%', () => {
    expect(() => discount(100, 60)).toThrow('desconto acima do limite');
  });
});
