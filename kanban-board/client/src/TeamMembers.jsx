import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { getSocket } from './socket';
import ConfirmDialog from './ConfirmDialog';

export default function TeamMembers({ team, onTeamDeleted, onOwnershipTransferred, onTeamLeft }) {
  const [members, setMembers] = useState([]);
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [email, setEmail] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [error, setError] = useState('');
  const [confirmingRemoval, setConfirmingRemoval] = useState(null); // { _id, name, isInvite }
  const [confirmingTransferUserId, setConfirmingTransferUserId] = useState(null);
  const [confirmingDeleteTeam, setConfirmingDeleteTeam] = useState(false);
  const [confirmingLeaveTeam, setConfirmingLeaveTeam] = useState(false);
  const searchTimer = useRef(null);

  const isOwner = team.isOwner;
  const canManage = team.role === 'owner' || team.role === 'co_owner';

  const load = () => api.getTeamMembers(team._id).then(setMembers).catch(e => setError(e.message));
  // Kept as a separate list rather than a "pending" flag mixed into
  // `members` — a pending row has no role yet and would need special-casing
  // throughout that list's rendering (role dropdown, owner badge, etc.).
  const loadInvitations = () => {
    if (!canManage) return;
    api.getPendingInvitations(team._id).then(setPendingInvitations).catch(e => setError(e.message));
  };

  useEffect(() => { load(); loadInvitations(); }, [team._id, canManage]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('join:team', team._id);
    const onChanged = (payload) => { if (payload.teamId === team._id) { load(); loadInvitations(); } };
    socket.on('team:membership-changed', onChanged);
    return () => {
      socket.emit('leave:team', team._id);
      socket.off('team:membership-changed', onChanged);
    };
  }, [team._id, canManage]);

  // Debounced so every keystroke doesn't fire its own request — waits for a
  // short pause in typing before asking the server for matches.
  useEffect(() => {
    clearTimeout(searchTimer.current);
    const query = email.trim();
    if (!canManage || query.length < 2) {
      setSuggestions([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      api.searchMemberCandidates(team._id, query).then(setSuggestions).catch(() => {});
    }, 250);
    return () => clearTimeout(searchTimer.current);
  }, [email, team._id, canManage]);

  // Closes the suggestions dropdown on a click outside the add-member form —
  // same pattern as the reaction picker / assignee menu elsewhere in the app.
  useEffect(() => {
    if (!suggestionsOpen) return;
    const handleClickOutside = (e) => {
      if (!e.target.closest('.member-add-form')) setSuggestionsOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [suggestionsOpen]);

  // A row appears in Pending invitations before the request even goes out —
  // not just before it resolves. Clicking a suggestion already gives us the
  // real name/email/id, so that row is fully accurate from the start;
  // typing a raw email with no matching suggestion has nothing but the
  // address to show, so a temporary row uses that as a stand-in name until
  // the POST response swaps in the account's real name. Either way, nothing
  // here waits on the network before the list changes. It lands in
  // pendingInvitations, not members — inviting no longer grants access, so
  // there's nothing to show in the actual member list yet.
  const addByEmail = async (addr, knownMember) => {
    setError('');
    setEmail('');
    setSuggestions([]);
    setSuggestionsOpen(false);

    const tempId = knownMember ? knownMember._id : `temp-${Date.now()}`;
    const optimisticInvite = { _id: tempId, name: addr, email: addr, ...knownMember };
    setPendingInvitations(prev => [...prev, optimisticInvite]);

    try {
      const invited = await api.addTeamMember(team._id, addr);
      setPendingInvitations(prev => prev.map(m => (m._id === tempId ? invited : m)));
    } catch (e) {
      setError(e.message);
      setPendingInvitations(prev => prev.filter(m => m._id !== tempId));
    }
  };

  const handleAdd = (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    addByEmail(email.trim());
  };

  // Removed from local state right away — no need to wait on the network
  // before the row disappears. Resyncs from the server on failure, since the
  // optimistic removal would otherwise be left showing an incorrect state.
  // Shared by both "Remove" (an accepted member) and "Cancel invite" (a
  // pending one) — same DELETE endpoint either way, so this just clears the
  // id out of whichever of the two lists it's actually in.
  const handleRemove = async (userId) => {
    setMembers(prev => prev.filter(m => m._id !== userId));
    setPendingInvitations(prev => prev.filter(m => m._id !== userId));
    setConfirmingRemoval(null);
    try {
      await api.removeTeamMember(team._id, userId);
    } catch (e) {
      setError(e.message);
      load();
      loadInvitations();
    }
  };

  const handleRoleChange = async (userId, role) => {
    setMembers(prev => prev.map(m => (m._id === userId ? { ...m, role } : m)));
    try {
      await api.updateMemberRole(team._id, userId, role);
    } catch (e) {
      setError(e.message);
      load();
    }
  };

  // Swaps the two owner badges locally — the target becomes the owner, the
  // acting owner drops to co-owner, matching what the server does in one
  // request. onOwnershipTransferred tells App.jsx to update this same
  // user's role on the team switcher too, since that lives in separate
  // state up there.
  const handleTransferOwnership = async (userId) => {
    setConfirmingTransferUserId(null);
    setMembers(prev => prev.map(m => {
      if (m._id === userId) return { ...m, role: 'owner', isOwner: true };
      if (m.isOwner) return { ...m, role: 'co_owner', isOwner: false };
      return m;
    }));
    try {
      await api.transferOwnership(team._id, userId);
      onOwnershipTransferred(team._id, userId);
    } catch (e) {
      setError(e.message);
      load();
    }
  };

  // Navigates away immediately rather than waiting on the delete request —
  // this page is about to unmount either way, so there's nothing to roll
  // back to locally if the request fails; a rare failure just leaves the
  // team intact server-side for the user to find still listed.
  const handleDeleteTeam = async () => {
    setConfirmingDeleteTeam(false);
    onTeamDeleted(team._id);
    try {
      await api.deleteTeam(team._id);
    } catch (e) {
      setError(e.message);
    }
  };

  // Unlike handleDeleteTeam, this waits for the server to actually confirm
  // before navigating away. Deleting can only ever fail on a rare network
  // hiccup once the button is visible at all, but leaving has a real,
  // expected rejection — the server re-checks ownership fresh, and the
  // owner flag driving whether "Leave" even renders (team.isOwner, from
  // App.jsx's teams list) can be stale. Navigating away optimistically here
  // would make the team vanish from the sidebar even though the server
  // never actually removed the membership.
  const handleLeaveTeam = async () => {
    setConfirmingLeaveTeam(false);
    try {
      await api.leaveTeam(team._id);
      onTeamLeft(team._id);
    } catch (e) {
      setError(e.message);
    }
  };

  const confirmingTransferMember = members.find(m => m._id === confirmingTransferUserId);

  return (
    <div className="team-members">
      <div className="page-header">
        <div>
          <h1>{team.name}</h1>
          <p className="page-subtitle">Members</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {canManage && (
        <form onSubmit={handleAdd} className="inline-form member-add-form">
          <div className="member-add-input-wrap">
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setSuggestionsOpen(true); }}
              onFocus={() => setSuggestionsOpen(true)}
              placeholder="Add member by email"
              autoComplete="off"
            />
            {suggestionsOpen && suggestions.length > 0 && (
              <ul className="member-suggestions">
                {suggestions.map(s => (
                  <li key={s._id}>
                    <button type="button" onClick={() => addByEmail(s.email, s)}>
                      <span className="member-suggestion-name">{s.name}</span>
                      <span className="member-suggestion-email">{s.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="submit" className="btn-primary">Add</button>
        </form>
      )}

      <ul className="member-list">
        {members.map(m => (
          <li key={m._id}>
            <span className="member-info">
              {m.name} <span className="member-email">({m.email})</span>
              {m.isOwner && <span className="member-owner-badge">Owner</span>}
            </span>
            <span className="member-list-actions">
              {canManage && !m.isOwner && (
                <select
                  className="member-role-select"
                  value={m.role}
                  onChange={(e) => handleRoleChange(m._id, e.target.value)}
                  aria-label={`Role for ${m.name}`}
                >
                  <option value="co_owner">Co-owner</option>
                  {/* A co-owner can promote a member to co-owner, but only the
                      owner can demote a co-owner back to member. */}
                  <option value="member" disabled={!isOwner}>Member</option>
                </select>
              )}
              {!canManage && !m.isOwner && <span className="member-role-label">{m.role === 'co_owner' ? 'Co-owner' : 'Member'}</span>}
              {isOwner && !m.isOwner && (
                <button onClick={() => setConfirmingTransferUserId(m._id)} className="btn-ghost btn-small">
                  Make owner
                </button>
              )}
              {isOwner && !m.isOwner && (
                <button
                  onClick={() => setConfirmingRemoval({ _id: m._id, name: m.name, isInvite: false })}
                  className="btn-ghost btn-ghost-danger btn-small"
                >
                  Remove
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>

      {canManage && pendingInvitations.length > 0 && (
        <>
          <p className="page-subtitle pending-invitations-label">Pending invitations</p>
          <ul className="member-list">
            {pendingInvitations.map(inv => (
              <li key={inv._id}>
                <span className="member-info">
                  {inv.name} <span className="member-email">({inv.email})</span>
                </span>
                <span className="member-list-actions">
                  <button
                    onClick={() => setConfirmingRemoval({ _id: inv._id, name: inv.name, isInvite: true })}
                    className="btn-ghost btn-ghost-danger btn-small"
                  >
                    Cancel invite
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {isOwner ? (
        <div className="danger-zone">
          <div>
            <h3>Delete {team.name}</h3>
            <p>Permanently removes all its boards, columns, and cards for every member.</p>
          </div>
          <button onClick={() => setConfirmingDeleteTeam(true)} className="btn-danger">Delete team</button>
        </div>
      ) : (
        // The owner can't leave from here — they'd need to transfer
        // ownership first (enforced server-side too), so this only ever
        // shows for a co-owner or member.
        <div className="danger-zone">
          <div>
            <h3>Leave {team.name}</h3>
            <p>You'll lose access to all of its boards, columns, and cards.</p>
          </div>
          <button onClick={() => setConfirmingLeaveTeam(true)} className="btn-danger">Leave team</button>
        </div>
      )}

      {confirmingRemoval && (
        <ConfirmDialog
          message={
            confirmingRemoval.isInvite
              ? `Cancel the invitation to ${confirmingRemoval.name}?`
              : `Remove ${confirmingRemoval.name} from ${team.name}?`
          }
          onConfirm={() => handleRemove(confirmingRemoval._id)}
          onCancel={() => setConfirmingRemoval(null)}
          confirmLabel={confirmingRemoval.isInvite ? 'Cancel invite' : 'Remove'}
        />
      )}

      {confirmingTransferMember && (
        <ConfirmDialog
          message={`Make ${confirmingTransferMember.name} the owner of ${team.name}? You'll become a co-owner.`}
          onConfirm={() => handleTransferOwnership(confirmingTransferMember._id)}
          onCancel={() => setConfirmingTransferUserId(null)}
          confirmLabel="OK"
          danger={false}
        />
      )}

      {confirmingDeleteTeam && (
        <ConfirmDialog
          message={`Delete "${team.name}"? This permanently deletes all its boards, columns, and cards. This cannot be undone.`}
          onConfirm={handleDeleteTeam}
          onCancel={() => setConfirmingDeleteTeam(false)}
        />
      )}

      {confirmingLeaveTeam && (
        <ConfirmDialog
          message={`Leave "${team.name}"? You'll lose access to its boards unless someone adds you back.`}
          onConfirm={handleLeaveTeam}
          onCancel={() => setConfirmingLeaveTeam(false)}
          confirmLabel="Leave"
        />
      )}
    </div>
  );
}
