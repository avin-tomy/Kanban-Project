import { useEffect, useState } from 'react';
import { DndContext, useDroppable, rectIntersection } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from './api';
import ConfirmDialog from './ConfirmDialog';
import { getSocket } from './socket';

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

  const load = () => api.getBoardFull(boardId).then(setBoard).catch(e => setError(e.message));

  useEffect(() => { load(); }, [boardId]);

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
        <PresenceList users={presentUsers} />
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
                onDeleteColumn={handleDeleteColumn}
                onDeleteCard={handleDeleteCard}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

const initialsOf = (name) => name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

function PresenceList({ users }) {
  if (!users.length) return null;
  const shown = users.slice(0, 5);
  const overflow = users.length - shown.length;

  return (
    <div className="presence-list">
      {shown.map(u => (
        <span key={u.userId} className="presence-avatar" title={u.name}>{initialsOf(u.name)}</span>
      ))}
      {overflow > 0 && (
        <span className="presence-avatar presence-avatar-more" title={users.slice(5).map(u => u.name).join(', ')}>
          +{overflow}
        </span>
      )}
    </div>
  );
}

function Column({ column, onChange, onDeleteColumn, onDeleteCard }) {
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

  const handleAddCard = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    await api.createCard(column._id, title.trim());
    setTitle('');
    onChange();
  };

  const cardIds = column.cards.map(c => c._id);

  return (
    <div ref={setSortableRef} style={wrapperStyle} className={`column-wrapper${isDragging ? ' column-wrapper-dragging' : ''}`}>
      <div ref={setNodeRef} className={`column${isOver ? ' column-over' : ''}`}>
        <div className="column-header">
          <h3 className="column-drag-handle" {...attributes} {...listeners}>{column.name}</h3>
          <button onClick={() => setConfirmingDelete(true)} className="btn-ghost btn-small">Delete</button>
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
            <Card key={card._id} card={card} columnId={column._id} onDelete={onDeleteCard} onUpdate={onChange} />
          ))}
        </SortableContext>
      </div>
      <form onSubmit={handleAddCard} className="inline-form add-card-form">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="New card title"
        />
        <button type="submit" className="btn-primary btn-small">Add</button>
      </form>
    </div>
  );
}

function Card({ card, columnId, onDelete, onUpdate }) {
  const [confirming, setConfirming] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(card.description);
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card${isDragging ? ' card-dragging' : ''}`}
    >
      <div className="card-drag-handle" {...listeners} {...attributes}>
        <p className="card-title">{card.title}</p>
        {card.description && !editingDesc && <p className="card-description">{card.description}</p>}
      </div>
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
        <button onClick={startEditing} className="btn-ghost btn-small">
          {card.description ? 'Edit description' : 'Add description'}
        </button>
        <button onClick={() => setConfirming(true)} className="icon-btn" aria-label="Delete card">&times;</button>
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
