import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { getSocket } from './socket';
import ConfirmDialog from './ConfirmDialog';

export default function TeamMembers({ team, onTeamDeleted }) {
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [error, setError] = useState('');
  const [confirmingUserId, setConfirmingUserId] = useState(null);
  const [confirmingDeleteTeam, setConfirmingDeleteTeam] = useState(false);
  const searchTimer = useRef(null);

  const load = () => api.getTeamMembers(team._id).then(setMembers).catch(e => setError(e.message));

  useEffect(() => { load(); }, [team._id]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('join:team', team._id);
    const onChanged = (payload) => { if (payload.teamId === team._id) load(); };
    socket.on('team:membership-changed', onChanged);
    return () => {
      socket.emit('leave:team', team._id);
      socket.off('team:membership-changed', onChanged);
    };
  }, [team._id]);

  const isOwner = team.isOwner;
  const canManage = team.role === 'owner' || team.role === 'co_owner';

  // Debounced so every keystroke doesn't fire its own request — waits for a
  // short pause in typing before asking the server for matches.
  useEffect(() => {
    clearTimeout(searchTimer.current);
    const query = email.trim();
    if (!canManage || query.length < 2) {
      setSuggestions([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      api.searchMemberCandidates(team._id, query).then(setSuggestions).catch(() => {});
    }, 250);
    return () => clearTimeout(searchTimer.current);
  }, [email, team._id, canManage]);

  // Closes the suggestions dropdown on a click outside the add-member form —
  // same pattern as the reaction picker / assignee menu elsewhere in the app.
  useEffect(() => {
    if (!suggestionsOpen) return;
    const handleClickOutside = (e) => {
      if (!e.target.closest('.member-add-form')) setSuggestionsOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [suggestionsOpen]);

  const addByEmail = async (addr) => {
    setError('');
    try {
      await api.addTeamMember(team._id, addr);
      setEmail('');
      setSuggestions([]);
      setSuggestionsOpen(false);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleAdd = (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    addByEmail(email.trim());
  };

  const handleRemove = async (userId) => {
    await api.removeTeamMember(team._id, userId);
    setConfirmingUserId(null);
    load();
  };

  const handleRoleChange = async (userId, role) => {
    try {
      await api.updateMemberRole(team._id, userId, role);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleDeleteTeam = async () => {
    await api.deleteTeam(team._id);
    setConfirmingDeleteTeam(false);
    onTeamDeleted();
  };

  const confirmingMember = members.find(m => m._id === confirmingUserId);

  return (
    <div className="team-members">
      <div className="page-header">
        <h1>{team.name} — Members</h1>
      </div>
      {error && <p className="error">{error}</p>}

      {canManage && (
        <form onSubmit={handleAdd} className="inline-form member-add-form">
          <div className="member-add-input-wrap">
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setSuggestionsOpen(true); }}
              onFocus={() => setSuggestionsOpen(true)}
              placeholder="Add member by email"
              autoComplete="off"
            />
            {suggestionsOpen && suggestions.length > 0 && (
              <ul className="member-suggestions">
                {suggestions.map(s => (
                  <li key={s._id}>
                    <button type="button" onClick={() => addByEmail(s.email)}>
                      <span className="member-suggestion-name">{s.name}</span>
                      <span className="member-suggestion-email">{s.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="submit" className="btn-primary">Add</button>
        </form>
      )}

      <ul className="member-list">
        {members.map(m => (
          <li key={m._id}>
            <span>
              {m.name} <span className="member-email">({m.email})</span>
              {m.isOwner && <span className="member-owner-badge">Owner</span>}
            </span>
            <span className="member-list-actions">
              {canManage && !m.isOwner && (
                <select
                  className="member-role-select"
                  value={m.role}
                  onChange={(e) => handleRoleChange(m._id, e.target.value)}
                  aria-label={`Role for ${m.name}`}
                >
                  <option value="co_owner">Co-owner</option>
                  {/* A co-owner can promote a member to co-owner, but only the
                      owner can demote a co-owner back to member. */}
                  <option value="member" disabled={!isOwner}>Member</option>
                </select>
              )}
              {!canManage && !m.isOwner && <span className="member-role-label">{m.role === 'co_owner' ? 'Co-owner' : 'Member'}</span>}
              {isOwner && !m.isOwner && (
                <button onClick={() => setConfirmingUserId(m._id)} className="btn-ghost btn-ghost-danger btn-small">
                  Remove
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>

      {isOwner && (
        <div className="danger-zone">
          <div>
            <h3>Delete {team.name}</h3>
            <p>Permanently removes all its boards, columns, and cards for every member.</p>
          </div>
          <button onClick={() => setConfirmingDeleteTeam(true)} className="btn-danger">Delete team</button>
        </div>
      )}

      {confirmingMember && (
        <ConfirmDialog
          message={`Remove ${confirmingMember.name} from ${team.name}?`}
          onConfirm={() => handleRemove(confirmingMember._id)}
          onCancel={() => setConfirmingUserId(null)}
        />
      )}

      {confirmingDeleteTeam && (
        <ConfirmDialog
          message={`Delete "${team.name}"? This permanently deletes all its boards, columns, and cards. This cannot be undone.`}
          onConfirm={handleDeleteTeam}
          onCancel={() => setConfirmingDeleteTeam(false)}
        />
      )}
    </div>
  );
}
