# Iridescent Prism

A lightweight Kanban project board for small teams. Drag tasks between columns, track workload across your team, and flag at-risk deadlines — all in the browser with no backend required.

**Live demo:** [iridescent-prism.vercel.app](https://iridescent-prism.vercel.app)

---

## Features

**Kanban Board**
- Create multiple projects, each with its own board
- Three columns: To Do, In Progress, Done
- Drag and drop tasks between columns (via SortableJS)
- Tasks carry assignee, due date, and priority (Low / Medium / High / Urgent)

**Workload Analytics Dashboard**
- Summary stats: active tasks, completion rate, at-risk count
- Priority distribution — stacked bar across all active tasks
- Per-project breakdown with column distribution bars
- Team workload cards with capacity status (Balanced / At Capacity / Overloaded)
- At-risk task detection based on historical average completion times per priority

**Other**
- All data persists in `localStorage` — no account, no server
- Fully responsive — works on mobile, tablet, and desktop
- Dark theme throughout

---

## Running locally

No build step or install required. Open `index.html` directly in a browser, or serve with Python for a cleaner dev experience:

```bash
python -m http.server 8787
```

Then visit `http://localhost:8787`.

---

## Stack

| | |
|---|---|
| Language | Vanilla JS (`'use strict'`, no framework) |
| Drag and drop | [SortableJS 1.15.0](https://sortablejs.github.io/Sortable/) via CDN |
| Fonts | Inter + DM Mono via Google Fonts |
| Storage | `localStorage` |
| Hosting | [Vercel](https://vercel.com) |

Three files total: `index.html`, `styles.css`, `app.js`.

---

## Data model

```js
// Project
{ id, name, color, createdAt, tasks: [] }

// Task
{ id, title, description, assignee, dueDate, priority, column, order, createdAt, completedAt? }
// column: 'todo' | 'inprogress' | 'done'
// priority: 'Low' | 'Medium' | 'High' | 'Urgent'
```

Tasks are embedded inside their parent project. Two `localStorage` keys: `ip_projects` (full state) and `ip_active_project` (selected project ID).
