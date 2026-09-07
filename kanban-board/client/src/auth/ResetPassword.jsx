import { useState } from 'react';
import { useAuth } from './AuthContext';

export default function ResetPassword({ token }) {
  const { resetPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      // No router here (the rest of the app deliberately has none either) —
      // a full reload is the simplest way back to a plain "/" the app
      // recognizes, and the session set above is already in localStorage
      // by the time this runs.
      window.location.href = '/';
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="auth-screen">
        <div className="auth-box">
          <h1>Reset your password</h1>
          <p className="error">This link is missing its reset token.</p>
          <p className="auth-switch"><a href="/">Back to log in</a></p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-box">
        <h1>Choose a new password</h1>
        {error && <p className="error">{error}</p>}
        <form onSubmit={handleSubmit} className="auth-form">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="New password (min 8 characters)"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Resetting…' : 'Reset password'}
          </button>
        </form>
      </div>
    </div>
  );
}
