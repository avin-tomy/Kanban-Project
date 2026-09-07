const mongoose = require('mongoose');

// 'owner' is the team's single founder (also tracked on Team.ownerId — kept
// in sync rather than treated as two separate sources of truth). 'co_owner'
// can do anything except delete team/board/column/card or remove members.
// 'member' can only change the status of cards assigned to them.
const teamMemberSchema = new mongoose.Schema({
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['owner', 'co_owner', 'member'], default: 'member' },
  // 'pending' means invited-but-not-yet-accepted — see the query middleware
  // below for why this is the access-control gate, not just a UI label.
  // Defaults to 'accepted' so every pre-existing creation site (a team's own
  // owner row, an ownership-transfer's role flips) needs no changes.
  status: { type: String, enum: ['pending', 'accepted'], default: 'accepted' },
}, { timestamps: true });

// One membership row per (team, user) — also the lookup this app makes most often.
teamMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true });
// Fast "which teams does this user belong to" lookups.
teamMemberSchema.index({ userId: 1 });

// TeamMember rows are the access-control primitive checked everywhere a
// request touches a board/column/card/note, plus the socket room joins and
// the assignee-eligibility check — a single missed call site there would be
// a real access-control hole for a pending invitee. Rather than editing
// every one of those individually, this makes "accepted only" the default
// for every read, so a call site has to explicitly ask for `status` (e.g.
// `status: 'pending'` or `status: { $in: [...] }`) to see anything else.
// Deliberately excludes deleteOne/deleteMany/updateOne: canceling an invite
// has to find and delete a pending row (see routes/teams.js), and
// accept/decline target a specific status explicitly anyway.
teamMemberSchema.pre(['find', 'findOne', 'countDocuments', 'exists'], function () {
  if (this.getQuery().status === undefined) this.where({ status: 'accepted' });
});

module.exports = mongoose.model('TeamMember', teamMemberSchema);
