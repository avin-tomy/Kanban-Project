import { io } from 'socket.io-client';
import { BASE_URL } from './api';

let socket = null;

export function connectSocket(token) {
  // socket.io-client treats a passed-in empty string differently from no URL
  // at all, so the same-origin (production) case has to omit the argument
  // rather than pass BASE_URL through unconditionally.
  socket = BASE_URL ? io(BASE_URL, { auth: { token } }) : io({ auth: { token } });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
