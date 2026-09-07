import { useEffect, useState } from 'react';
import { api } from './api';
import { getSocket } from './socket';

const formatTime = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function NotificationsBell({ onOpenNotification, mobileMenuOpen }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState('');
  // Tracked separately from `read` — marking every notification read (e.g.
  // via "Mark all read") shouldn't also make an invite un-actionable, so an
  // invite's Accept/Decline buttons stay up until it's actually resolved.
  const [resolvedInviteIds, setResolvedInviteIds] = useState(new Set());
  const [processingInviteId, setProcessingInviteId] = useState(null);

  // On mobile, the sidebar (and this bell inside it) slides off-screen via a
  // CSS transform rather than unmounting — and that transform makes the
  // sidebar the containing block for this dropdown's own click-outside
  // backdrop (position: fixed), which then only covers the sidebar's own
  // width instead of the full screen. So a tap in the dimmed area outside
  // the sidebar closes the sidebar itself without ever reaching this
  // dropdown's backdrop, leaving it open (just hidden along with the
  // sidebar). Closing it in step with the sidebar avoids relying on that
  // backdrop for this specific case. Harmless on desktop, where the sidebar
  // is never toggled at all.
  useEffect(() => {
    if (!mobileMenuOpen) setOpen(false);
  }, [mobileMenuOpen]);

  useEffect(() => {
    api.getNotifications().then(({ items, unreadCount }) => {
      setItems(items);
      setUnreadCount(unreadCount);
    }).catch(e => setError(e.message));
  }, []);

  // Every connected socket already sits in its own user:<id> room (joined
  // server-side on connect, see index.js) — nothing to join here, just listen.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onNew = (notification) => {
      setItems(prev => [notification, ...prev]);
      setUnreadCount(count => count + 1);
    };
    socket.on('notification:new', onNew);
    return () => socket.off('notification:new', onNew);
  }, []);

  // Optimistically marks one read (same shape as everywhere else in the app).
  const markRead = async (notificationId) => {
    setItems(prev => prev.map(n => (n._id === notificationId ? { ...n, read: true } : n)));
    setUnreadCount(count => Math.max(0, count - 1));
    try {
      await api.markNotificationRead(notificationId);
    } catch (e) {
      setError(e.message);
    }
  };

  // Marks it read and hands off navigation to the caller, which knows how
  // to switch teams/open a board — this component only knows about
  // notifications. Not used for a pending team_invited (see the Accept/
  // Decline buttons below instead) — there's nothing to open yet.
  const handleClick = (notification) => {
    setOpen(false);
    if (!notification.read) markRead(notification._id);
    onOpenNotification(notification);
  };

  const handleAcceptInvite = async (notification) => {
    setProcessingInviteId(notification._id);
    try {
      await api.acceptInvitation(notification.teamId);
      setResolvedInviteIds(prev => new Set(prev).add(notification._id));
      if (!notification.read) markRead(notification._id);
      setOpen(false);
      onOpenNotification(notification);
    } catch (e) {
      setError(e.message);
    } finally {
      setProcessingInviteId(null);
    }
  };

  const handleDeclineInvite = async (notification) => {
    setProcessingInviteId(notification._id);
    try {
      await api.declineInvitation(notification.teamId);
      setResolvedInviteIds(prev => new Set(prev).add(notification._id));
      if (!notification.read) markRead(notification._id);
    } catch (e) {
      setError(e.message);
    } finally {
      setProcessingInviteId(null);
    }
  };

  const handleMarkAllRead = async () => {
    setItems(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await api.markAllNotificationsRead();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="notifications-menu">
      <button
        className="notifications-trigger"
        onClick={() => setOpen(o => !o)}
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path
            d="M9 2C6.79 2 5 3.79 5 6v2.5c0 .53-.21 1.04-.59 1.41L3 11.5V13h12v-1.5l-1.41-1.59A2 2 0 0 1 13 8.5V6c0-2.21-1.79-4-4-4Z"
            stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
          />
          <path d="M7.2 15a1.9 1.9 0 0 0 3.6 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        {unreadCount > 0 && <span className="notifications-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>
      {open && (
        <>
          <div className="presence-backdrop" onClick={() => setOpen(false)} />
          <div className="activity-dropdown notifications-dropdown">
            <div className="presence-dropdown-label notifications-dropdown-label">
              <span>Notifications</span>
              {unreadCount > 0 && (
                <button className="link-button" onClick={handleMarkAllRead}>Mark all read</button>
              )}
            </div>
            {error && <p className="error">{error}</p>}
            {items.length === 0 ? (
              <p className="activity-empty">No notifications yet.</p>
            ) : (
              <ul className="activity-list">
                {items.map(n => {
                  const isPendingInvite = n.type === 'team_invited' && !resolvedInviteIds.has(n._id);
                  const isProcessing = processingInviteId === n._id;
                  return (
                    <li
                      key={n._id}
                      className={`notification-item${n.read ? '' : ' notification-item-unread'}`}
                      onClick={isPendingInvite ? undefined : () => handleClick(n)}
                    >
                      <span className="activity-detail"><strong>{n.actorName}</strong> {n.message}</span>
                      <span className="activity-time">{formatTime(n.createdAt)}</span>
                      {isPendingInvite && (
                        <div className="notification-invite-actions" onClick={e => e.stopPropagation()}>
                          <button className="btn-ghost btn-small" disabled={isProcessing} onClick={() => handleDeclineInvite(n)}>
                            Decline
                          </button>
                          <button className="btn-primary btn-small" disabled={isProcessing} onClick={() => handleAcceptInvite(n)}>
                            Accept
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
