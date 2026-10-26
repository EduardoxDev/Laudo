import { describe, expect, it } from "vitest";
import { discount, total, type Item } from "../src/cart";

function expectTotal(items: Item[], value: number) {
  expect(total(items)).toBe(value);
}

describe("total", () => {
  it("soma preço vezes quantidade", () => {
    expectTotal(
      [
        { price: 10, qty: 2 },
        { price: 11, qty: 2 },
      ],
      42,
    );
  });

  it("carrinho sem itens vale zero", () => {
    expect(total([])).toBe(0);
  });
});

describe("discount", () => {
  it("aplica a porcentagem", () => {
    expect(discount(100, 10)).toBe(90);
  });

  it("recusa desconto acima de 50%", () => {
    expect(() => discount(100, 60)).toThrow("desconto acima do limite");
  });
});
