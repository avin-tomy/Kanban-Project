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
  const [filterBy, setFilterBy] = useState('all');

  useEffect(() => {
    api.getMyAssignedCards().then(setTasks).catch(e => setError(e.message));
  }, []);

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    if (filterBy === 'all') return tasks;
    return tasks.filter(t => (t.status || 'not_started') === filterBy);
  }, [tasks, filterBy]);

  // Sorting by status is meaningless once a single status is filtered to —
  // every remaining task would already share it — so that option only makes
  // sense against "All", and picking a narrower filter falls back to due date.
  const effectiveSortBy = filterBy === 'all' ? sortBy : 'dueDate';
  const sortedTasks = useMemo(() => sortTasks(filteredTasks, effectiveSortBy), [filteredTasks, effectiveSortBy]);

  const handleFilterChange = (value) => {
    setFilterBy(value);
    if (value !== 'all') setSortBy('dueDate');
  };

  if (!tasks) return <p>{error || 'Loading…'}</p>;

  return (
    <div className="my-tasks">
      <div className="page-header">
        <h1>My Tasks</h1>
        {tasks.length > 0 && (
          <div className="task-controls">
            <select className="task-filter-select" value={filterBy} onChange={e => handleFilterChange(e.target.value)} aria-label="Filter tasks by status">
              <option value="all">All</option>
              <option value="not_started">Not started</option>
              <option value="working">Working</option>
              <option value="completed">Completed</option>
            </select>
            <select className="task-sort-select" value={effectiveSortBy} onChange={e => setSortBy(e.target.value)} aria-label="Sort tasks by" disabled={filterBy !== 'all'}>
              <option value="dueDate">Sort by due date</option>
              <option value="status" disabled={filterBy !== 'all'}>Sort by status</option>
            </select>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {tasks.length === 0 ? (
        <div className="empty-state">
          <p>No cards are assigned to you right now.</p>
        </div>
      ) : sortedTasks.length === 0 ? (
        <div className="empty-state">
          <p>No {STATUS_LABELS[filterBy]?.toLowerCase()} tasks.</p>
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
                <span className="task-due-group">
                  <span className={`task-status task-status-${t.status || 'not_started'}`}>
                    {STATUS_LABELS[t.status || 'not_started']}
                  </span>
                  {t.dueDate && <span className="task-due">{formatDate(t.dueDate)}</span>}
                </span>
                {t.dueDate && (
                  <span className={`task-days-left ${dueDateStatus(t.dueDate)}`}>{daysLeftLabel(t.dueDate)}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
