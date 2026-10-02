// Password rules shared by sign-up, reset and change-password, so every form accepts the same passwords.

/** 0-5: one point each for any input, 8+ characters, an uppercase letter, a digit, a symbol. */
export const getPasswordStrength = (pass: string): number => {
  let score = 0;
  if (pass.length > 0) score++;
  if (pass.length >= 8) score++;
  if (/[A-Z]/.test(pass)) score++;
  if (/[0-9]/.test(pass)) score++;
  if (/[^A-Za-z0-9]/.test(pass)) score++;
  return score;
};

/** Below this a new password is rejected as too weak. */
export const MIN_STRENGTH = 3;
export const MIN_LENGTH = 6;

export const strengthLabel = (score: number): 'Weak' | 'Medium' | 'Strong' => (score <= 2 ? 'Weak' : score === 3 ? 'Medium' : 'Strong');

/** Why a new password can't be used, or null when it can. */
export const newPasswordError = (password: string, confirm: string): string | null => {
  if (password.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
  if (getPasswordStrength(password) < MIN_STRENGTH) return 'Too weak: use 8+ characters with a capital letter, a number or a symbol.';
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
};

/** Supabase email codes are 6 digits by default (configurable up to 10); accept 6-10 digits, ignoring spaces. */
export const normalizeCode = (raw: string): string => raw.replace(/\s+/g, '');
export const isValidCode = (raw: string): boolean => /^\d{6,10}$/.test(normalizeCode(raw));
