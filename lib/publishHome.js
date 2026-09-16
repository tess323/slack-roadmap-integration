// lib/publishHome.js
// Shared routine: read this user's data and publish their Home tab.

import { WebClient } from '@slack/web-api';
import { getUserSubscriptions, getCategories, getLTMembers } from './sheets.js';
import { buildHomeView } from './slack.js';

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export async function publishHomeForUser(userId) {
  const [userSubs, categories, ltMembers] = await Promise.all([
    getUserSubscriptions(userId),
    getCategories(),
    getLTMembers(),
  ]);

  const isLT = ltMembers.has(userId);
  const view = buildHomeView(categories, userSubs, isLT);

  await slack.views.publish({ user_id: userId, view });
}
