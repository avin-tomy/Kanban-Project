import { useState } from 'react';
import { useAuth } from './AuthContext';

export default function ForgotPassword({ onBackToLogin }) {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Holds the server's response once submitted — always shown, regardless
  // of whether the email actually has an account, so this page can't be
  // used to check who's registered.
  const [result, setResult] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await forgotPassword(email);
      setResult(response);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-box">
        <h1>Reset your password</h1>
        {error && <p className="error">{error}</p>}
        {result ? (
          <>
            <p>{result.message}</p>
            {result.devResetLink && (
              <div className="dev-reset-link">
                <p className="dev-reset-link-label">Dev mode — no email is actually sent yet:</p>
                <a href={result.devResetLink}>{result.devResetLink}</a>
              </div>
            )}
          </>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email"
              autoComplete="email"
              required
            />
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}
        <p className="auth-switch">
          <button type="button" className="link-button" onClick={onBackToLogin}>Back to log in</button>
        </p>
      </div>
    </div>
  );
}
