const mongoose = require('mongoose');

const teamMemberSchema = new mongoose.Schema({
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

// One membership row per (team, user) — also the lookup this app makes most often.
teamMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true });
// Fast "which teams does this user belong to" lookups.
teamMemberSchema.index({ userId: 1 });

module.exports = mongoose.model('TeamMember', teamMemberSchema);
