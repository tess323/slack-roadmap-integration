// lib/sheets.js
// Thin wrapper around the Google Sheets API for reading/writing subscriptions.
// Authenticates as the service account via credentials stored in env vars.

import { google } from 'googleapis';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Tab + range constants
const SUBS_TAB    = 'Subscriptions';
const PROJECTS_TAB = 'Projects';
const LT_TAB      = 'LT members';

let _sheetsClient = null;

function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;

  // The service account JSON is stored as a single env var (stringified JSON).
  // In Vercel you paste the whole JSON key file contents into GOOGLE_SERVICE_ACCOUNT_JSON.
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

// ---- Subscriptions -------------------------------------------------------

// Returns array of { rowIndex, slackId, name, email, category, level }
// rowIndex is the 1-based sheet row (including header), used for targeted writes.
export async function getSubscriptions() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SUBS_TAB}!A2:E`,
  });
  const rows = res.data.values || [];
  return rows.map((r, i) => ({
    rowIndex: i + 2, // +2: skip header, 1-based
    slackId: (r[0] || '').trim(),
    name: (r[1] || '').trim(),
    email: (r[2] || '').trim(),
    category: (r[3] || '').trim(),
    level: (r[4] || '').trim(),
  })).filter(r => r.slackId); // drop blank rows
}

// Returns just this user's subscriptions as a map { category: level }
export async function getUserSubscriptions(slackId) {
  const all = await getSubscriptions();
  const map = {};
  for (const row of all) {
    if (row.slackId === slackId) map[row.category] = row.level;
  }
  return map;
}

// Set a user's level for a category. level '' or 'Off' removes the subscription.
// Handles three cases: update existing row, append new row, or delete row.
export async function setUserLevel(slackId, name, email, category, level) {
  const sheets = getSheetsClient();
  const all = await getSubscriptions();
  const existing = all.find(r => r.slackId === slackId && r.category === category);

  const off = !level || level === 'Off';

  if (existing && off) {
    // Clear the row (write blanks). We don't physically delete to keep row math simple.
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SUBS_TAB}!A${existing.rowIndex}:E${existing.rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [['', '', '', '', '']] },
    });
    return;
  }

  if (off) return; // nothing to do — turning off something not subscribed

  if (existing) {
    // Update the level cell (column E)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SUBS_TAB}!E${existing.rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[level]] },
    });
    return;
  }

  // Append a new row. Prefer filling a previously-cleared blank row if one exists.
  const blank = all.find(r => !r.slackId); // (filtered out above, so this is rare)
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SUBS_TAB}!A:E`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[slackId, name, email, category, level]] },
  });
}

// ---- Projects (reference list) -------------------------------------------

// Returns array of { category, project, status } and a derived unique category list.
export async function getProjects() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${PROJECTS_TAB}!A2:D`,
  });
  const rows = res.data.values || [];
  return rows
    .map(r => ({
      category: (r[0] || '').trim(),
      project: (r[1] || '').trim(),
      status: (r[2] || '').trim(),
    }))
    .filter(r => r.category);
}

export async function getCategories() {
  const projects = await getProjects();
  return [...new Set(projects.map(p => p.category))].sort();
}

// Overwrites the Projects tab with a fresh list from Notion. rows: [{category, project, status}]
export async function replaceProjects(rows) {
  const sheets = getSheetsClient();
  const now = new Date().toISOString().slice(0, 10);
  // Clear existing data (keep header)
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${PROJECTS_TAB}!A2:D`,
  });
  if (rows.length === 0) return;
  const values = rows.map(r => [r.category, r.project, r.status, now]);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${PROJECTS_TAB}!A2:D${values.length + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
}

// ---- LT members ----------------------------------------------------------

// Returns a Set of Slack user IDs allowed to use the LT level.
export async function getLTMembers() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${LT_TAB}!A2:A`,
  });
  const rows = res.data.values || [];
  return new Set(rows.map(r => (r[0] || '').trim()).filter(Boolean));
}
