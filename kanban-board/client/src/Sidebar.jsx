import { useState } from 'react';
import ProfileMenu from './ProfileMenu';

export default function Sidebar({ teams, currentTeamId, onSwitchTeam, onCreateTeam, view, onChangeView, open, onClose }) {
  const [creating, setCreating] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    await onCreateTeam(newTeamName.trim());
    setNewTeamName('');
    setCreating(false);
  };

  // On mobile the sidebar is an overlay, so picking a team or nav item
  // should close it — desktop ignores onClose's effect since the overlay
  // styling only applies under the mobile media query.
  const handleSwitchTeam = (teamId) => { onSwitchTeam(teamId); onClose(); };
  const handleChangeView = (v) => { onChangeView(v); onClose(); };

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <nav className={`sidebar${open ? ' sidebar-open' : ''}`}>
        <div className="sidebar-header-row">
          <div className="sidebar-logo">
            <svg className="sidebar-logo-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect x="1.5" y="3" width="4.5" height="14" rx="1.75" fill="var(--accent)" />
              <rect x="7.75" y="3" width="4.5" height="9" rx="1.75" fill="var(--accent)" opacity="0.7" />
              <rect x="14" y="3" width="4.5" height="11" rx="1.75" fill="var(--accent)" opacity="0.45" />
            </svg>
            <span>Kanban</span>
          </div>
          <button className="sidebar-mobile-close" onClick={onClose} aria-label="Close menu">&times;</button>
        </div>

      <div className="sidebar-section-label">Team</div>
      <ul className="sidebar-nav">
        {teams.map(team => (
          <li
            key={team._id}
            className={`sidebar-nav-item${team._id === currentTeamId ? ' sidebar-nav-item-active' : ''}`}
            onClick={() => handleSwitchTeam(team._id)}
          >
            {team.name}
          </li>
        ))}
      </ul>

      {creating ? (
        <form onSubmit={handleCreate} className="sidebar-create-team-form">
          <input
            autoFocus
            value={newTeamName}
            onChange={e => setNewTeamName(e.target.value)}
            placeholder="Team name"
          />
          <div className="sidebar-create-team-actions">
            <button type="button" className="btn-ghost btn-small" onClick={() => setCreating(false)}>Cancel</button>
            <button type="submit" className="btn-primary btn-small">Create</button>
          </div>
        </form>
      ) : (
        <button className="btn-ghost btn-small sidebar-create-team-btn" onClick={() => setCreating(true)}>
          + New team
        </button>
      )}

      {currentTeamId && (
        <>
          <div className="sidebar-section-label">Workspace</div>
          <ul className="sidebar-nav">
            <li
              className={`sidebar-nav-item${view === 'boards' ? ' sidebar-nav-item-active' : ''}`}
              onClick={() => handleChangeView('boards')}
            >
              Boards
            </li>
            <li
              className={`sidebar-nav-item${view === 'members' ? ' sidebar-nav-item-active' : ''}`}
              onClick={() => handleChangeView('members')}
            >
              Team members
            </li>
          </ul>
        </>
      )}

        <div className="sidebar-footer">
          <ProfileMenu />
        </div>
      </nav>
    </>
  );
}
