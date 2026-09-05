import { useState } from 'react';
import ProfileMenu from './ProfileMenu';

export default function Sidebar({ teams, currentTeamId, onSwitchTeam, onCreateTeam, view, onChangeView }) {
  const [creating, setCreating] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    await onCreateTeam(newTeamName.trim());
    setNewTeamName('');
    setCreating(false);
  };

  return (
    <nav className="sidebar">
      <div className="sidebar-logo">Kanban</div>

      <div className="sidebar-section-label">Team</div>
      <ul className="sidebar-nav">
        {teams.map(team => (
          <li
            key={team._id}
            className={`sidebar-nav-item${team._id === currentTeamId ? ' sidebar-nav-item-active' : ''}`}
            onClick={() => onSwitchTeam(team._id)}
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
              onClick={() => onChangeView('boards')}
            >
              Boards
            </li>
            <li
              className={`sidebar-nav-item${view === 'members' ? ' sidebar-nav-item-active' : ''}`}
              onClick={() => onChangeView('members')}
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
  );
}
