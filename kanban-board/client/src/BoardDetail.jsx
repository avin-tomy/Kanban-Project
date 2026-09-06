import { useEffect, useState } from 'react';
import { DndContext, useDroppable, rectIntersection } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from './api';
import ConfirmDialog from './ConfirmDialog';
import NotesPanel from './NotesPanel';
import ActivityLog from './ActivityLog';
import { getSocket } from './socket';
import { dueDateStatus, isPastDue, daysLeftLabel } from './dateUtils';

// Columns get their own sortable identity distinct from their id as a card
// drop-zone (see the Column component) — dnd-kit can't register the same id
// as two different droppables, so column-reordering needs a namespaced id.
const columnSortableId = (columnId) => `col-sort-${columnId}`;

// One DndContext handles both card drags and column drags, so collision
// detection has to be told which one is active: while dragging a column,
// only other columns should ever be considered as a drop target — otherwise
// the pointer passing over a card mid-drag would register as "over" that
// card instead of the column it's actually in.
const collisionDetectionStrategy = (args) => {
  if (args.active.data.current?.type === 'column') {
    const columnContainers = args.droppableContainers.filter(c => c.data.current?.type === 'column');
    return rectIntersection({ ...args, droppableContainers: columnContainers });
  }
  return rectIntersection(args);
};

