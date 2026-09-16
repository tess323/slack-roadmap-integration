// api/slack/events.js
// Handles Slack Events API callbacks. We care about:
//  - url_verification (one-time handshake when you set the Request URL)
//  - app_home_opened (render the Home tab for that user)

import { verifySlackSignature } from '../../lib/slack.js';
import { publishHomeForUser } from '../../lib/publishHome.js';

// Vercel needs the raw body for signature verification, so disable body parsing.
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
  const payload = JSON.parse(rawBody);

  // 1. URL verification handshake — respond with the challenge. (Slack sends this
  //    once when you register the Events Request URL. No signature needed to echo it,
  //    but we verify anyway for everything else.)
  if (payload.type === 'url_verification') {
    res.status(200).json({ challenge: payload.challenge });
    return;
  }

  // 2. Verify signature on all real events
  if (!verifySlackSignature(rawBody, req.headers)) {
    res.status(401).send('Bad signature');
    return;
  }

  // 3. Acknowledge fast (Slack requires a 200 within 3s), then do work.
  res.status(200).send('');

  try {
    if (payload.type === 'event_callback' && payload.event) {
      const event = payload.event;
      if (event.type === 'app_home_opened' && event.tab === 'home') {
        await publishHomeForUser(event.user);
      }
    }
  } catch (err) {
    console.error('events handler error:', err);
  }
}
