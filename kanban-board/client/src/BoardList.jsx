import { useEffect, useState } from 'react';
import { api } from './api';
import ConfirmDialog from './ConfirmDialog';
import { getSocket } from './socket';

export default function BoardList({ teamId, onOpenBoard }) {
  const [boards, setBoards] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);

  const load = () => api.getBoards(teamId).then(setBoards).catch(e => setError(e.message));

  useEffect(() => { load(); }, [teamId]);

  // Live updates: another team member creating/deleting a board refreshes
  // this list without needing a manual reload.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('join:team', teamId);
    const onChanged = (payload) => { if (payload.teamId === teamId) load(); };
    socket.on('board-list:changed', onChanged);
    return () => {
      socket.emit('leave:team', teamId);
      socket.off('board-list:changed', onChanged);
    };
  }, [teamId]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.createBoard(teamId, name.trim());
      setName('');
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleDelete = async (id) => {
    await api.deleteBoard(id);
    setConfirmingId(null);
    load();
  };

  const confirmingBoard = boards.find(b => b._id === confirmingId);

  return (
    <div className="board-list">
      <div className="page-header">
        <h1>Boards</h1>
      </div>
      {error && <p className="error">{error}</p>}
      <form onSubmit={handleCreate} className="inline-form">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="New board name"
        />
        <button type="submit" className="btn-primary">Create board</button>
      </form>
      <ul>
        {boards.map(b => (
          <li key={b._id}>
            <span onClick={() => onOpenBoard(b._id)} className="board-link">{b.name}</span>
            <button onClick={() => setConfirmingId(b._id)} className="btn-ghost btn-ghost-danger">Delete</button>
          </li>
        ))}
      </ul>
      {confirmingBoard && (
        <ConfirmDialog
          message={`Delete board "${confirmingBoard.name}"? This also deletes all its columns and cards.`}
          onConfirm={() => handleDelete(confirmingBoard._id)}
          onCancel={() => setConfirmingId(null)}
        />
      )}
    </div>
  );
}
