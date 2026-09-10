import { useState } from 'react';
import { useAuth } from './auth/AuthContext';

export default function EmailVerificationBanner() {
  const { user, resendVerification } = useAuth();
  const [state, setState] = useState('idle'); // 'idle' | 'sending' | 'sent' | 'error'

  if (!user || user.emailVerified) return null;

  const handleResend = async () => {
    setState('sending');
    try {
      await resendVerification();
      setState('sent');
    } catch {
      setState('error');
    }
  };

  return (
    <div className="email-verify-banner">
      <span>Verify your email address to secure your account.</span>
      {state === 'sent' ? (
        <span className="email-verify-banner-sent">Verification email sent — check your inbox.</span>
      ) : (
        <button className="link-button" onClick={handleResend} disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Resend verification email'}
        </button>
      )}
      {state === 'error' && <span className="email-verify-banner-sent">Couldn't send it — try again shortly.</span>}
    </div>
  );
}
