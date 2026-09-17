// api/slack/interactions.js
// Handles block_actions (button clicks) from the Home tab.
// A click sets the user's level for a category, then re-renders their Home tab.

import { verifySlackSignature } from '../../lib/slack.js';
import { setUserLevel, getLTMembers } from '../../lib/sheets.js';
import { publishHomeForUser } from '../../lib/publishHome.js';
import { WebClient } from '@slack/web-api';

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const rawBody = await readRawBody(req);

  if (!verifySlackSignature(rawBody, req.headers)) {
    res.status(401).send('Bad signature');
    return;
  }

  // Slack retries a delivery (up to twice more) if it doesn't get a 200 within ~3s,
  // e.g. during a cold start. The original delivery is still being processed, so
  // reprocessing a retry would duplicate the Sheet write. Ack and bail out.
  if (req.headers['x-slack-retry-num']) {
    res.status(200).send('');
    return;
  }

  // Interaction payloads arrive URL-encoded as payload=<json>
  const params = new URLSearchParams(rawBody);
  const payload = JSON.parse(params.get('payload'));

  // Ack immediately
  res.status(200).send('');

  try {
    if (payload.type !== 'block_actions') return;

    const action = payload.actions && payload.actions[0];
    if (!action) return;

    const userId = payload.user.id;
    const { category, level } = JSON.parse(action.value);

    // Look up identity for the row (name/email). Fetch from Slack profile.
    let name = payload.user.name || '';
    let email = '';
    try {
      const info = await slack.users.info({ user: userId });
      name = info.user?.real_name || info.user?.name || name;
      email = info.user?.profile?.email || '';
    } catch (e) {
      // users:read.email scope may be needed; non-fatal
      console.warn('users.info failed:', e.data?.error || e.message);
    }

    // Enforce LT: if they somehow picked LT but aren't allowlisted, store level 3.
    let effectiveLevel = level;
    if (level === 'LT') {
      const ltMembers = await getLTMembers();
      if (!ltMembers.has(userId)) effectiveLevel = '3';
    }

    await setUserLevel(userId, name, email, category, effectiveLevel);

    // Re-render the Home tab so the new state shows immediately.
    await publishHomeForUser(userId);
  } catch (err) {
    console.error('interactions handler error:', err);
  }
}
