import React, { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { getPasswordStrength, isValidCode, MIN_LENGTH, newPasswordError, normalizeCode, strengthLabel } from '../../lib/password';

export const FIELD =
  'w-full px-4 py-3 bg-card border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all';
const LABEL = 'text-xs text-muted-foreground font-medium';
const PRIMARY = 'w-full py-3 bg-primary text-primary-foreground font-semibold rounded-md hover:opacity-90 transition-opacity disabled:opacity-50';
const LINK = 'text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 disabled:opacity-50 disabled:no-underline';

// ─── Password input with a show/hide toggle ───────────────────────────────────

interface PasswordInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  shown: boolean;
  onToggleShown: () => void;
  id?: string;
}

export const PasswordInput: React.FC<PasswordInputProps> = ({ label, value, onChange, autoComplete, shown, onToggleShown, id }) => (
  <div className="space-y-2">
    <label htmlFor={id} className={LABEL}>{label}</label>
    <div className="relative">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD} pr-10`}
        placeholder="••••••••"
        autoComplete={autoComplete}
        required
        minLength={MIN_LENGTH}
      />
      <button
        type="button"
        onClick={onToggleShown}
        aria-label={shown ? 'Hide password' : 'Show password'}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
      >
        {shown ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  </div>
);

/** Five-step strength bar under a new password. */
export const StrengthMeter: React.FC<{ password: string }> = ({ password }) => {
  if (!password) return null;
  const s = getPasswordStrength(password);
  return (
    <div className="pt-1" aria-live="polite">
      <div className="flex gap-1 h-1.5 mb-1">
        {[1, 2, 3, 4, 5].map((level) => (
          <div
            key={level}
            className={`flex-1 rounded-full transition-all duration-300 ${
              s >= level ? (s <= 2 ? 'bg-destructive' : s === 3 ? 'bg-orange-500' : 'bg-primary') : 'bg-border'
            }`}
          />
        ))}
      </div>
      <span className="text-[11px] text-muted-foreground font-medium">{strengthLabel(s)}</span>
    </div>
  );
};

/** A new password plus its confirmation, with the strength meter. */
export const NewPasswordFields: React.FC<{
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  label?: string;
}> = ({ password, confirm, onPassword, onConfirm, label = 'New password' }) => {
  const [shown, setShown] = useState(false);
  return (
    <>
      <div>
        <PasswordInput label={label} value={password} onChange={onPassword} autoComplete="new-password" shown={shown} onToggleShown={() => setShown((v) => !v)} />
        <StrengthMeter password={password} />
      </div>
      <PasswordInput label="Confirm password" value={confirm} onChange={onConfirm} autoComplete="new-password" shown={shown} onToggleShown={() => setShown((v) => !v)} />
    </>
  );
};

export const Notice: React.FC<{ kind: 'error' | 'ok'; children: React.ReactNode }> = ({ kind, children }) => (
  <div
    role={kind === 'error' ? 'alert' : 'status'}
    className={`text-sm rounded-md px-4 py-3 border ${kind === 'error' ? 'text-destructive bg-destructive/10 border-destructive/20' : 'text-primary bg-primary/10 border-primary/20'}`}
  >
    {children}
  </div>
);

// ─── Reset with an emailed code ───────────────────────────────────────────────
// Step 1 sends a recovery email (resetPasswordForEmail). The project's "Reset password" email template must include
// {{ .Token }} so the email carries a code. Step 2 verifies the code (verifyOtp, type 'recovery'), which signs the
// user in, then sets the new password. Nobody has to leave the app, which also makes it work in the desktop app.

const RESEND_SECONDS = 60;

interface ResetWithCodeProps {
  /** prefilled email; with lockEmail the user cannot change it (Settings, where you are already signed in) */
  email?: string;
  lockEmail?: boolean;
  /** called once the new password is saved; the user is signed in at that point */
  onDone: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
}

export const ResetWithCode: React.FC<ResetWithCodeProps> = ({ email: initialEmail = '', lockEmail, onDone, onCancel, cancelLabel = 'Back to sign in' }) => {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const sendCode = async () => {
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim());
    setBusy(false);
    // Never say whether the address has an account; only surface errors that are about the request itself.
    if (err && /rate|limit|seconds/i.test(err.message)) {
      setError(err.message);
      return;
    }
    setStep('code');
    setResendIn(RESEND_SECONDS);
    setInfo(`If an account exists for ${email.trim()}, a code is on its way. It can take a minute; check spam too.`);
  };

  const submitNewPassword = async () => {
    setError('');
    if (!isValidCode(code)) { setError('Enter the code from the email (digits only).'); return; }
    const pwError = newPasswordError(password, confirm);
    if (pwError) { setError(pwError); return; }
    setBusy(true);
    const { error: verifyErr } = await supabase.auth.verifyOtp({ email: email.trim(), token: normalizeCode(code), type: 'recovery' });
    if (verifyErr) {
      setBusy(false);
      setError('That code is wrong or has expired. Check the latest email, or send a new code.');
      return;
    }
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateErr) { setError(updateErr.message); return; }
    onDone();
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => { e.preventDefault(); void (step === 'email' ? sendCode() : submitNewPassword()); }}
    >
      {step === 'email' ? (
        <>
          <p className="text-sm text-muted-foreground">We'll email you a code. Enter it here with your new password; you won't need to leave this page.</p>
          <div className="space-y-2">
            <label htmlFor="reset-email" className={LABEL}>Email</label>
            <input
              id="reset-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              readOnly={lockEmail}
              className={`${FIELD} ${lockEmail ? 'opacity-70' : ''}`}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
        </>
      ) : (
        <>
          {info && <Notice kind="ok">{info}</Notice>}
          <div className="space-y-2">
            <label htmlFor="reset-code" className={LABEL}>Code from the email</label>
            <input
              id="reset-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${FIELD} ibm-mono tracking-[0.3em] text-center text-lg`}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={12}
              required
            />
          </div>
          <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
        </>
      )}

      {error && <Notice kind="error">{error}</Notice>}

      <button type="submit" disabled={busy || !email.trim()} className={PRIMARY}>
        {busy ? 'Working…' : step === 'email' ? 'Email me a code' : 'Set new password'}
      </button>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        {onCancel ? <button type="button" onClick={onCancel} className={LINK}>{cancelLabel}</button> : <span />}
        {step === 'code' && (
          <button type="button" onClick={() => void sendCode()} disabled={busy || resendIn > 0} className={LINK}>
            {resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
          </button>
        )}
      </div>
    </form>
  );
};
