import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { dueDateStatus, daysLeftLabel } from './dateUtils';

const formatDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const STATUS_LABELS = { not_started: 'Not started', working: 'Working', completed: 'Completed' };
const STATUS_ORDER = { not_started: 0, working: 1, completed: 2 };

// Undated tasks always sort after dated ones, regardless of which primary
// sort is active — there's no due date to rank them by.
function compareByDueDate(a, b) {
  if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return 0;
}

function sortTasks(tasks, sortBy) {
  const sorted = [...tasks];
  if (sortBy === 'status') {
    sorted.sort((a, b) => {
      const rankDiff = STATUS_ORDER[a.status || 'not_started'] - STATUS_ORDER[b.status || 'not_started'];
      return rankDiff !== 0 ? rankDiff : compareByDueDate(a, b);
    });
  } else {
    sorted.sort(compareByDueDate);
  }
  return sorted;
}

export default function MyTasks({ onOpenTask }) {
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('dueDate');

  useEffect(() => {
    api.getMyAssignedCards().then(setTasks).catch(e => setError(e.message));
  }, []);

  const sortedTasks = useMemo(() => (tasks ? sortTasks(tasks, sortBy) : []), [tasks, sortBy]);

  if (!tasks) return <p>{error || 'Loading…'}</p>;

  return (
    <div className="my-tasks">
      <div className="page-header">
        <h1>My Tasks</h1>
        {tasks.length > 0 && (
          <select className="task-sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Sort tasks by">
            <option value="dueDate">Sort by due date</option>
            <option value="status">Sort by status</option>
          </select>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {tasks.length === 0 ? (
        <div className="empty-state">
          <p>No cards are assigned to you right now.</p>
        </div>
      ) : (
        <ul className="task-list">
          {sortedTasks.map(t => (
            <li key={t._id} className="task-item" onClick={() => onOpenTask(t.teamId, t.boardId)}>
              <div className="task-main">
                <p className="task-title">{t.title}</p>
                <p className="task-meta">{t.teamName} &rsaquo; {t.boardName} &rsaquo; {t.columnName}</p>
              </div>
              <div className="task-side">
                <span className={`task-status task-status-${t.status || 'not_started'}`}>
                  {STATUS_LABELS[t.status || 'not_started']}
                </span>
                {t.dueDate && (
                  <span className="task-due-group">
                    <span className="task-due">{formatDate(t.dueDate)}</span>
                    <span className={`task-days-left ${dueDateStatus(t.dueDate)}`}>{daysLeftLabel(t.dueDate)}</span>
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