export default function BoardDetail({ boardId, onBack }) {
  const [board, setBoard] = useState(null);
  const [newColumnName, setNewColumnName] = useState('');
  const [error, setError] = useState('');
  const [presentUsers, setPresentUsers] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);

  const load = () => api.getBoardFull(boardId).then(setBoard).catch(e => setError(e.message));

  useEffect(() => { load(); }, [boardId]);

  // Card assignment needs the board's own team roster (who's even eligible
  // to be assigned) — fetched once the board tells us which team it's in.
  useEffect(() => {
    if (!board?.teamId) return;
    api.getTeamMembers(board.teamId).then(setTeamMembers).catch(() => {});
  }, [board?.teamId]);

  // Live updates: any column/card change another team member makes to this
  // board refreshes it here too, without a manual reload. The server also
  // broadcasts who currently has this same board open, keyed off the same
  // join/leave — see index.js's boardPresence tracking.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('join:board', boardId);
    const onChanged = (payload) => { if (payload.boardId === boardId) load(); };
    const onPresence = (payload) => { if (payload.boardId === boardId) setPresentUsers(payload.users); };
    socket.on('board:changed', onChanged);
    socket.on('board:presence', onPresence);
    return () => {
      socket.emit('leave:board', boardId);
      socket.off('board:changed', onChanged);
      socket.off('board:presence', onPresence);
      setPresentUsers([]);
    };
  }, [boardId]);

  const handleAddColumn = async (e) => {
    e.preventDefault();
    if (!newColumnName.trim()) return;
    await api.createColumn(boardId, newColumnName.trim());
    setNewColumnName('');
    load();
  };

  const handleDeleteColumn = async (columnId) => {
    await api.deleteColumn(columnId);
    load();
  };

  const handleDeleteCard = async (cardId) => {
    await api.deleteCard(cardId);
    load();
  };

  // Shows the new card immediately with a temporary id, instead of waiting
  // on the create request AND then a full board refetch before it appears —
  // that double round-trip is what made adding a card feel laggy. The temp
  // card gets swapped for the real one (real id, server-assigned position)
  // once the request resolves; on failure it's just dropped via a resync.
  const handleAddCard = async (columnId, title) => {
    const tempId = `temp-${Date.now()}`;
    const tempCard = { _id: tempId, columnId, title, description: '', createdAt: new Date().toISOString() };
    setBoard(prev => ({
      ...prev,
      columns: prev.columns.map(col => (col._id === columnId ? { ...col, cards: [...col.cards, tempCard] } : col)),
    }));

    try {
      const created = await api.createCard(columnId, title);
      setBoard(prev => ({
        ...prev,
        columns: prev.columns.map(col => (col._id === columnId
          ? { ...col, cards: col.cards.map(c => (c._id === tempId ? created : c)) }
          : col)),
      }));
    } catch (e) {
      setError(e.message);
      load();
    }
  };

  // Optimistic, same as handleAddCard: we already know the assignee's name
  // (from the fetched team roster), so there's nothing to wait on the
  // server for before showing it.
  const handleAssignCard = async (cardId, assigneeId) => {
    const assigneeName = assigneeId ? (teamMembers.find(m => m._id === assigneeId)?.name ?? null) : null;
    setBoard(prev => ({
      ...prev,
      columns: prev.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => (c._id === cardId ? { ...c, assigneeId, assigneeName } : c)),
      })),
    }));

    try {
      await api.updateCard(cardId, { assigneeId });
    } catch (e) {
      setError(e.message);
      load();
    }
  };

  const handleSetDueDate = async (cardId, dueDate) => {
    setBoard(prev => ({
      ...prev,
      columns: prev.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => (c._id === cardId ? { ...c, dueDate } : c)),
      })),
    }));

    try {
      await api.updateCard(cardId, { dueDate });
    } catch (e) {
      setError(e.message);
      load();
    }
  };

  const handleSetStatus = async (cardId, status) => {
    setBoard(prev => ({
      ...prev,
      columns: prev.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => (c._id === cardId ? { ...c, status } : c)),
      })),
    }));

    try {
      await api.updateCard(cardId, { status });
    } catch (e) {
      setError(e.message);
      load();
    }
  };

  const findColumnOf = (cardId) => board.columns.find(col => col.cards.some(c => c._id === cardId));

  // Fires continuously while a card is dragged over something. dnd-kit's
  // per-item transform (from useSortable) only tracks the pointer correctly
  // for items that already belong to the SortableContext being hovered — so
  // a cross-column drag needs the card actually moved into the target
  // column's array in local state as soon as it crosses the boundary, not
  // just at drop time. Without this, the card's transform freezes the moment
  // it leaves its source column instead of following the cursor into the
  // next one.
  const handleDragOver = ({ active, over }) => {
    if (!over || active.data.current?.type === 'column') return;

    const cardId = active.id;
    const sourceColumn = findColumnOf(cardId);
    const overIsColumn = board.columns.some(c => c._id === over.id);
    const targetColumnId = overIsColumn ? over.id : over.data.current?.columnId;
    if (!sourceColumn || !targetColumnId || sourceColumn._id === targetColumnId) return;

    setBoard(prev => {
      const prevSource = prev.columns.find(c => c._id === sourceColumn._id);
      const prevTarget = prev.columns.find(c => c._id === targetColumnId);
      const draggedCard = prevSource.cards.find(c => c._id === cardId);
      if (!draggedCard) return prev;

      const insertIndex = overIsColumn
        ? prevTarget.cards.length
        : Math.max(prevTarget.cards.findIndex(c => c._id === over.id), 0);
      const targetCards = [...prevTarget.cards];
      targetCards.splice(insertIndex, 0, draggedCard);

      return {
        ...prev,
        columns: prev.columns.map(col => {
          if (col._id === sourceColumn._id) return { ...col, cards: col.cards.filter(c => c._id !== cardId) };
          if (col._id === targetColumnId) return { ...col, cards: targetCards };
          return col;
        }),
      };
    });
  };

  // Fires when a dragged card is released. By this point handleDragOver has
  // already relocated the card into whichever column it's currently hovering
  // (if any cross-column move happened), so this only ever needs to do a
  // same-column reorder — a plain arrayMove — and persist that column's
  // final order.
  const handleDragEnd = async ({ active, over }) => {
    if (!over) { load(); return; }

    if (active.data.current?.type === 'column') {
      const activeColumnId = active.data.current.columnId;
      const overColumnId = over.data.current?.columnId;
      if (!overColumnId || activeColumnId === overColumnId) return;

      const oldIndex = board.columns.findIndex(c => c._id === activeColumnId);
      const newIndex = board.columns.findIndex(c => c._id === overColumnId);
      if (oldIndex === -1 || newIndex === -1) return;

      const finalOrder = arrayMove(board.columns, oldIndex, newIndex);
      setBoard(prev => ({ ...prev, columns: finalOrder }));

      try {
        await api.reorderColumns(boardId, finalOrder.map(c => c._id));
      } catch (e) {
        setError(e.message);
        load();
      }
      return;
    }

    const cardId = active.id;
    const column = findColumnOf(cardId);
    if (!column) { load(); return; }

    const overIsColumn = board.columns.some(c => c._id === over.id);
    const oldIndex = column.cards.findIndex(c => c._id === cardId);
    const newIndex = overIsColumn ? column.cards.length - 1 : column.cards.findIndex(c => c._id === over.id);
    if (oldIndex === -1 || newIndex === -1) { load(); return; }

    const finalOrder = arrayMove(column.cards, oldIndex, newIndex);

    // Apply the drop to local state immediately (optimistic update) so the
    // card lands where you dropped it right away, instead of snapping back
    // to its old slot while we wait on the network, then jumping again once
    // a full reload comes back.
    setBoard(prev => ({
      ...prev,
      columns: prev.columns.map(col => (col._id === column._id ? { ...col, cards: finalOrder } : col)),
    }));

    try {
      await api.reorderColumnCards(column._id, finalOrder.map(c => c._id));
    } catch (e) {
      setError(e.message);
      load(); // resync with the server since the optimistic update may be wrong
    }
  };

  // If a drag is aborted (e.g. Escape) after handleDragOver already moved a
  // card between columns locally, nothing was persisted — resync with the
  // server so the UI doesn't show a move that never happened.
  const handleDragCancel = () => load();

  if (!board) return <p>{error || 'Loading...'}</p>;

  return (
    <div className="board-detail">
      <button onClick={onBack} className="back-button btn-ghost btn-small">&larr; Back to boards</button>
      <div className="page-header">
        <h1>{board.name}</h1>
        <div className="page-header-actions">
          <ActivityLog boardId={boardId} />
          <PresenceList users={presentUsers} />
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <form onSubmit={handleAddColumn} className="inline-form">
        <input
          value={newColumnName}
          onChange={e => setNewColumnName(e.target.value)}
          placeholder="New column name"
        />
        <button type="submit" className="btn-primary">Add column</button>
      </form>
      <div className="board-body">
        <DndContext
          collisionDetection={collisionDetectionStrategy}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={board.columns.map(c => columnSortableId(c._id))} strategy={horizontalListSortingStrategy}>
            <div className="columns">
              {board.columns.map(col => (
                <Column
                  key={col._id}
                  column={col}
                  onChange={load}
                  onAddCard={handleAddCard}
                  onDeleteColumn={handleDeleteColumn}
                  onDeleteCard={handleDeleteCard}
                  onAssignCard={handleAssignCard}
                  onSetDueDate={handleSetDueDate}
                  onSetStatus={handleSetStatus}
                  teamMembers={teamMembers}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <NotesPanel boardId={boardId} />
      </div>
    </div>
  );
}

const initialsOf = (name) => name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

// Two different people can share a name (or just initials), which made
// same-named users look like one duplicated entry even though they were
// already being tracked correctly. A per-user color, hashed from their id,
// makes them visually distinct regardless of what their name looks like.
const PRESENCE_COLORS = ['#5b8def', '#e07a5f', '#81b29a', '#f2cc8f', '#9d4edd', '#ef476f', '#2ec4b6', '#ff9f1c'];

function colorForUserId(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
}

function PresenceList({ users }) {
  const [open, setOpen] = useState(false);
  if (!users.length) return null;
  const shown = users.slice(0, 5);
  const overflow = users.length - shown.length;

  return (
    <div className="presence-menu">
      <button className="presence-trigger" onClick={() => setOpen(o => !o)} aria-label="Show who's viewing this board">
        {shown.map(u => (
          <span
            key={u.userId}
            className="presence-avatar"
            style={{ background: colorForUserId(u.userId) }}
            title={u.email ? `${u.name} (${u.email})` : u.name}
          >
            {initialsOf(u.name)}
          </span>
        ))}
        {overflow > 0 && <span className="presence-avatar presence-avatar-more">+{overflow}</span>}
      </button>
      {open && (
        <>
          <div className="presence-backdrop" onClick={() => setOpen(false)} />
          <div className="presence-dropdown">
            <div className="presence-dropdown-label">Currently viewing ({users.length})</div>
            <ul className="presence-dropdown-list">
              {users.map(u => (
                <li key={u.userId}>
                  <span className="presence-avatar presence-avatar-small" style={{ background: colorForUserId(u.userId) }}>
                    {initialsOf(u.name)}
                  </span>
                  <span className="presence-dropdown-name">
                    {u.name}
                    {u.email && <span className="presence-dropdown-email">{u.email}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function Column({ column, onChange, onAddCard, onDeleteColumn, onDeleteCard, onAssignCard, onSetDueDate, onSetStatus, teamMembers }) {
  const [title, setTitle] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // This id is only for cards being dropped onto the column's empty body —
  // distinct from the column's own sortable identity below, since dnd-kit
  // can't register the same id as two separate droppables.
  const { setNodeRef, isOver } = useDroppable({
    id: column._id,
    data: { type: 'column-dropzone', columnId: column._id },
  });
  const {
    setNodeRef: setSortableRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: columnSortableId(column._id), data: { type: 'column', columnId: column._id } });

  // CSS.Transform includes a scaleX/scaleY meant to smooth transitions
  // between same-sized siblings — fine for cards (uniform width, similar
  // height) but columns can have very different heights depending on how
  // many cards each has, so that scale visibly stretched/squished the
  // dragged column. CSS.Translate drops the scale and keeps only the move.
  const wrapperStyle = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const handleAddCard = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    onAddCard(column._id, title.trim());
    setTitle('');
  };

  const cardIds = column.cards.map(c => c._id);

  return (
    <div ref={setSortableRef} style={wrapperStyle} className={`column-wrapper${isDragging ? ' column-wrapper-dragging' : ''}`}>
      <form onSubmit={handleAddCard} className="inline-form add-card-form">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="New card title"
        />
        <button type="submit" className="btn-primary btn-small">Add</button>
      </form>
      <div ref={setNodeRef} className={`column${isOver ? ' column-over' : ''}`}>
        <div className="column-header">
          <h3 className="column-drag-handle" {...attributes} {...listeners}>{column.name}</h3>
          <button onClick={() => setConfirmingDelete(true)} className="btn-ghost btn-ghost-danger btn-small">Delete</button>
        </div>
        {confirmingDelete && (
          <ConfirmDialog
            message={`Delete column "${column.name}"? This also deletes all its cards.`}
            onConfirm={() => onDeleteColumn(column._id)}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {column.cards.map(card => (
            <Card
              key={card._id}
              card={card}
              columnId={column._id}
              onDelete={onDeleteCard}
              onUpdate={onChange}
              onAssign={onAssignCard}
              onSetDueDate={onSetDueDate}
              onSetStatus={onSetStatus}
              teamMembers={teamMembers}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

const STATUS_LABELS = { not_started: 'Not started', working: 'Working', completed: 'Completed' };

const formatCreatedDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });

function Card({ card, columnId, onDelete, onUpdate, onAssign, onSetDueDate, onSetStatus, teamMembers }) {
  const [confirming, setConfirming] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(card.description);
  const [descExpanded, setDescExpanded] = useState(false);
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card._id,
    data: { columnId },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const startEditing = () => {
    setDescDraft(card.description);
    setEditingDesc(true);
  };

  const handleSaveDescription = async () => {
    await api.updateCard(card._id, { description: descDraft });
    setEditingDesc(false);
    onUpdate();
  };

  const missedDeadline = isPastDue(card.dueDate) && card.status !== 'completed';
  const isCompleted = card.status === 'completed';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card${isDragging ? ' card-dragging' : ''}${missedDeadline ? ' card-missed-deadline' : ''}${isCompleted ? ' card-completed' : ''}`}
    >
      <div className="card-header-row">
        <div className="card-drag-handle" {...listeners} {...attributes}>
          <p className="card-title">{card.title}</p>
        </div>
        <select
          className={`card-status card-status-${card.status || 'not_started'}`}
          value={card.status || 'not_started'}
          onChange={(e) => onSetStatus(card._id, e.target.value)}
          aria-label="Card status"
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      {card.description && !editingDesc && (
        <p
          className={`card-description${descExpanded ? '' : ' card-description-clamped'}`}
          onClick={() => setDescExpanded(x => !x)}
        >
          {card.description}
        </p>
      )}
      {editingDesc && (
        <div className="card-desc-edit">
          <textarea
            value={descDraft}
            onChange={e => setDescDraft(e.target.value)}
            placeholder="Add a description..."
            rows={3}
          />
          <div className="card-desc-actions">
            <button onClick={() => setEditingDesc(false)} className="btn-ghost btn-small">Cancel</button>
            <button onClick={handleSaveDescription} className="btn-primary btn-small">Save</button>
          </div>
        </div>
      )}
      <div className="card-actions">
        <div className="card-actions-row">
          <div className="card-assignee">
            <button
              className="card-assignee-trigger"
              onClick={() => setAssigneeMenuOpen(o => !o)}
              aria-label={card.assigneeName ? `Assigned to ${card.assigneeName}` : 'Assign this card'}
            >
              {card.assigneeId ? (
                <span className="presence-avatar card-assignee-avatar" style={{ background: colorForUserId(card.assigneeId) }}>
                  {initialsOf(card.assigneeName || '?')}
                </span>
              ) : (
                <span className="card-assignee-empty">+</span>
              )}
              {card.assigneeName && <span className="reaction-tooltip card-assignee-tooltip">{card.assigneeName}</span>}
            </button>
            {assigneeMenuOpen && (
              <>
                <div className="profile-backdrop" onClick={() => setAssigneeMenuOpen(false)} />
                <div className="card-assignee-menu">
                  <button
                    className="card-assignee-option"
                    onClick={() => { onAssign(card._id, null); setAssigneeMenuOpen(false); }}
                  >
                    Unassigned
                  </button>
                  {teamMembers.map(m => (
                    <button
                      key={m._id}
                      className="card-assignee-option"
                      onClick={() => { onAssign(card._id, m._id); setAssigneeMenuOpen(false); }}
                    >
                      <span className="presence-avatar card-assignee-avatar" style={{ background: colorForUserId(m._id) }}>
                        {initialsOf(m.name)}
                      </span>
                      {m.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {card.createdAt && (
            <span className="card-created-date" title={`Created ${new Date(card.createdAt).toLocaleString()}`}>
              {formatCreatedDate(card.createdAt)}
            </span>
          )}
          <input
            type="date"
            className={`card-due-date ${dueDateStatus(card.dueDate)}`}
            value={card.dueDate ? card.dueDate.slice(0, 10) : ''}
            min={card.createdAt ? card.createdAt.slice(0, 10) : undefined}
            onChange={(e) => onSetDueDate(card._id, e.target.value || null)}
            aria-label="Due date"
          />
          {card.dueDate && (
            <span className={`card-days-left ${dueDateStatus(card.dueDate)}`}>
              {daysLeftLabel(card.dueDate)}
            </span>
          )}
        </div>
        <div className="card-actions-row">
          <button onClick={startEditing} className="btn-ghost btn-small">
            {card.description ? 'Edit description' : 'Add description'}
          </button>
          <button onClick={() => setConfirming(true)} className="icon-btn" aria-label="Delete card">&times;</button>
        </div>
      </div>
      {confirming && (
        <ConfirmDialog
          message={`Delete card "${card.title}"?`}
          onConfirm={() => onDelete(card._id)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
