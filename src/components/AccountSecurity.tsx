import React, { useState } from 'react';
import { KeyRound, LogOut, MonitorSmartphone } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { newPasswordError } from '../lib/password';
import { NewPasswordFields, Notice, PasswordInput, ResetWithCode } from './ui/password';
import { Button } from './ui/button';

interface AccountSecurityProps {
  email: string;
  onSignOut: () => void;
}

/**
 * Email, password and sessions. Changing the password asks for the current one first (checked by signing in with
 * it), so an unlocked device is not enough to take over the account; anyone who forgot it can reset it with an
 * emailed code instead, without leaving Settings.
 */
export const AccountSecurity: React.FC<AccountSecurityProps> = ({ email, onSignOut }) => {
  const [view, setView] = useState<'idle' | 'change' | 'reset'>('idle');
  const [current, setCurrent] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const reset = () => { setCurrent(''); setPassword(''); setConfirm(''); setError(''); };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const pwError = newPasswordError(password, confirm);
    if (pwError) { setError(pwError); return; }
    if (password === current) { setError('The new password is the same as the current one.'); return; }
    setBusy(true);
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: current });
    if (authErr) {
      setBusy(false);
      setError('Your current password is not right. Try again, or reset it with an emailed code below.');
      return;
    }
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateErr) { setError(updateErr.message); return; }
    reset();
    setView('idle');
    setDone('Password changed.');
  };

  const signOutOthers = async () => {
    setError('');
    const { error: err } = await supabase.auth.signOut({ scope: 'others' });
    if (err) setError(err.message);
    else setDone('Signed out on every other device. This one stays signed in.');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">Signed in as</div>
          <div className="text-sm font-medium truncate">{email}</div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => void signOutOthers()} className="min-h-[40px]">
            <MonitorSmartphone className="w-4 h-4 mr-2" /> Sign out other devices
          </Button>
          <Button variant="outline" onClick={onSignOut} className="min-h-[40px]">
            <LogOut className="w-4 h-4 mr-2" /> Sign out
          </Button>
        </div>
      </div>

      {done && view === 'idle' && <Notice kind="ok">{done}</Notice>}

      {view === 'idle' && (
        <Button variant="outline" onClick={() => { setDone(''); reset(); setView('change'); }} className="min-h-[40px]">
          <KeyRound className="w-4 h-4 mr-2" /> Change password
        </Button>
      )}

      {view === 'change' && (
        <form onSubmit={changePassword} className="space-y-4 max-w-md">
          <PasswordInput
            label="Current password"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
            shown={showCurrent}
            onToggleShown={() => setShowCurrent((v) => !v)}
          />
          <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
          {error && <Notice kind="error">{error}</Notice>}
          <div className="flex items-center gap-2 flex-wrap">
            <Button type="submit" disabled={busy || !current || !password || !confirm} className="min-h-[40px]">{busy ? 'Saving…' : 'Change password'}</Button>
            <Button type="button" variant="ghost" onClick={() => { reset(); setView('idle'); }} className="min-h-[40px]">Cancel</Button>
          </div>
          <button type="button" onClick={() => { reset(); setView('reset'); }} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4">
            Forgot your current password? Reset it with an emailed code
          </button>
        </form>
      )}

      {view === 'reset' && (
        <div className="max-w-md">
          <ResetWithCode
            email={email}
            lockEmail
            onDone={() => { setView('idle'); setDone('Password changed with the emailed code.'); }}
            onCancel={() => setView('idle')}
            cancelLabel="Cancel"
          />
        </div>
      )}
      {error && view === 'idle' && <Notice kind="error">{error}</Notice>}
    </div>
  );
};
