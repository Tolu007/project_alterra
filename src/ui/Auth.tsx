import { useState, type FormEvent } from 'react';
import { api, type Account } from '../net/api';

/** Create an account or log in, to play in the shared world. */
export function Auth({ onDone, onBack }: { onDone: (a: Account) => void; onBack: () => void }) {
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = mode === 'signup' ? await api.signup(name, email, password) : await api.login(email, password);
      onDone(r.account);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="wrap auth">
      <button className="btn btn-small" onClick={onBack}>
        ← Back
      </button>
      <h1 className="h-display">{mode === 'signup' ? 'Join the shared Naija' : 'Welcome back'}</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        One world for everybody: the same economy, the same elections, other players on the same streets. Your name is your character’s name.
      </p>
      <div className="auth-tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>
          Create account
        </button>
        <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
          Log in
        </button>
      </div>
      <form className="card auth-card" onSubmit={submit}>
        <div className="card-body auth-fields">
          {mode === 'signup' && (
            <label>
              <span>Name</span>
              <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="e.g. Bisola Adeyemi" maxLength={40} required />
            </label>
          )}
          <label>
            <span>Email</span>
            <input className="text-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required />
          </label>
          <label>
            <span>Password</span>
            <input
              className="text-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
              minLength={mode === 'signup' ? 8 : undefined}
              required
            />
          </label>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-danfo" type="submit" disabled={busy}>
            {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Log in'}
          </button>
        </div>
      </form>
    </main>
  );
}
