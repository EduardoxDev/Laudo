import { describe, expect, it } from 'vitest';
import { brl } from '../src/format';

describe('brl', () => {
  it('formata em reais', () => {
    expect(brl(1234.5)).toBe('R$ 1.234,50');
  });

  it('formata zero', () => {
    expect(brl(0)).toBe('R$ 0,00');
  });
});
