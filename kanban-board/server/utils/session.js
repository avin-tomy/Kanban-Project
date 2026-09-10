const crypto = require('crypto');
const { getRedis } = require('./redis');

// Matches the JWT's own expiry (see routes/auth.js's signToken) — a session
// row should never outlive the token that carries its id.
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const sessionKey = (sid) => `session:${sid}`;
const userSessionsKey = (userId) => `user-sessions:${userId}`;

// Called on every login/signup/reset-password — each one is a fresh login,
// so each gets its own revocable session id embedded in that token's `sid`
// claim (see signToken). `user-sessions:<userId>` is a side index of every
// session id issued to that user, purely so /auth/logout-all has something
// to enumerate; it isn't itself checked for authorization.
async function createSession(userId) {
  const redis = await getRedis();
  const sid = crypto.randomBytes(24).toString('hex');
  await redis.set(sessionKey(sid), userId.toString(), { EX: SESSION_TTL_SECONDS });
  await redis.sAdd(userSessionsKey(userId), sid);
  await redis.expire(userSessionsKey(userId), SESSION_TTL_SECONDS);
  return sid;
}

// The authorization check itself — requireAuth and the socket handshake
// both call this after verifying the JWT's signature/expiry, so a
// logged-out (or logged-out-everywhere) token stops working immediately
// rather than staying valid until it naturally expires.
async function isSessionValid(sid, userId) {
  if (!sid) return false;
  const redis = await getRedis();
  const storedUserId = await redis.get(sessionKey(sid));
  return storedUserId === userId.toString();
}

async function revokeSession(sid, userId) {
  const redis = await getRedis();
  await redis.del(sessionKey(sid));
  await redis.sRem(userSessionsKey(userId), sid);
}

// Returns the revoked session ids so the caller can also force-disconnect
// any sockets currently authenticated under them — otherwise a live
// connection opened before the revocation would keep working until it
// happened to reconnect.
async function revokeAllSessions(userId) {
  const redis = await getRedis();
  const sids = await redis.sMembers(userSessionsKey(userId));
  if (sids.length) await redis.del(sids.map(sessionKey));
  await redis.del(userSessionsKey(userId));
  return sids;
}

module.exports = { createSession, isSessionValid, revokeSession, revokeAllSessions };
