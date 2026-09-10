const jwt = require('jsonwebtoken');
const { isSessionValid } = require('../utils/session');

// A valid JWT signature only proves the token was legitimately issued at
// some point — it says nothing about whether that login has since been
// logged out. The `sid` claim (see routes/auth.js's signToken/createSession)
// is checked against Redis on every request so logout takes effect
// immediately instead of waiting out the token's full 7-day expiry.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (!(await isSessionValid(payload.sid, payload.sub))) {
    return res.status(401).json({ error: 'Session has been logged out' });
  }
  req.userId = payload.sub;
  req.sessionId = payload.sid;
  next();
}

module.exports = { requireAuth };
