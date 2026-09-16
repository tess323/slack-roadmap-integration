// api/cron/sync-projects.js
// Scheduled job (Vercel Cron): pull the current project list from Notion and
// overwrite the Projects tab in the Sheet. Keeps the Home tab's category list current.
//
// Notion's Category is a multi-select, so a project in multiple categories produces
// one Projects row per category — that's intended (it appears under each heading).

import { replaceProjects } from '../../lib/sheets.js';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_VERSION = '2022-06-28';

// Property names in the Roadmap DB
const TITLE_PROP = 'Project name';
const CATEGORY_PROP = 'Category';
const STATUS_PROP = 'Status';

async function queryNotion() {
  let results = [];
  let cursor = null;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const resp = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error('Notion query failed: ' + JSON.stringify(data));
    results = results.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return results;
}

function readTitle(prop) {
  if (!prop?.title?.length) return '(untitled)';
  return prop.title.map(t => t.plain_text).join('');
}
function readStatus(prop) {
  return prop?.status?.name || '';
}
function readMultiSelect(prop) {
  if (!prop?.multi_select?.length) return [];
  return prop.multi_select.map(o => o.name);
}

export default async function handler(req, res) {
  // Vercel Cron calls this endpoint. Optionally protect with a secret header.
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).send('Unauthorized');
      return;
    }
  }

  try {
    const pages = await queryNotion();
    const rows = [];
    for (const page of pages) {
      const p = page.properties;
      const status = readStatus(p[STATUS_PROP]);
      if (status === 'Completed' || status === 'Cancelled') continue; // skip dead work
      const title = readTitle(p[TITLE_PROP]);
      const categories = readMultiSelect(p[CATEGORY_PROP]);
      if (categories.length === 0) continue; // uncategorized projects aren't subscribable
      for (const category of categories) {
        rows.push({ category, project: title, status });
      }
    }

    // Sort by category then project for a tidy sheet
    rows.sort((a, b) => a.category.localeCompare(b.category) || a.project.localeCompare(b.project));

    await replaceProjects(rows);
    res.status(200).json({ ok: true, count: rows.length });
  } catch (err) {
    console.error('sync-projects error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
