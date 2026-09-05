import { useEffect, useState } from 'react';
import { api } from './api';
import { getSocket } from './socket';
import ConfirmDialog from './ConfirmDialog';

export default function TeamMembers({ team }) {
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [confirmingUserId, setConfirmingUserId] = useState(null);

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

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError('');
    try {
      await api.addTeamMember(team._id, email.trim());
      setEmail('');
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleRemove = async (userId) => {
    await api.removeTeamMember(team._id, userId);
    setConfirmingUserId(null);
    load();
  };

  const confirmingMember = members.find(m => m._id === confirmingUserId);

  return (
    <div className="team-members">
      <div className="page-header">
        <h1>{team.name} — Members</h1>
      </div>
      {error && <p className="error">{error}</p>}

      {isOwner && (
        <form onSubmit={handleAdd} className="inline-form">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Add member by email"
          />
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
            {isOwner && !m.isOwner && (
              <button onClick={() => setConfirmingUserId(m._id)} className="btn-ghost btn-ghost-danger btn-small">
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {confirmingMember && (
        <ConfirmDialog
          message={`Remove ${confirmingMember.name} from ${team.name}?`}
          onConfirm={() => handleRemove(confirmingMember._id)}
          onCancel={() => setConfirmingUserId(null)}
        />
      )}
    </div>
  );
}
