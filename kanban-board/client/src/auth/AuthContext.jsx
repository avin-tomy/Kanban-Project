import { createContext, useContext, useEffect, useState } from 'react';
import { api, setAuthToken, setUnauthorizedHandler } from '../api';
import { connectSocket, disconnectSocket } from '../socket';

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

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setAuthToken(null);
    disconnectSocket();
    setUser(null);
  };

  // On load, a stored token is validated (not just trusted) against /auth/me —
  // it may have expired since the last visit.
  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) { setLoading(false); return; }

    setAuthToken(token);
    api.me()
      .then(user => applySession(token, user))
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, []);

  const login = async (email, password) => {
    const { token, user } = await api.login(email, password);
    applySession(token, user);
  };

  const signup = async (email, password, name) => {
    const { token, user } = await api.signup(email, password, name);
    applySession(token, user);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
