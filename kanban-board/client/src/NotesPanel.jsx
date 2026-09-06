import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { getSocket } from './socket';
import { useAuth } from './auth/AuthContext';
import ConfirmDialog from './ConfirmDialog';

const formatTime = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👀'];

// Collapses a note's flat reaction list into one row per emoji, with a
// count and whether the current user is one of the reactors (so their pill
// can be highlighted, matching how Slack/GitHub reaction bars work).
function groupReactions(reactions, currentUserId) {
  const byEmoji = new Map();
  for (const r of reactions) {
    if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, { emoji: r.emoji, count: 0, reactedByMe: false, names: [] });
    const group = byEmoji.get(r.emoji);
    group.count += 1;
    group.names.push(r.userName);
    if (r.userId === currentUserId) group.reactedByMe = true;
  }
  return [...byEmoji.values()];
}

export default function NotesPanel({ boardId }) {
  const { user } = useAuth();
  const [notes, setNotes] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);
  const [collapsed, setCollapsed] = useState(true);
  const [pickerNoteId, setPickerNoteId] = useState(null);
  const listRef = useRef(null);
  const prevCountRef = useRef(0);

  const load = () => api.getNotes(boardId).then(setNotes).catch(e => setError(e.message));

  useEffect(() => { load(); }, [boardId]);

  // Keep the newest note in view when one is actually added — but not on
  // every update (e.g. someone reacting to an older note), which would
  // otherwise yank you back down while you're reading up the thread.
  useEffect(() => {
    const list = listRef.current;
    if (list && notes.length > prevCountRef.current) list.scrollTop = list.scrollHeight;
    prevCountRef.current = notes.length;
  }, [notes]);

  // BoardDetail already joins/leaves the board's socket room — this just
  // listens on that same connection for the notes-specific event.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onChanged = (payload) => { if (payload.boardId === boardId) load(); };
    socket.on('notes:changed', onChanged);
    return () => socket.off('notes:changed', onChanged);
  }, [boardId]);

  // Closes the reaction picker on a click outside any note. Clicking inside
  // a note is already handled by that note's own onClick (which opens,
  // closes, or switches the picker), and the reaction pill/emoji/delete
  // buttons all stop propagation, so this only ever fires for genuinely
  // outside clicks — no need to compare against the current pickerNoteId.
  useEffect(() => {
    if (!pickerNoteId) return;
    const handleClickOutside = (e) => {
      if (!e.target.closest('.note-item')) setPickerNoteId(null);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [pickerNoteId]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await api.createNote(boardId, text.trim());
      setText('');
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleDelete = async (noteId) => {
    await api.deleteNote(noteId);
    setConfirmingId(null);
    load();
  };

  // Toggles the reaction in local state immediately — we already know
  // exactly what the server will end up with (this user's own reaction on
  // this emoji, added or removed), so there's no need to wait on the
  // request before showing it. The board's own 'notes:changed' broadcast
  // (which reaches the acting client too) reconciles shortly after as a
  // no-op confirmation; on failure, a resync reverts the optimistic change.
  const handleToggleReaction = async (noteId, emoji) => {
    setPickerNoteId(null);
    setNotes(prev => prev.map(n => {
      if (n._id !== noteId) return n;
      const alreadyReacted = n.reactions.some(r => r.emoji === emoji && r.userId === user._id);
      const reactions = alreadyReacted
        ? n.reactions.filter(r => !(r.emoji === emoji && r.userId === user._id))
        : [...n.reactions, { emoji, userId: user._id, userName: user.name }];
      return { ...n, reactions };
    }));

    try {
      await api.toggleReaction(noteId, emoji);
    } catch (e) {
      setError(e.message);
      load();
    }
  };

  const handleNoteClick = (noteId) => {
    setPickerNoteId(id => (id === noteId ? null : noteId));
  };

  if (collapsed) {
    return (
      <button className="notes-panel-collapsed" onClick={() => setCollapsed(false)} aria-label="Show notes">
        <span className="notes-collapsed-label">Notes{notes.length > 0 ? ` (${notes.length})` : ''}</span>
      </button>
    );
  }

  return (
    <div className="notes-panel">
      <div className="notes-panel-header">
        <h3>Notes</h3>
        <button className="icon-btn" onClick={() => setCollapsed(true)} aria-label="Hide notes">&raquo;</button>
      </div>
      {error && <p className="error">{error}</p>}
      <form onSubmit={handleAdd} className="notes-form">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Add a note for the team..."
          rows={3}
        />
        <button type="submit" className="btn-primary btn-small">Add note</button>
      </form>
      <ul className="notes-list" ref={listRef}>
        {notes.map(n => {
          const reactionGroups = groupReactions(n.reactions, user._id);
          return (
            <li
              key={n._id}
              className={`note-item${n.authorId === user._id ? ' note-item-own' : ' note-item-other'}`}
              onClick={() => handleNoteClick(n._id)}
            >
              <div className="note-header">
                <span className="note-author">{n.authorName}</span>
                <span className="note-time">{formatTime(n.createdAt)}</span>
              </div>
              <p className="note-text">{n.text}</p>
              {pickerNoteId === n._id && (
                <div className="reaction-picker" onClick={(e) => e.stopPropagation()}>
                  {REACTION_EMOJIS.map(emoji => (
                    <button key={emoji} onClick={() => handleToggleReaction(n._id, emoji)}>{emoji}</button>
                  ))}
                </div>
              )}
              {n.authorId === user._id && (
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmingId(n._id); }}
                  className="icon-btn"
                  aria-label="Delete note"
                >
                  &times;
                </button>
              )}
              {reactionGroups.length > 0 && (
                <div className="reaction-bar">
                  {reactionGroups.map(g => (
                    <button
                      key={g.emoji}
                      className={`reaction-pill${g.reactedByMe ? ' reaction-pill-active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); handleToggleReaction(n._id, g.emoji); }}
                    >
                      {g.emoji} {g.count}
                      <span className="reaction-tooltip">{g.emoji} {g.names.join(', ')}</span>
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {confirmingId && (
        <ConfirmDialog
          message="Delete this note?"
          onConfirm={() => handleDelete(confirmingId)}
          onCancel={() => setConfirmingId(null)}
        />
      )}
    </div>
  );
}
