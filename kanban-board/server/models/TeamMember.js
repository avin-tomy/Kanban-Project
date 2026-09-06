const mongoose = require('mongoose');

// 'owner' is the team's single founder (also tracked on Team.ownerId — kept
// in sync rather than treated as two separate sources of truth). 'co_owner'
// can do anything except delete team/board/column/card or remove members.
// 'member' can only change the status of cards assigned to them.
const teamMemberSchema = new mongoose.Schema({
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['owner', 'co_owner', 'member'], default: 'member' },
}, { timestamps: true });

// One membership row per (team, user) — also the lookup this app makes most often.
teamMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true });
// Fast "which teams does this user belong to" lookups.
teamMemberSchema.index({ userId: 1 });

module.exports = mongoose.model('TeamMember', teamMemberSchema);
