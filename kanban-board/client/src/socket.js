import { io } from 'socket.io-client';
import { BASE_URL } from './api';

let socket = null;

export function connectSocket(token) {
  socket = io(BASE_URL, { auth: { token } });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
