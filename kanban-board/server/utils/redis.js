const { createClient } = require('redis');

// Created lazily, same reasoning as utils/email.js's client — avoids
// connecting at module-require time in contexts (e.g. a future test run)
// where these env vars aren't set. Unlike a plain require-time connect,
// `redis` v4 needs an explicit connect() before any command runs, so the
// in-flight promise is cached too — two calls arriving before the first
// connect() resolves must share it rather than each starting their own.
let client = null;
let connecting = null;
async function getRedis() {
  if (!client) {
    client = createClient({
      username: process.env.REDIS_USERNAME || 'default',
      password: process.env.REDIS_PASSWORD,
      socket: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
      },
    });
    client.on('error', (err) => console.error('Redis client error:', err.message));
  }
  if (!connecting) connecting = client.connect();
  await connecting;
  return client;
}

module.exports = { getRedis };
