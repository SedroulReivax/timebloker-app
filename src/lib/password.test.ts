import { describe, expect, it } from 'vitest';
import { getPasswordStrength, isValidCode, newPasswordError, normalizeCode, strengthLabel } from './password';

describe('password rules', () => {
  it('scores length, case, digits and symbols', () => {
    expect(getPasswordStrength('')).toBe(0);
    expect(getPasswordStrength('abc')).toBe(1);
    expect(getPasswordStrength('abcdefgh')).toBe(2);
    expect(getPasswordStrength('Abcdefg1!')).toBe(5);
    expect(strengthLabel(2)).toBe('Weak');
    expect(strengthLabel(3)).toBe('Medium');
    expect(strengthLabel(5)).toBe('Strong');
  });

  it('rejects short, weak and mismatched new passwords, accepts a good one', () => {
    expect(newPasswordError('Ab1', 'Ab1')).toMatch(/at least/);
    expect(newPasswordError('abcdefgh', 'abcdefgh')).toMatch(/weak/i);
    expect(newPasswordError('Abcdefg1', 'Abcdefg2')).toMatch(/match/);
    expect(newPasswordError('Abcdefg1', 'Abcdefg1')).toBeNull();
  });

  it('accepts 6-10 digit email codes, ignoring spaces', () => {
    expect(isValidCode('123456')).toBe(true);
    expect(isValidCode('123 456')).toBe(true);
    expect(normalizeCode(' 12 34 56 ')).toBe('123456');
    expect(isValidCode('12345')).toBe(false);
    expect(isValidCode('12345a')).toBe(false);
  });
});
