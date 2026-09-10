const { Resend } = require('resend');

// Created lazily rather than at module load — RESEND_API_KEY may not be set
// in every environment (e.g. a future test run), and the Resend constructor
// throws immediately on a missing key.
let client = null;
function getClient() {
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

async function sendPasswordResetEmail(toEmail, resetLink) {
  await getClient().emails.send({
    from: process.env.RESEND_FROM_ADDRESS,
    to: toEmail,
    subject: 'Reset your Kanban password',
    text: `Someone requested a password reset for this account.\n\nReset your password: ${resetLink}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
    html: `
      <p>Someone requested a password reset for this account.</p>
      <p><a href="${resetLink}">Reset your password</a></p>
      <p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
    `,
  });
}

async function sendVerificationEmail(toEmail, verifyLink) {
  await getClient().emails.send({
    from: process.env.RESEND_FROM_ADDRESS,
    to: toEmail,
    subject: 'Verify your Kanban email address',
    text: `Confirm this is your email address.\n\nVerify: ${verifyLink}\n\nThis link expires in 24 hours. If you didn't create this account, you can ignore this email.`,
    html: `
      <p>Confirm this is your email address.</p>
      <p><a href="${verifyLink}">Verify email address</a></p>
      <p>This link expires in 24 hours. If you didn't create this account, you can ignore this email.</p>
    `,
  });
}

module.exports = { sendPasswordResetEmail, sendVerificationEmail };
