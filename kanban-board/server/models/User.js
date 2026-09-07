const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  // Only ever holds a SHA-256 hash of the reset token, never the token
  // itself — a raw token here would let anyone with DB read access reset
  // any account. A new forgot-password request overwrites both, so only
  // the most recently issued link ever works.
  resetPasswordTokenHash: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
