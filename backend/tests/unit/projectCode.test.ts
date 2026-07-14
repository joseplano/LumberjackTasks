import { describe, it, expect } from 'vitest';
import { derivePrefix, formatProjectCode } from '../../src/services/projectCode';

describe('derivePrefix', () => {
  it('takes the first four letters uppercased', () => {
    expect(derivePrefix('Anima Machina')).toBe('ANIM');
  });

  it('ignores spaces, digits and symbols', () => {
    expect(derivePrefix('a b-c d99 e')).toBe('ABCD');
  });

  it('pads short names with X', () => {
    expect(derivePrefix('AI')).toBe('AIXX');
  });

  it('returns XXXX for names without letters', () => {
    expect(derivePrefix('123 !!')).toBe('XXXX');
  });
});

describe('formatProjectCode', () => {
  it('zero-pads the sequence to six digits', () => {
    expect(formatProjectCode('ANIM', 1)).toBe('ANIM-000001');
    expect(formatProjectCode('AIXX', 1234567)).toBe('AIXX-1234567');
  });
});
