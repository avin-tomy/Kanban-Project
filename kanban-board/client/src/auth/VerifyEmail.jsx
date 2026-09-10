import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';

export default function VerifyEmail({ token }) {
  const { verifyEmail, refreshUser } = useAuth();
  // 'pending' | 'success' | 'error'
  const [status, setStatus] = useState(token ? 'pending' : 'error');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    verifyEmail(token)
      .then(() => {
        setStatus('success');
        refreshUser();
      })
      .catch(e => {
        setError(e.message);
        setStatus('error');
      });
  }, [token]);

  return (
    <div className="auth-screen">
      <div className="auth-box">
        <h1>Verify your email</h1>
        {status === 'pending' && <p className="auth-result-message">Verifying…</p>}
        {status === 'success' && (
          <p className="auth-result-message">Your email is verified. You can close this tab or continue to the app.</p>
        )}
        {status === 'error' && (
          <p className="auth-result-message error">{error || 'This link is missing its verification token.'}</p>
        )}
        <p className="auth-switch"><a href="/">Continue to the app</a></p>
      </div>
    </div>
  );
}
