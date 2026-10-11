'use strict';

// Keep the existing HTTP delivery pattern, without a second SDK dependency.
async function sendEmail(message) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !key.trim()) throw new Error('Email service not configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Email delivery failed (${response.status})`);
}

module.exports = { sendEmail };
