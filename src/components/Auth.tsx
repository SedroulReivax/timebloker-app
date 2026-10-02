import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useTheme } from './ThemeProvider';
import { FIELD, NewPasswordFields, Notice, PasswordInput, ResetWithCode } from './ui/password';
import { newPasswordError } from '../lib/password';

interface AuthProps {
  onBack: () => void;
}

type Mode = 'signin' | 'signup' | 'reset';

const SUBTITLE: Record<Mode, string> = {
  signin: 'Welcome back.',
  signup: 'Create your private account.',
  reset: 'Reset your password.',
};

export const Auth = ({ onBack }: AuthProps) => {
  const [mode, setMode] = useState<Mode>('signin');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { theme, setTheme } = useTheme();

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setSuccess('');
    setPassword('');
    setConfirmPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (mode === 'signup') {
      const pwError = newPasswordError(password, confirmPassword);
      if (pwError) { setError(pwError); return; }
    }

    setLoading(true);
    const { error: authError } = mode === 'signup'
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (authError) {
      setError(authError.message);
    } else if (mode === 'signup') {
      switchMode('signin');
      setSuccess('Account created! Check your email for the verification link, then sign in.');
    }
  };

  return (
    <div className="min-h-screen min-h-dvh bg-background text-foreground flex flex-col pt-[var(--safe-t)] pb-[var(--safe-b)]">
      <header className="flex justify-between items-center px-8 py-6">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2"
        >
          ← Back
        </button>
        <div className="flex gap-2">
          {[
            { t: 'theme-stark-white' as const, bg: 'bg-white border border-border', name: 'Stark white' },
            { t: 'theme-stark-black' as const, bg: 'bg-black', name: 'Stark black' },
            { t: 'theme-solarized-light' as const, bg: 'bg-[#fdf6e3]', name: 'Solarized light' },
            { t: 'theme-solarized-dark' as const, bg: 'bg-[#002b36]', name: 'Solarized dark' },
          ].map(({ t, bg, name }) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              aria-label={`${name} theme`}
              className={`w-5 h-5 rounded-full ${bg} ${theme === t ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
            />
          ))}
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">TimeBloker</h1>
            <p className="text-muted-foreground text-sm">{SUBTITLE[mode]}</p>
          </div>

          {mode === 'reset' ? (
            <ResetWithCode
              email={email}
              onDone={() => { /* verifying the code signed the user in; App switches to the tracker on its own */ }}
              onCancel={() => switchMode('signin')}
            />
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="auth-email" className="text-xs text-muted-foreground font-medium">Email</label>
                  <input
                    id="auth-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={FIELD}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                    autoFocus
                  />
                </div>

                {mode === 'signup' ? (
                  <NewPasswordFields password={password} confirm={confirmPassword} onPassword={setPassword} onConfirm={setConfirmPassword} label="Password" />
                ) : (
                  <div>
                    <PasswordInput
                      id="auth-password"
                      label="Password"
                      value={password}
                      onChange={setPassword}
                      autoComplete="current-password"
                      shown={showPassword}
                      onToggleShown={() => setShowPassword((v) => !v)}
                    />
                    <div className="text-right mt-1.5">
                      <button type="button" onClick={() => switchMode('reset')} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4">
                        Forgot password?
                      </button>
                    </div>
                  </div>
                )}

                {error && <Notice kind="error">{error}</Notice>}
                {success && <Notice kind="ok">{success}</Notice>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-primary text-primary-foreground font-semibold rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {loading ? 'Loading…' : mode === 'signup' ? 'Create account' : 'Sign in'}
                </button>
              </form>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => switchMode(mode === 'signup' ? 'signin' : 'signup')}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
                >
                  {mode === 'signup' ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
