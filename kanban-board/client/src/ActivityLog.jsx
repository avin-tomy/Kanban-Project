import { useEffect, useState } from 'react';
import { api } from './api';
import { getSocket } from './socket';

const formatTime = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function ActivityLog({ boardId }) {
  const [open, setOpen] = useState(false);
  const [activities, setActivities] = useState([]);
  const [error, setError] = useState('');

  const load = () => api.getActivity(boardId).then(setActivities).catch(e => setError(e.message));

  useEffect(() => { load(); }, [boardId]);

  // BoardDetail already joins/leaves the board's socket room — this just
  // listens on that same connection for the activity-specific event.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onChanged = (payload) => { if (payload.boardId === boardId) load(); };
    socket.on('activity:changed', onChanged);
    return () => socket.off('activity:changed', onChanged);
  }, [boardId]);

  return (
    <div className="activity-menu">
      <button className="activity-trigger btn-ghost btn-small" onClick={() => setOpen(o => !o)}>
        Activity
      </button>
      {open && (
        <>
          <div className="presence-backdrop" onClick={() => setOpen(false)} />
          <div className="activity-dropdown">
            <div className="presence-dropdown-label">Activity (last 7 days)</div>
            {error && <p className="error">{error}</p>}
            {activities.length === 0 ? (
              <p className="activity-empty">No activity in the last 7 days.</p>
            ) : (
              <ul className="activity-list">
                {activities.map(a => (
                  <li key={a._id}>
                    <span className="activity-detail"><strong>{a.actorName}</strong> {a.detail}</span>
                    <span className="activity-time">{formatTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
