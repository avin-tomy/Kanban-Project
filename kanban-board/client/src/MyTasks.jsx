import { useEffect, useState } from 'react';
import { api } from './api';
import { dueDateStatus } from './dateUtils';

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export default function MyTasks({ onOpenTask }) {
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getMyAssignedCards().then(setTasks).catch(e => setError(e.message));
  }, []);

  if (!tasks) return <p>{error || 'Loading…'}</p>;

  return (
    <div className="my-tasks">
      <div className="page-header">
        <h1>My Tasks</h1>
      </div>
      {error && <p className="error">{error}</p>}
      {tasks.length === 0 ? (
        <div className="empty-state">
          <p>No cards are assigned to you right now.</p>
        </div>
      ) : (
        <ul className="task-list">
          {tasks.map(t => (
            <li key={t._id} className="task-item" onClick={() => onOpenTask(t.teamId, t.boardId)}>
              <div className="task-main">
                <p className="task-title">{t.title}</p>
                <p className="task-meta">{t.teamName} &rsaquo; {t.boardName} &rsaquo; {t.columnName}</p>
              </div>
              {t.dueDate && (
                <span className={`task-due ${dueDateStatus(t.dueDate)}`}>{formatDate(t.dueDate)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
