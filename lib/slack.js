// lib/slack.js
// Slack helpers: signature verification + building the App Home view.

import crypto from 'crypto';

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

// ---- Request signature verification --------------------------------------
// Slack signs every request. We MUST verify it so no one can forge calls.
// Pass the raw (unparsed) body string and the request headers.
export function verifySlackSignature(rawBody, headers) {
  const timestamp = headers['x-slack-request-timestamp'];
  const sig = headers['x-slack-signature'];
  if (!timestamp || !sig) return false;

  // Reject requests older than 5 minutes (replay protection)
  const fiveMin = 60 * 5;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > fiveMin) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const mySig =
    'v0=' +
    crypto.createHmac('sha256', SIGNING_SECRET).update(base).digest('hex');

  // Constant-time compare
  try {
    return crypto.timingSafeEqual(Buffer.from(mySig), Buffer.from(sig));
  } catch {
    return false;
  }
}

// ---- Level display -------------------------------------------------------

export const LEVELS = ['Off', '1', '2', '3', 'LT'];

const LEVEL_EMOJI = {
  Off: ':white_circle:',
  '1': ':small_blue_diamond:',
  '2': ':large_blue_diamond:',
  '3': ':large_blue_circle:',
  LT: ':star:',
};

const LEVEL_LABEL = {
  Off: 'Not subscribed',
  '1': 'Level 1 — Headlines',
  '2': 'Level 2 — Standard',
  '3': 'Level 3 — Deep',
  LT: 'LT — Leadership view',
};

export function levelDisplay(level) {
  const l = level && LEVELS.includes(level) ? level : 'Off';
  return `${LEVEL_EMOJI[l]} ${LEVEL_LABEL[l]}`;
}

// ---- Build the Home tab view ---------------------------------------------
// categories: string[]  (from the Projects tab)
// userSubs: { category: level }  (this user's current picks)
// isLT: boolean  (may this user pick the LT level?)
export function buildHomeView(categories, userSubs, isLT) {
  const blocks = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: '📍 Roadmap Report Subscriptions', emoji: true },
  });
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: 'Choose which areas you want weekly roadmap updates on, and how much detail. Changes save instantly and take effect on the next weekly send.',
    },
  });
  blocks.push({ type: 'divider' });

  if (categories.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No categories available yet. Check back after the next roadmap sync._' },
    });
    return { type: 'home', blocks };
  }

  for (const category of categories) {
    const current = userSubs[category] || 'Off';

    // Row: category name + current level
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${category}*\n${levelDisplay(current)}` },
    });

    // Buttons to change level. LT only shown to allowlisted users.
    const levelsToShow = isLT ? LEVELS : LEVELS.filter(l => l !== 'LT');
    const elements = levelsToShow.map(level => ({
      type: 'button',
      text: { type: 'plain_text', text: level === 'Off' ? 'Off' : (level === 'LT' ? '⭐ LT' : `L${level}`), emoji: true },
      // style the currently-selected one so state is visible
      ...(level === current ? { style: level === 'Off' ? 'danger' : 'primary' } : {}),
      // action_id encodes nothing; the value carries category + chosen level
      action_id: `setlevel_${category}_${level}`.replace(/[^a-zA-Z0-9_]/g, '_'),
      value: JSON.stringify({ category, level }),
    }));

    blocks.push({ type: 'actions', elements });
    blocks.push({ type: 'divider' });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: 'Levels: *1* headlines · *2* standard · *3* deep' + (isLT ? ' · *⭐ LT* leadership view' : ''),
      },
    ],
  });

  return { type: 'home', blocks };
}
