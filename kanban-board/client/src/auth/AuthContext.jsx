import { createContext, useContext, useEffect, useState } from 'react';
import { api, setAuthToken, setUnauthorizedHandler } from '../api';
import { connectSocket, disconnectSocket, getSocket } from '../socket';

const AuthContext = createContext(null);
const STORAGE_KEY = 'kanban_token';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const applySession = (token, user) => {
    localStorage.setItem(STORAGE_KEY, token);
    setAuthToken(token);
    connectSocket(token);
    setUser(user);
  };

  // Split from `logout` below: this is what an expired/invalid/revoked
  // token needs (see setUnauthorizedHandler) and never itself makes a
  // network call — logout()'s own /auth/logout request would otherwise be
  // just as likely to 401 (the whole point is that it revokes this token),
  // which would re-trigger this same handler and loop forever.
  const clearLocalSession = () => {
    localStorage.removeItem(STORAGE_KEY);
    setAuthToken(null);
    disconnectSocket();
    setUser(null);
  };

  // Tells the server to revoke this token's session (best-effort — if the
  // request fails, e.g. offline, the user shouldn't be stuck unable to log
  // out locally) before clearing local state. Without the server round
  // trip, "logout" would only ever be a client-side localStorage clear, and
  // a copied token would keep working until it happened to expire 7 days later.
  const logout = async () => {
    try { await api.logout(); } catch { /* best-effort */ }
    clearLocalSession();
  };

  const logoutAll = async () => {
    try { await api.logoutAll(); } catch { /* best-effort */ }
    clearLocalSession();
  };

  // On load, a stored token is validated (not just trusted) against /auth/me —
  // it may have expired since the last visit.
  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) { setLoading(false); return; }

    setAuthToken(token);
    api.me()
      .then(user => applySession(token, user))
      .catch(() => clearLocalSession())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clearLocalSession);
  }, []);

  // Every connected socket already sits in its own `user:<id>` room (see
  // server/index.js), so this catches the case verifyEmail→refreshUser
  // above can't: the link opened in a different tab/device than the one
  // showing the "verify your email" banner. Re-fetching rather than trusting
  // the bare event keeps this in sync with whatever else /auth/me returns.
  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    if (!socket) return;
    const onEmailVerified = () => { api.me().then(setUser).catch(() => {}); };
    socket.on('user:email-verified', onEmailVerified);
    return () => socket.off('user:email-verified', onEmailVerified);
  }, [user?._id]);

  const login = async (email, password) => {
    const { token, user } = await api.login(email, password);
    applySession(token, user);
  };

  const signup = async (email, password, name) => {
    const { token, user } = await api.signup(email, password, name);
    applySession(token, user);
  };

  const forgotPassword = (email) => api.forgotPassword(email);

  // Same shape as login/signup — a successful reset signs you straight in
  // rather than sending you to re-enter the password you just chose.
  const resetPassword = async (resetToken, password) => {
    const { token, user } = await api.resetPassword(resetToken, password);
    applySession(token, user);
  };

  // No applySession here — the token stays valid and doesn't encode the
  // password, so nothing about the current session needs to change.
  const changePassword = (currentPassword, newPassword) => api.changePassword(currentPassword, newPassword);

  const resendVerification = () => api.resendVerification();
  const verifyEmail = (token) => api.verifyEmail(token);

  // Called after a successful verify-email so a session already open in
  // this tab reflects it immediately, instead of showing the banner until
  // the next full reload. A no-op if there's no session here at all (the
  // link may have been opened on a different device).
  const refreshUser = async () => {
    if (!user) return;
    const fresh = await api.me();
    setUser(fresh);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, logoutAll, forgotPassword, resetPassword, changePassword, resendVerification, verifyEmail, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
