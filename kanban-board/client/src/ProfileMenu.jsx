import { useState } from 'react';
import { useAuth } from './auth/AuthContext';

export default function ProfileMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const initials = user.name.split(' ').map(w => w[0]).join('').toUpperCase();

  return (
    <div className="profile-menu">
      <button className="profile-trigger" onClick={() => setOpen(o => !o)}>
        <span className="profile-avatar">{initials}</span>
        <span className="profile-name">{user.name}</span>
        <span className="profile-caret">&#9662;</span>
      </button>
      {open && (
        <>
          <div className="profile-backdrop" onClick={() => setOpen(false)} />
          <div className="profile-dropdown">
            <div className="profile-dropdown-email">{user.email}</div>
            <button className="profile-dropdown-item" onClick={logout}>Log out</button>
          </div>
        </>
      )}
    </div>
  );
}
