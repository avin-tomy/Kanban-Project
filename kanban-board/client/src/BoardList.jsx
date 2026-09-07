import { useEffect, useState } from 'react';
import { api } from './api';
import ConfirmDialog from './ConfirmDialog';
import { getSocket } from './socket';

export default function BoardList({ teamId, onOpenBoard, role }) {
  const canManage = role === 'owner' || role === 'co_owner';
  const isOwner = role === 'owner';
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

  // Shows the new board immediately with a temp id, swapped for the real
  // one once the create request resolves — same shape as card/column/note
  // creation elsewhere in the app.
  const handleCreate = async (e) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const tempId = `temp-${Date.now()}`;
    setBoards(prev => [...prev, { _id: tempId, name: trimmedName, teamId }]);
    setName('');

    try {
      const created = await api.createBoard(teamId, trimmedName);
      setBoards(prev => prev.map(b => (b._id === tempId ? created : b)));
    } catch (e) {
      setError(e.message);
      setBoards(prev => prev.filter(b => b._id !== tempId));
    }
  };

  const handleDelete = async (id) => {
    setBoards(prev => prev.filter(b => b._id !== id));
    setConfirmingId(null);
    try {
      await api.deleteBoard(id);
    } catch (e) {
      setError(e.message);
      load();
    }
  };

  const confirmingBoard = boards.find(b => b._id === confirmingId);

  return (
    <div className="board-list">
      <div className="page-header">
        <h1>Boards</h1>
      </div>
      {error && <p className="error">{error}</p>}
      {canManage && (
        <form onSubmit={handleCreate} className="inline-form">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="New board name"
          />
          <button type="submit" className="btn-primary">Create board</button>
        </form>
      )}
      <ul>
        {boards.map(b => (
          <li key={b._id}>
            <span onClick={() => onOpenBoard(b._id)} className="board-link">{b.name}</span>
            {isOwner && (
              <button onClick={() => setConfirmingId(b._id)} className="btn-ghost btn-ghost-danger">Delete</button>
            )}
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
