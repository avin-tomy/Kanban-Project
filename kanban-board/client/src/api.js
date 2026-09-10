// In dev, the client (Vite, :5173) and API (:4000) run as separate servers,
// so requests need an explicit host. In production the API serves the built
// client itself (see server/index.js), so requests are same-origin and this
// is just ''. VITE_API_URL overrides this if the two are ever split again
// (e.g. deployed as separate services).
export const BASE_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:4000' : '');

let authToken = null;
let onUnauthorized = null;

export function setAuthToken(token) {
  authToken = token;
}

// Registered by AuthContext so any 401 (expired/invalid token) logs the user
// out everywhere consistently, instead of every call site handling it.
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

async function request(path, options) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${BASE_URL}${path}`, { headers, ...options });
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  signup: (email, password, name) =>
    request('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request('/auth/me'),
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token, password) =>
    request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  resendVerification: () => request('/auth/resend-verification', { method: 'POST' }),
  verifyEmail: (token) => request('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),

  getMyTeams: () => request('/teams'),
  getMyAssignedCards: () => request('/me/assigned-cards'),
  createTeam: (name) => request('/teams', { method: 'POST', body: JSON.stringify({ name }) }),
  deleteTeam: (teamId) => request(`/teams/${teamId}`, { method: 'DELETE' }),
  leaveTeam: (teamId) => request(`/teams/${teamId}/leave`, { method: 'DELETE' }),
  getTeamMembers: (teamId) => request(`/teams/${teamId}/members`),
  searchMemberCandidates: (teamId, q) => request(`/teams/${teamId}/members/search?q=${encodeURIComponent(q)}`),
  addTeamMember: (teamId, email) =>
    request(`/teams/${teamId}/members`, { method: 'POST', body: JSON.stringify({ email }) }),
  removeTeamMember: (teamId, userId) =>
    request(`/teams/${teamId}/members/${userId}`, { method: 'DELETE' }),
  updateMemberRole: (teamId, userId, role) =>
    request(`/teams/${teamId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  transferOwnership: (teamId, userId) =>
    request(`/teams/${teamId}/transfer-ownership`, { method: 'POST', body: JSON.stringify({ userId }) }),
  getPendingInvitations: (teamId) => request(`/teams/${teamId}/invitations`),
  acceptInvitation: (teamId) => request(`/teams/${teamId}/accept`, { method: 'POST' }),
  declineInvitation: (teamId) => request(`/teams/${teamId}/accept`, { method: 'DELETE' }),

  getBoards: (teamId) => request(`/teams/${teamId}/boards`),
  createBoard: (teamId, name) =>
    request(`/teams/${teamId}/boards`, { method: 'POST', body: JSON.stringify({ name }) }),
  getBoardFull: (boardId) => request(`/boards/${boardId}/full`),
  deleteBoard: (boardId) => request(`/boards/${boardId}`, { method: 'DELETE' }),

  createColumn: (boardId, name) =>
    request(`/boards/${boardId}/columns`, { method: 'POST', body: JSON.stringify({ name }) }),
  deleteColumn: (columnId) => request(`/columns/${columnId}`, { method: 'DELETE' }),
  reorderColumns: (boardId, columnIds) =>
    request(`/boards/${boardId}/columns/order`, { method: 'PUT', body: JSON.stringify({ columnIds }) }),
  reorderColumnCards: (columnId, cardIds) =>
    request(`/columns/${columnId}/cards/order`, { method: 'PUT', body: JSON.stringify({ cardIds }) }),

  createCard: (columnId, title) =>
    request(`/columns/${columnId}/cards`, { method: 'POST', body: JSON.stringify({ title }) }),
  updateCard: (cardId, changes) =>
    request(`/cards/${cardId}`, { method: 'PATCH', body: JSON.stringify(changes) }),
  deleteCard: (cardId) => request(`/cards/${cardId}`, { method: 'DELETE' }),

  getNotes: (boardId) => request(`/boards/${boardId}/notes`),
  createNote: (boardId, text) =>
    request(`/boards/${boardId}/notes`, { method: 'POST', body: JSON.stringify({ text }) }),
  deleteNote: (noteId) => request(`/notes/${noteId}`, { method: 'DELETE' }),
  toggleReaction: (noteId, emoji) =>
    request(`/notes/${noteId}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) }),

  getActivity: (boardId) => request(`/boards/${boardId}/activity`),

  getNotifications: () => request('/notifications'),
  markNotificationRead: (id) =>
    request(`/notifications/${id}`, { method: 'PATCH', body: JSON.stringify({ read: true }) }),
  markAllNotificationsRead: () => request('/notifications/read-all', { method: 'POST' }),
  clearNotification: (id) => request(`/notifications/${id}`, { method: 'DELETE' }),
  clearAllNotifications: () => request('/notifications', { method: 'DELETE' }),
};
