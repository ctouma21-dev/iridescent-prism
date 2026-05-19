'use strict';

// =====================================================================
// CONSTANTS
// =====================================================================
const PROJECT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#10b981'];

const COLUMNS = [
  { id: 'todo',       label: 'To Do' },
  { id: 'inprogress', label: 'In Progress' },
  { id: 'done',       label: 'Done' },
];

const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

const GEM_SVG = `
<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gem-g1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#8b5cf6"/>
    </linearGradient>
    <linearGradient id="gem-g2" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8b5cf6"/>
      <stop offset="100%" stop-color="#ec4899"/>
    </linearGradient>
  </defs>
  <polygon points="40,8 68,24 68,56 40,72 12,56 12,24" stroke="url(#gem-g1)" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
  <polygon points="40,8 68,24 40,36"  fill="url(#gem-g1)" opacity="0.22"/>
  <polygon points="40,8 12,24 40,36"  fill="url(#gem-g2)" opacity="0.16"/>
  <polygon points="68,24 68,56 40,36" fill="url(#gem-g1)" opacity="0.38"/>
  <polygon points="12,24 12,56 40,36" fill="url(#gem-g2)" opacity="0.28"/>
  <polygon points="40,72 68,56 40,36" fill="url(#gem-g1)" opacity="0.50"/>
  <polygon points="40,72 12,56 40,36" fill="url(#gem-g2)" opacity="0.40"/>
  <line x1="40" y1="8"  x2="40" y2="36" stroke="#c7d2fe" stroke-width="0.8" opacity="0.5"/>
  <line x1="68" y1="24" x2="40" y2="36" stroke="#c7d2fe" stroke-width="0.8" opacity="0.5"/>
  <line x1="12" y1="24" x2="40" y2="36" stroke="#c7d2fe" stroke-width="0.8" opacity="0.5"/>
</svg>`;

// NOTE: the Supabase CDN library declares a global `var supabase` on window.
// This client variable must NOT be named `supabase` or it collides and the
// whole script fails to parse. `window.supabase` = the library; `sb` = our client.
let sb      = null;
let boardId = null;

// =====================================================================
// STORE — localStorage helpers
// =====================================================================
const Store = {
  getActiveId: () => localStorage.getItem('ip_active_project') || null,
  setActiveId: (id) => id
    ? localStorage.setItem('ip_active_project', id)
    : localStorage.removeItem('ip_active_project'),
};

const DB = {
  async upsertProject(p) {
    const { error } = await sb.from('projects').upsert({
      id: p.id, board_id: boardId, name: p.name, color: p.color, created_at: p.createdAt,
    });
    if (error) throw error;
  },
  async deleteProject(id) {
    const { error } = await sb.from('projects').delete().eq('id', id);
    if (error) throw error;
  },
  async upsertTask(t, projectId) {
    const { error } = await sb.from('tasks').upsert({
      id: t.id, project_id: projectId, board_id: boardId,
      title: t.title, description: t.description || null,
      assignee: t.assignee || null, due_date: t.dueDate || null,
      priority: t.priority, column_name: t.column, sort_order: t.order,
      created_at: t.createdAt, completed_at: t.completedAt || null,
    });
    if (error) throw error;
  },
  async upsertTasks(tasks, projectId) {
    if (!tasks.length) return;
    const rows = tasks.map(t => ({
      id: t.id, project_id: projectId, board_id: boardId,
      title: t.title, description: t.description || null,
      assignee: t.assignee || null, due_date: t.dueDate || null,
      priority: t.priority, column_name: t.column, sort_order: t.order,
      created_at: t.createdAt, completed_at: t.completedAt || null,
    }));
    const { error } = await sb.from('tasks').upsert(rows);
    if (error) throw error;
  },
  async deleteTask(id) {
    const { error } = await sb.from('tasks').delete().eq('id', id);
    if (error) throw error;
  },
};

// =====================================================================
// STATE
// =====================================================================
let state = { projects: [], activeProjectId: null, view: 'board' };

async function fetchConfig() {
  // 1. Vercel: fetch credentials from the serverless endpoint.
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const json = await res.json();
      if (json && json.supabaseUrl && json.supabaseKey) return json;
    }
  } catch (_) {
    // /api/config is unavailable on a plain static server (local dev) — fall through.
  }
  // 2. Local dev: fall back to globals set by config.local.js.
  if (window.SUPABASE_URL && window.SUPABASE_KEY) {
    return { supabaseUrl: window.SUPABASE_URL, supabaseKey: window.SUPABASE_KEY };
  }
  // 3. No credentials available anywhere.
  return null;
}

async function getOrCreateBoard() {
  const params = new URLSearchParams(window.location.search);
  const existing = params.get('board');
  if (existing) {
    const { data } = await sb.from('boards').select('id').eq('id', existing).maybeSingle();
    if (data) return existing;
  }
  const { data, error } = await sb.from('boards').insert({}).select('id').single();
  if (error) throw error;
  const url = new URL(window.location.href);
  url.searchParams.set('board', data.id);
  window.history.replaceState({}, '', url.toString());
  return data.id;
}

async function loadState() {
  const [{ data: projects, error: pe }, { data: tasks, error: te }] = await Promise.all([
    sb.from('projects').select('*').eq('board_id', boardId).order('created_at'),
    sb.from('tasks').select('*').eq('board_id', boardId),
  ]);
  if (pe || te) throw pe || te;

  state.projects = (projects || []).map(p => ({
    id: p.id, name: p.name, color: p.color, createdAt: p.created_at,
    tasks: (tasks || [])
      .filter(t => t.project_id === p.id)
      .map(t => ({
        id: t.id, title: t.title, description: t.description,
        assignee: t.assignee, dueDate: t.due_date, priority: t.priority,
        column: t.column_name, order: t.sort_order,
        createdAt: t.created_at, completedAt: t.completed_at,
      }))
      .sort((a, b) => a.order - b.order),
  }));

  state.activeProjectId = Store.getActiveId();
  if (state.activeProjectId && !state.projects.find(p => p.id === state.activeProjectId))
    state.activeProjectId = null;
  if (!state.activeProjectId && state.projects.length > 0)
    state.activeProjectId = state.projects[0].id;
  Store.setActiveId(state.activeProjectId);
}

function subscribeToRealtime() {
  sb
    .channel('board:' + boardId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects',
        filter: `board_id=eq.${boardId}` }, handleRemoteChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks',
        filter: `board_id=eq.${boardId}` }, handleRemoteChange)
    .subscribe();
}

let _reloadPending = false;
async function handleRemoteChange() {
  if (_reloadPending) return;
  _reloadPending = true;
  try {
    await loadState();
    renderSidebar();
    renderMainView();
  } finally {
    _reloadPending = false;
  }
}

function getActiveProject() {
  return state.projects.find(p => p.id === state.activeProjectId) || null;
}

// =====================================================================
// DOM HELPERS
// =====================================================================
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// =====================================================================
// UTILITIES
// =====================================================================
function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getInitials(name) {
  if (!name || !name.trim()) return '?';
  return name.trim().split(/\s+/).map(w => w[0].toUpperCase()).slice(0, 2).join('');
}

function hashColor(str) {
  const palette = ['#6366f1','#8b5cf6','#ec4899','#14b8a6','#f59e0b','#10b981','#3b82f6','#f97316'];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
  return palette[Math.abs(h) % palette.length];
}

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const date  = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff  = Math.round((date - today) / 86400000);

  if (diff < 0)  return { text: `${Math.abs(diff)}d overdue`, status: 'overdue' };
  if (diff === 0) return { text: 'Today',    status: 'today' };
  if (diff === 1) return { text: 'Tomorrow', status: 'soon' };
  if (diff <= 6)  return { text: `${diff}d`, status: 'soon' };
  return {
    text: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    status: 'normal',
  };
}

function getPriorityConfig(priority) {
  const map = {
    Low:    { color: 'var(--prio-low)',    bg: 'var(--prio-low-bg)' },
    Medium: { color: 'var(--prio-medium)', bg: 'var(--prio-medium-bg)' },
    High:   { color: 'var(--prio-high)',   bg: 'var(--prio-high-bg)' },
    Urgent: { color: 'var(--prio-urgent)', bg: 'var(--prio-urgent-bg)' },
  };
  return map[priority] || map.Medium;
}

// =====================================================================
// TOAST
// =====================================================================
function showToast(message, type = 'info') {
  const container = $('#toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('toast--visible')));

  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 350);
  }, 2800);
}

// =====================================================================
// MODAL
// =====================================================================
function openModal(html) {
  const overlay = $('#modal-overlay');
  $('#modal-box').innerHTML = html;
  overlay.classList.add('modal--open');
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    const first = $('#modal-box').querySelector('input:not([type=radio]), select, textarea');
    if (first) first.focus();
  }, 60);
}

function closeModal() {
  const overlay = $('#modal-overlay');
  overlay.classList.remove('modal--open');
  document.body.style.overflow = '';
  setTimeout(() => {
    if (!overlay.classList.contains('modal--open')) $('#modal-box').innerHTML = '';
  }, 250);
}

// =====================================================================
// SIDEBAR
// =====================================================================
function renderSidebar() {
  const sidebarNav = $('#sidebar-nav');
  sidebarNav.innerHTML = `
    <button class="sidebar__analytics-btn${state.view === 'analytics' ? ' sidebar__analytics-btn--active' : ''}" id="btn-analytics">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
        <rect x="1" y="8" width="3" height="6" rx="0.5"/>
        <rect x="6" y="4" width="3" height="10" rx="0.5"/>
        <rect x="11" y="1" width="3" height="13" rx="0.5"/>
      </svg>
      Analytics
    </button>`;

  const nav = $('#sidebar-projects');
  nav.innerHTML = '';

  if (state.projects.length === 0) {
    nav.innerHTML = '<p class="sidebar__empty">No projects yet.<br>Create one to get started.</p>';
    return;
  }

  state.projects.forEach(project => {
    const isActive = state.view === 'board' && project.id === state.activeProjectId;
    const div = document.createElement('div');
    div.className = `project-item${isActive ? ' project-item--active' : ''}`;
    div.dataset.id = project.id;
    div.innerHTML = `
      <span class="project-item__dot" style="background:${project.color}"></span>
      <span class="project-item__name">${escapeHtml(project.name)}</span>
      <span class="project-item__count">${project.tasks.length}</span>
      <button class="project-item__delete" data-id="${project.id}" title="Delete project">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13">
          <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
      </button>`;
    nav.appendChild(div);
  });
}

// =====================================================================
// BOARD
// =====================================================================
function renderBoard() {
  const board  = $('#board');
  const project = getActiveProject();

  $('#btn-add-task').classList.toggle('hidden', !project);

  if (!project) {
    renderSplash(board);
    return;
  }

  board.classList.remove('board--splash', 'board--analytics');
  $('#project-title').textContent = project.name;
  board.innerHTML = '';

  COLUMNS.forEach(col => {
    const tasks = project.tasks
      .filter(t => t.column === col.id)
      .sort((a, b) => a.order - b.order);

    const colEl = document.createElement('div');
    colEl.className = 'column';
    colEl.dataset.column = col.id;
    colEl.innerHTML = `
      <div class="column__header">
        <div class="column__title-wrap">
          <span class="column__dot column__dot--${col.id}"></span>
          <h2 class="column__title">${col.label}</h2>
        </div>
        <span class="column__count">${tasks.length}</span>
      </div>
      <div class="column__body" id="col-${col.id}">
        <div class="column__empty"${tasks.length > 0 ? ' style="display:none"' : ''}>Drop tasks here</div>
        ${tasks.map(renderTaskCard).join('')}
      </div>
      <button class="column__footer" data-column="${col.id}">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
          <line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/>
        </svg>
        Add task
      </button>`;
    board.appendChild(colEl);
  });

  initSortable();
}

function renderTaskCard(task) {
  const prio     = getPriorityConfig(task.priority);
  const due      = formatDueDate(task.dueDate);
  const initials = getInitials(task.assignee);
  const avatarBg = task.assignee ? hashColor(task.assignee) : null;

  const avatarHtml = task.assignee ? `
    <span class="assignee-avatar" style="background:${avatarBg}" title="${escapeHtml(task.assignee)}">
      ${initials}
    </span>` : '';

  const dueDateHtml = due ? `
    <span class="due-date due-date--${due.status}">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="11" height="11">
        <rect x="2" y="3" width="12" height="11" rx="1.5"/>
        <line x1="5" y1="1" x2="5" y2="5" stroke-linecap="round"/>
        <line x1="11" y1="1" x2="11" y2="5" stroke-linecap="round"/>
        <line x1="2" y1="7" x2="14" y2="7"/>
      </svg>
      ${due.text}
    </span>` : '';

  return `
    <div class="task-card" data-id="${task.id}" style="border-left-color:${prio.color}">
      <div class="task-card__drag-handle" aria-hidden="true">
        <svg viewBox="0 0 14 14" fill="currentColor" width="13" height="13">
          <circle cx="4.5" cy="3.5" r="1.2"/><circle cx="9.5" cy="3.5" r="1.2"/>
          <circle cx="4.5" cy="7"   r="1.2"/><circle cx="9.5" cy="7"   r="1.2"/>
          <circle cx="4.5" cy="10.5" r="1.2"/><circle cx="9.5" cy="10.5" r="1.2"/>
        </svg>
      </div>
      <div class="task-card__body">
        <p class="task-card__title">${escapeHtml(task.title)}</p>
        ${task.description ? `<p class="task-card__description">${escapeHtml(task.description)}</p>` : ''}
      </div>
      <div class="task-card__footer">
        <div class="task-card__meta-left">
          ${avatarHtml}
          ${dueDateHtml}
        </div>
        <span class="priority-badge" style="color:${prio.color};background:${prio.bg}">
          <span class="priority-dot" style="background:${prio.color}"></span>
          ${task.priority}
        </span>
      </div>
    </div>`;
}

function renderSplash(board) {
  board.classList.add('board--splash');
  $('#project-title').textContent = 'Iridescent Prism';
  board.innerHTML = `
    <div class="splash">
      <div class="splash__gem">${GEM_SVG}</div>
      <h2 class="splash__title">No project selected</h2>
      <p class="splash__sub">Create a project to start organizing your work on a Kanban board.</p>
      <button class="btn-primary" id="btn-splash-new">+ New Project</button>
    </div>`;
  $('#btn-splash-new').addEventListener('click', () => openProjectModal());
}

// =====================================================================
// ANALYTICS
// =====================================================================
function renderMainView() {
  if (state.view === 'analytics') {
    renderAnalytics();
  } else {
    renderBoard();
  }
}

function getAllTasks() {
  const tasks = [];
  state.projects.forEach(p => p.tasks.forEach(t => tasks.push({ ...t, projectName: p.name, projectColor: p.color })));
  return tasks;
}

function getTeamWorkload(allTasks) {
  const members = {};
  allTasks.forEach(t => {
    const name = t.assignee?.trim() || 'Unassigned';
    if (!members[name]) members[name] = { name, active: [], done: [] };
    if (t.column === 'done') members[name].done.push(t);
    else members[name].active.push(t);
  });
  return Object.values(members).sort((a, b) => b.active.length - a.active.length);
}

function getWorkloadStatus(activeCount) {
  if (activeCount >= 5) return { label: 'Overloaded', color: 'var(--prio-urgent)' };
  if (activeCount >= 3) return { label: 'At Capacity', color: 'var(--prio-medium)' };
  if (activeCount >= 1) return { label: 'Balanced', color: 'var(--prio-low)' };
  return { label: 'Available', color: 'var(--text-muted)' };
}

function getAverageCompletionDays(doneTasks, priority) {
  const defaults = { Low: 7, Medium: 5, High: 3, Urgent: 1 };
  const matching = doneTasks.filter(t => t.priority === priority && t.completedAt && t.createdAt);
  if (matching.length === 0) return defaults[priority] || 5;
  const total = matching.reduce((sum, t) => {
    const days = (new Date(t.completedAt) - new Date(t.createdAt)) / 86400000;
    return sum + Math.max(days, 0.5);
  }, 0);
  return total / matching.length;
}

function getAtRiskTasks(allTasks) {
  const doneTasks = allTasks.filter(t => t.column === 'done');
  const risks = [];
  allTasks.forEach(t => {
    if (t.column === 'done' || !t.dueDate) return;
    const due = new Date(t.dueDate + 'T00:00:00');
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const daysRemaining = (due - now) / 86400000;
    const avgDays = getAverageCompletionDays(doneTasks, t.priority);

    let risk = null;
    if (daysRemaining < 0) risk = { level: 'overdue', reason: `${Math.abs(Math.round(daysRemaining))}d overdue` };
    else if (daysRemaining < avgDays * 0.5) risk = { level: 'high', reason: `Only ${Math.round(daysRemaining)}d left — similar tasks avg ${avgDays.toFixed(1)}d` };
    else if (daysRemaining < avgDays) risk = { level: 'medium', reason: `${Math.round(daysRemaining)}d left — similar tasks avg ${avgDays.toFixed(1)}d` };

    if (risk) risks.push({ ...t, risk });
  });
  return risks.sort((a, b) => {
    const order = { overdue: 0, high: 1, medium: 2 };
    return (order[a.risk.level] ?? 3) - (order[b.risk.level] ?? 3);
  });
}

function getStatCardContext(allTasks, atRiskCount) {
  const total = allTasks.length;
  const active = allTasks.filter(t => t.column !== 'done').length;
  const done = allTasks.filter(t => t.column === 'done').length;
  const todo = allTasks.filter(t => t.column === 'todo').length;
  const inprogress = allTasks.filter(t => t.column === 'inprogress').length;
  const completionPct = total > 0 ? Math.round((done / total) * 100) : 0;
  const riskPct = active > 0 ? Math.round((atRiskCount / active) * 100) : 0;
  return { total, active, done, todo, inprogress, completionPct, riskPct };
}

function getPriorityDistribution(allTasks) {
  const active = allTasks.filter(t => t.column !== 'done');
  const total = active.length;
  const counts = { Low: 0, Medium: 0, High: 0, Urgent: 0 };
  active.forEach(t => { if (counts.hasOwnProperty(t.priority)) counts[t.priority]++; });
  return PRIORITIES.map(p => ({
    label: p, count: counts[p],
    pct: total > 0 ? Math.round((counts[p] / total) * 100) : 0,
    config: getPriorityConfig(p),
  }));
}

function getProjectBreakdown(projects, atRiskTasks) {
  return projects.map(p => {
    const todo = p.tasks.filter(t => t.column === 'todo').length;
    const inprogress = p.tasks.filter(t => t.column === 'inprogress').length;
    const done = p.tasks.filter(t => t.column === 'done').length;
    const total = p.tasks.length;
    const atRisk = atRiskTasks.filter(t => t.projectName === p.name).length;
    return { name: p.name, color: p.color, todo, inprogress, done, total, atRisk };
  }).sort((a, b) => b.total - a.total);
}

function renderAnalytics() {
  const board = $('#board');
  board.classList.remove('board--splash');
  board.classList.add('board--analytics');
  $('#project-title').textContent = 'Workload Analytics';
  $('#btn-add-task').classList.add('hidden');

  const allTasks = getAllTasks();
  const members = getTeamWorkload(allTasks);
  const atRisk = getAtRiskTasks(allTasks);
  const ctx = getStatCardContext(allTasks, atRisk.length);
  const distribution = getPriorityDistribution(allTasks);
  const projectBreakdown = getProjectBreakdown(state.projects, atRisk);
  const maxActive = Math.max(...members.map(m => m.active.length), 1);

  board.innerHTML = `
    <div class="analytics">
      <div class="analytics__stats">
        <div class="stat-card">
          <div class="stat-card__value">${state.projects.length}</div>
          <div class="stat-card__label">Projects</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${ctx.total} total tasks</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__value">${ctx.active}</div>
          <div class="stat-card__label">Active Tasks</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${ctx.todo} to do &middot; ${ctx.inprogress} in progress</div>
        </div>
        <div class="stat-card${atRisk.length > 0 ? ' stat-card--alert' : ''}">
          <div class="stat-card__value">${atRisk.length}</div>
          <div class="stat-card__label">At Risk</div>
          <div style="font-size:11px;color:${atRisk.length > 0 ? 'var(--prio-urgent)' : 'var(--text-muted)'};margin-top:2px;">${atRisk.length > 0 ? ctx.riskPct + '% of active tasks' : 'All clear'}</div>
        </div>
        <div class="stat-card stat-card--done">
          <div class="stat-card__value">${ctx.done}</div>
          <div class="stat-card__label">Completed</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${ctx.completionPct}% completion rate</div>
          <div style="margin-top:8px;height:4px;background:var(--bg-hover);border-radius:2px;overflow:hidden;">
            <div style="height:100%;width:${ctx.completionPct}%;background:var(--prio-low);border-radius:2px;transition:width 0.5s ease;"></div>
          </div>
        </div>
      </div>

      ${renderPriorityDistribution(distribution, ctx.active)}

      <div class="analytics__section">
        <h3 class="analytics__section-title">Projects</h3>
        ${projectBreakdown.length > 0
          ? projectBreakdown.map(renderProjectBreakdownCard).join('')
          : '<p class="analytics__empty">No projects yet.</p>'}
      </div>

      <div class="analytics__section">
        <h3 class="analytics__section-title">Team Workload</h3>
        ${members.length > 0
          ? members.map(m => renderMemberCard(m, maxActive)).join('')
          : '<p class="analytics__empty">No tasks assigned yet.</p>'}
      </div>

      ${renderAtRiskSection(atRisk)}
    </div>`;
}

function renderPriorityDistribution(distribution, totalActive) {
  if (totalActive === 0) {
    return `
      <div class="analytics__section">
        <h3 class="analytics__section-title">Priority Distribution</h3>
        <p class="analytics__empty">No active tasks to analyze.</p>
      </div>`;
  }
  const segments = distribution
    .filter(d => d.count > 0)
    .map(d => `<div style="width:${d.pct}%;height:100%;background:${d.config.color};"></div>`)
    .join('');
  const legend = distribution.map(d => `
    <div style="display:flex;align-items:center;gap:6px;">
      <span style="width:8px;height:8px;border-radius:50%;background:${d.config.color};flex-shrink:0;"></span>
      <span style="color:var(--text-secondary);font-size:12px;">${d.label}</span>
      <span style="color:var(--text-primary);font-size:12px;font-weight:600;">${d.count}</span>
      <span style="color:var(--text-muted);font-size:11px;">${d.pct}%</span>
    </div>`).join('');

  return `
    <div class="analytics__section">
      <h3 class="analytics__section-title">Priority Distribution</h3>
      <div style="height:10px;background:var(--bg-hover);border-radius:5px;overflow:hidden;display:flex;">
        ${segments}
      </div>
      <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:4px;">
        ${legend}
      </div>
    </div>`;
}

function renderProjectBreakdownCard(proj) {
  const total = proj.total || 1;
  const donePct = Math.round((proj.done / total) * 100);
  const ipPct = Math.round((proj.inprogress / total) * 100);
  const todoPct = Math.max(100 - donePct - ipPct, 0);

  return `
    <div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--r-lg);padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="width:10px;height:10px;border-radius:50%;background:${proj.color};flex-shrink:0;"></span>
        <span style="color:var(--text-primary);font-size:13.5px;font-weight:600;flex:1;">${escapeHtml(proj.name)}</span>
        ${proj.atRisk > 0 ? `<span style="font-size:10px;padding:2px 7px;border-radius:4px;background:var(--prio-urgent)22;color:var(--prio-urgent);font-weight:600;">${proj.atRisk} at risk</span>` : ''}
        <span style="color:var(--text-muted);font-size:12px;">${proj.total} tasks</span>
      </div>
      <div style="height:6px;background:var(--bg-hover);border-radius:3px;overflow:hidden;display:flex;">
        ${proj.done > 0 ? `<div style="width:${donePct}%;height:100%;background:var(--prio-low);"></div>` : ''}
        ${proj.inprogress > 0 ? `<div style="width:${ipPct}%;height:100%;background:var(--accent);"></div>` : ''}
        ${proj.todo > 0 ? `<div style="width:${todoPct}%;height:100%;background:var(--text-muted);opacity:0.3;"></div>` : ''}
      </div>
      <div style="display:flex;gap:16px;font-size:12px;color:var(--text-secondary);">
        <span style="display:flex;align-items:center;gap:5px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--text-muted);opacity:0.4;"></span>${proj.todo} to do</span>
        <span style="display:flex;align-items:center;gap:5px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--accent);"></span>${proj.inprogress} in progress</span>
        <span style="display:flex;align-items:center;gap:5px;"><span style="width:6px;height:6px;border-radius:50%;background:var(--prio-low);"></span>${proj.done} done</span>
      </div>
    </div>`;
}

function renderMemberCard(member, maxActive) {
  const status = getWorkloadStatus(member.active.length);
  const pct = Math.round((member.active.length / maxActive) * 100);
  const initials = getInitials(member.name);
  const avatarBg = member.name !== 'Unassigned' ? hashColor(member.name) : 'var(--text-muted)';
  const todoCount = member.active.filter(t => t.column === 'todo').length;
  const ipCount = member.active.filter(t => t.column === 'inprogress').length;
  const thresholdPct = maxActive >= 3 ? Math.min(Math.round((3 / maxActive) * 100), 100) : -1;

  return `
    <div class="member-card">
      <div class="member-card__header">
        <span class="assignee-avatar" style="background:${avatarBg};">${initials}</span>
        <span class="member-card__name">${escapeHtml(member.name)}</span>
        <span class="member-card__status" style="color:${status.color};background:${status.color}18;">${status.label}</span>
      </div>
      <div style="position:relative;">
        <div class="member-card__bar-track">
          <div class="member-card__bar-fill" style="width:${pct}%;background:${status.color};"></div>
        </div>
        ${thresholdPct >= 0 ? `<div style="position:absolute;top:-2px;bottom:-2px;left:${thresholdPct}%;width:1px;background:var(--text-muted);opacity:0.4;" title="At Capacity threshold (3 tasks)"></div>` : ''}
      </div>
      <div class="member-card__counts">
        <span>${todoCount} to do</span>
        <span>${ipCount} in progress</span>
        <span>${member.done.length} done</span>
      </div>
    </div>`;
}

function renderAtRiskSection(atRiskTasks) {
  if (atRiskTasks.length === 0) {
    return `
      <div class="analytics__section">
        <h3 class="analytics__section-title">At-Risk Tasks</h3>
        <p class="analytics__empty">No tasks at risk — nice work!</p>
      </div>`;
  }

  const groups = [
    { level: 'overdue', label: 'Overdue', color: 'var(--prio-urgent)' },
    { level: 'high',    label: 'High Risk', color: 'var(--prio-high)' },
    { level: 'medium',  label: 'Medium Risk', color: 'var(--prio-medium)' },
  ];

  const groupHtml = groups.map(g => {
    const tasks = atRiskTasks.filter(t => t.risk.level === g.level);
    if (tasks.length === 0) return '';
    return `
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${g.color};flex-shrink:0;"></span>
        <span style="font-size:12px;font-weight:600;color:${g.color};">${g.label}</span>
        <span style="font-size:11px;color:var(--text-muted);">${tasks.length} task${tasks.length !== 1 ? 's' : ''}</span>
      </div>
      ${tasks.map(renderRiskCard).join('')}`;
  }).join('');

  return `
    <div class="analytics__section">
      <h3 class="analytics__section-title">At-Risk Tasks</h3>
      ${groupHtml}
    </div>`;
}

function renderRiskCard(task) {
  const levelColors = { overdue: 'var(--prio-urgent)', high: 'var(--prio-high)', medium: 'var(--prio-medium)' };
  const levelLabels = { overdue: 'Overdue', high: 'High Risk', medium: 'Medium Risk' };
  const color = levelColors[task.risk.level];
  const due = formatDueDate(task.dueDate);
  const prioConfig = getPriorityConfig(task.priority);
  const initials = getInitials(task.assignee);
  const avatarBg = task.assignee ? hashColor(task.assignee) : 'var(--text-muted)';

  return `
    <div class="risk-card" style="border-left:3px solid ${color};">
      <div class="risk-card__header">
        <span class="risk-card__title">${escapeHtml(task.title)}</span>
        <span style="font-size:10px;padding:2px 7px;border-radius:4px;background:${color}22;color:${color};font-weight:600;white-space:nowrap;">${levelLabels[task.risk.level]}</span>
      </div>
      <div class="risk-card__reason">${escapeHtml(task.risk.reason)}</div>
      <div class="risk-card__meta">
        <span class="assignee-avatar" style="background:${avatarBg};">${initials}</span>
        <span>${escapeHtml(task.assignee || 'Unassigned')}</span>
        <span class="risk-card__sep">&middot;</span>
        <span>${escapeHtml(task.projectName)}</span>
        <span class="risk-card__sep">&middot;</span>
        <span style="color:${color};">${due ? 'Due: ' + due.text : 'No due date'}</span>
        <span class="risk-card__sep">&middot;</span>
        <span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:6px;height:6px;border-radius:50%;background:${prioConfig.color};"></span>${task.priority}</span>
      </div>
    </div>`;
}

// =====================================================================
// SORTABLE
// =====================================================================
function initSortable() {
  document.querySelectorAll('.column__body').forEach(el => {
    if (el._sortable) el._sortable.destroy();

    el._sortable = new Sortable(el, {
      group:               'kanban',
      animation:           120,
      easing:              'cubic-bezier(0.25, 1, 0.5, 1)',
      ghostClass:          'task-card--ghost',
      chosenClass:         'task-card--chosen',
      dragClass:           'task-card--dragging',
      handle:              '.task-card__drag-handle',
      filter:              '.column__empty',
      delay:               0,
      delayOnTouchOnly:    true,
      touchStartThreshold: 5,

      onStart() {
        $$('.column__empty').forEach(e => (e.style.display = 'none'));
      },

      onEnd(evt) {
        const taskId = evt.item.dataset.id;
        const toCol  = evt.to.closest('.column').dataset.column;

        // Read final DOM order for all columns
        const orders = {};
        COLUMNS.forEach(col => {
          const body = document.getElementById(`col-${col.id}`);
          if (body) orders[col.id] = $$('.task-card', body).map(el => el.dataset.id);
        });

        updateTaskColumnAndOrder(taskId, toCol, orders);

        // Restore empty-state placeholders
        COLUMNS.forEach(col => {
          const body = document.getElementById(`col-${col.id}`);
          if (!body) return;
          const hasCards = $$('.task-card', body).length > 0;
          const emptyEl  = $('.column__empty', body);
          if (emptyEl) emptyEl.style.display = hasCards ? 'none' : '';
        });

        // Update column counts in headers
        COLUMNS.forEach(col => {
          const body  = document.getElementById(`col-${col.id}`);
          const count = body ? $$('.task-card', body).length : 0;
          const colEl = body?.closest('.column');
          if (colEl) {
            const countEl = colEl.querySelector('.column__count');
            if (countEl) countEl.textContent = count;
          }
        });

        // Sync sidebar task count
        const project = getActiveProject();
        if (project) {
          const item = $(`.project-item[data-id="${project.id}"] .project-item__count`);
          if (item) item.textContent = project.tasks.length;
        }
      },
    });
  });
}

function updateTaskColumnAndOrder(taskId, newColumn, columnOrders) {
  const project = getActiveProject();
  if (!project) return;

  Object.entries(columnOrders).forEach(([col, ids]) => {
    ids.forEach((id, idx) => {
      const t = project.tasks.find(t => t.id === id);
      if (t) {
        const wasNotDone = t.column !== 'done';
        t.column = col;
        t.order = idx;
        if (col === 'done' && wasNotDone) t.completedAt = new Date().toISOString();
        else if (col !== 'done') delete t.completedAt;
      }
    });
  });

  const proj = getActiveProject();
  if (proj) {
    const changed = [];
    Object.values(columnOrders).forEach(ids => {
      ids.forEach(id => {
        const t = proj.tasks.find(t => t.id === id);
        if (t) changed.push(t);
      });
    });
    DB.upsertTasks(changed, proj.id).catch(() =>
      showToast("Couldn't save order — please try again", 'error')
    );
  }
}

// =====================================================================
// PROJECT MODAL
// =====================================================================
function openProjectModal(project = null) {
  const isEdit = !!project;

  const colorPicker = PROJECT_COLORS.map((c, i) => `
    <label class="color-opt">
      <input type="radio" name="proj-color" value="${c}"
        ${(!project && i === 0) || (project && project.color === c) ? 'checked' : ''}>
      <span class="color-swatch" style="background:${c}"></span>
    </label>`).join('');

  openModal(`
    <div class="modal__header">
      <h2 class="modal__title">${isEdit ? 'Edit Project' : 'New Project'}</h2>
      <button class="modal__close" id="modal-close">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <line x1="2" y1="2" x2="14" y2="14" stroke-linecap="round"/>
          <line x1="14" y1="2" x2="2" y2="14" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="modal__body">
      <div class="form-group">
        <label class="form-label" for="proj-name">Project name<span class="required">*</span></label>
        <input type="text" id="proj-name" class="form-input"
          placeholder="e.g. Website Redesign"
          value="${isEdit ? escapeHtml(project.name) : ''}"
          maxlength="60" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">Color</label>
        <div class="color-options">${colorPicker}</div>
      </div>
    </div>
    <div class="modal__footer">
      ${isEdit
        ? `<button class="btn-danger" id="btn-delete-project" data-id="${project.id}">Delete Project</button>`
        : '<div></div>'}
      <div class="modal__footer-right">
        <button class="btn-ghost" id="modal-cancel">Cancel</button>
        <button class="btn-primary" id="btn-save-project">${isEdit ? 'Save Changes' : 'Create Project'}</button>
      </div>
    </div>`);

  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-cancel').addEventListener('click', closeModal);

  $('#proj-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#btn-save-project').click();
  });

  $('#btn-save-project').addEventListener('click', async () => {
    const name = $('#proj-name').value.trim();
    if (!name) {
      $('#proj-name').focus();
      showToast('Project name is required', 'error');
      return;
    }
    const color = document.querySelector('input[name="proj-color"]:checked')?.value || PROJECT_COLORS[0];

    if (isEdit) {
      project.name  = name;
      project.color = color;
    } else {
      const p = { id: generateId('proj'), name, color, createdAt: new Date().toISOString(), tasks: [] };
      state.projects.push(p);
      state.activeProjectId = p.id;
      Store.setActiveId(p.id);
    }

    const projectToSave = isEdit ? project : state.projects[state.projects.length - 1];
    try {
      await DB.upsertProject(projectToSave);
    } catch (_) {
      showToast("Couldn't save — please try again", 'error');
      return;
    }
    closeModal();
    state.view = 'board';
    renderSidebar();
    renderMainView();
    showToast(isEdit ? 'Project updated' : 'Project created', 'success');
  });

  if (isEdit) {
    $('#btn-delete-project').addEventListener('click', () => confirmDeleteProject(project.id));
  }
}

function confirmDeleteProject(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;

  openModal(`
    <div class="modal__header">
      <h2 class="modal__title">Delete Project?</h2>
      <button class="modal__close" id="modal-close">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <line x1="2" y1="2" x2="14" y2="14" stroke-linecap="round"/>
          <line x1="14" y1="2" x2="2" y2="14" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="modal__body">
      <p class="modal__confirm-text">
        This will permanently delete <strong>"${escapeHtml(project.name)}"</strong> and all
        ${project.tasks.length} task${project.tasks.length !== 1 ? 's' : ''} inside it.
        This cannot be undone.
      </p>
    </div>
    <div class="modal__footer">
      <div></div>
      <div class="modal__footer-right">
        <button class="btn-ghost" id="modal-cancel">Cancel</button>
        <button class="btn-danger" id="btn-confirm-delete">Delete Project</button>
      </div>
    </div>`);

  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-cancel').addEventListener('click', closeModal);
  $('#btn-confirm-delete').addEventListener('click', async () => {
    state.projects = state.projects.filter(p => p.id !== projectId);
    if (state.activeProjectId === projectId) {
      state.activeProjectId = state.projects[0]?.id || null;
      Store.setActiveId(state.activeProjectId);
    }
    try {
      await DB.deleteProject(projectId);
    } catch (_) {
      showToast("Couldn't delete — please try again", 'error');
      return;
    }
    closeModal();
    renderSidebar();
    renderMainView();
    showToast('Project deleted', 'info');
  });
}

// =====================================================================
// TASK MODAL
// =====================================================================
function openTaskModal(task = null, defaultColumn = 'todo') {
  const isEdit  = !!task;
  const project = getActiveProject();
  if (!project) return;

  const colOptions  = COLUMNS.map(c =>
    `<option value="${c.id}" ${(task ? task.column : defaultColumn) === c.id ? 'selected' : ''}>${c.label}</option>`
  ).join('');
  const prioOptions = PRIORITIES.map(p =>
    `<option value="${p}" ${(task ? task.priority : 'Medium') === p ? 'selected' : ''}>${p}</option>`
  ).join('');

  openModal(`
    <div class="modal__header">
      <h2 class="modal__title">${isEdit ? 'Edit Task' : 'New Task'}</h2>
      <button class="modal__close" id="modal-close">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <line x1="2" y1="2" x2="14" y2="14" stroke-linecap="round"/>
          <line x1="14" y1="2" x2="2" y2="14" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="modal__body">
      <div class="form-group">
        <label class="form-label" for="task-title">Title<span class="required">*</span></label>
        <input type="text" id="task-title" class="form-input"
          placeholder="What needs to be done?"
          value="${isEdit ? escapeHtml(task.title) : ''}"
          maxlength="120" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label" for="task-desc">Description</label>
        <textarea id="task-desc" class="form-textarea"
          placeholder="Optional details..."
          rows="3">${isEdit ? escapeHtml(task.description || '') : ''}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="task-assignee">Assignee</label>
          <input type="text" id="task-assignee" class="form-input"
            placeholder="Name"
            value="${isEdit ? escapeHtml(task.assignee || '') : ''}"
            maxlength="60" autocomplete="off">
        </div>
        <div class="form-group">
          <label class="form-label" for="task-due">Due Date</label>
          <input type="date" id="task-due" class="form-input"
            value="${isEdit ? (task.dueDate || '') : ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="task-priority">Priority</label>
          <select id="task-priority" class="form-select">${prioOptions}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="task-column">Column</label>
          <select id="task-column" class="form-select">${colOptions}</select>
        </div>
      </div>
    </div>
    <div class="modal__footer">
      ${isEdit
        ? `<button class="btn-danger" id="btn-delete-task">Delete Task</button>`
        : '<div></div>'}
      <div class="modal__footer-right">
        <button class="btn-ghost" id="modal-cancel">Cancel</button>
        <button class="btn-primary" id="btn-save-task">${isEdit ? 'Save Changes' : 'Create Task'}</button>
      </div>
    </div>`);

  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-cancel').addEventListener('click', closeModal);

  $('#task-title').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) $('#btn-save-task').click();
  });

  $('#btn-save-task').addEventListener('click', async () => {
    const title = $('#task-title').value.trim();
    if (!title) {
      $('#task-title').focus();
      showToast('Task title is required', 'error');
      return;
    }

    const data = {
      title,
      description: $('#task-desc').value.trim(),
      assignee:    $('#task-assignee').value.trim(),
      dueDate:     $('#task-due').value,
      priority:    $('#task-priority').value,
      column:      $('#task-column').value,
    };

    if (isEdit) {
      const wasDone = task.column === 'done';
      Object.assign(task, data);
      if (data.column === 'done' && !wasDone) task.completedAt = new Date().toISOString();
      else if (data.column !== 'done') delete task.completedAt;
    } else {
      const siblings = project.tasks.filter(t => t.column === data.column);
      const newTask = {
        id:        generateId('task'),
        order:     siblings.length,
        createdAt: new Date().toISOString(),
        ...data,
      };
      if (data.column === 'done') newTask.completedAt = new Date().toISOString();
      project.tasks.push(newTask);
    }

    const taskToSave = isEdit ? task : project.tasks[project.tasks.length - 1];
    try {
      await DB.upsertTask(taskToSave, project.id);
    } catch (_) {
      showToast("Couldn't save — please try again", 'error');
      return;
    }
    closeModal();
    renderSidebar();
    renderMainView();
    showToast(isEdit ? 'Task updated' : 'Task created', 'success');
  });

  if (isEdit) {
    $('#btn-delete-task').addEventListener('click', () => confirmDeleteTask(task.id));
  }
}

function confirmDeleteTask(taskId) {
  const project = getActiveProject();
  if (!project) return;

  openModal(`
    <div class="modal__header">
      <h2 class="modal__title">Delete Task?</h2>
      <button class="modal__close" id="modal-close">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <line x1="2" y1="2" x2="14" y2="14" stroke-linecap="round"/>
          <line x1="14" y1="2" x2="2" y2="14" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="modal__body">
      <p class="modal__confirm-text">
        This task will be permanently deleted. This cannot be undone.
      </p>
    </div>
    <div class="modal__footer">
      <div></div>
      <div class="modal__footer-right">
        <button class="btn-ghost" id="modal-cancel">Cancel</button>
        <button class="btn-danger" id="btn-confirm-delete">Delete Task</button>
      </div>
    </div>`);

  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-cancel').addEventListener('click', closeModal);
  $('#btn-confirm-delete').addEventListener('click', async () => {
    project.tasks = project.tasks.filter(t => t.id !== taskId);
    try {
      await DB.deleteTask(taskId);
    } catch (_) {
      showToast("Couldn't delete — please try again", 'error');
      return;
    }
    closeModal();
    renderSidebar();
    renderMainView();
    showToast('Task deleted', 'info');
  });
}

// =====================================================================
// SIDEBAR TOGGLE (MOBILE)
// =====================================================================
function toggleSidebar() {
  const sidebar  = $('#sidebar');
  const backdrop = $('#sidebar-backdrop');
  const isOpen   = sidebar.classList.toggle('sidebar--open');
  backdrop.classList.toggle('show', isOpen);
}

function closeSidebar() {
  $('#sidebar').classList.remove('sidebar--open');
  $('#sidebar-backdrop').classList.remove('show');
}

// =====================================================================
// EVENT WIRING
// =====================================================================
function attachEvents() {
  $('#btn-new-project').addEventListener('click', () => openProjectModal());
  $('#btn-add-task').addEventListener('click', () => openTaskModal(null, 'todo'));
  $('#btn-hamburger').addEventListener('click', toggleSidebar);
  $('#sidebar-backdrop').addEventListener('click', closeSidebar);

  // Analytics nav
  $('#sidebar-nav').addEventListener('click', e => {
    if (e.target.closest('#btn-analytics')) {
      state.view = 'analytics';
      renderSidebar();
      renderMainView();
      closeSidebar();
    }
  });

  // Close modal on overlay click or Escape
  $('#modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  // Project list: click to select, delete button to remove
  $('#sidebar-projects').addEventListener('click', e => {
    const deleteBtn = e.target.closest('.project-item__delete');
    const item      = e.target.closest('.project-item');

    if (deleteBtn) {
      e.stopPropagation();
      confirmDeleteProject(deleteBtn.dataset.id);
      return;
    }
    if (item) {
      const switchingView = state.view !== 'board';
      const switchingProject = item.dataset.id !== state.activeProjectId;
      if (switchingView || switchingProject) {
        state.view = 'board';
        state.activeProjectId = item.dataset.id;
        Store.setActiveId(item.dataset.id);
        renderSidebar();
        renderMainView();
        closeSidebar();
      }
    }
  });

  // Board: column footer "add task" + task card click to edit
  $('#board').addEventListener('click', e => {
    const footer = e.target.closest('.column__footer');
    if (footer) {
      openTaskModal(null, footer.dataset.column);
      return;
    }
    const card   = e.target.closest('.task-card');
    const handle = e.target.closest('.task-card__drag-handle');
    if (card && !handle) {
      const project = getActiveProject();
      if (!project) return;
      const task = project.tasks.find(t => t.id === card.dataset.id);
      if (task) openTaskModal(task);
    }
  });
}

// =====================================================================
// INIT
// =====================================================================
function offerLocalStorageMigration() {
  const raw = localStorage.getItem('ip_projects');
  if (!raw || state.projects.length > 0) return;
  if (localStorage.getItem('ip_migration_dismissed')) return;
  let old;
  try { old = JSON.parse(raw); } catch (_) { return; }
  if (!Array.isArray(old) || !old.length) return;

  const plural = old.length !== 1;
  openModal(`
    <div class="modal__header">
      <h2 class="modal__title">Migrate Local Data?</h2>
      <button class="modal__close" id="modal-close">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <line x1="2" y1="2" x2="14" y2="14" stroke-linecap="round"/>
          <line x1="14" y1="2" x2="2" y2="14" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
    <div class="modal__body">
      <p class="modal__confirm-text">
        You have ${old.length} project${plural ? 's' : ''} saved in this browser from before.
        Copy ${plural ? 'them' : 'it'} into this shared board?
      </p>
    </div>
    <div class="modal__footer">
      <div></div>
      <div class="modal__footer-right">
        <button class="btn-ghost" id="modal-cancel">Not now</button>
        <button class="btn-primary" id="btn-migrate">Migrate</button>
      </div>
    </div>`);

  const dismiss = () => {
    localStorage.setItem('ip_migration_dismissed', '1');
    closeModal();
  };
  $('#modal-close').addEventListener('click', dismiss);
  $('#modal-cancel').addEventListener('click', dismiss);
  $('#btn-migrate').addEventListener('click', async () => {
    closeModal();
    try {
      for (const p of old) {
        await DB.upsertProject(p);
        for (const t of (p.tasks || [])) {
          await DB.upsertTask(t, p.id);
        }
      }
      localStorage.removeItem('ip_projects');
      localStorage.removeItem('ip_active_project');
      await loadState();
      renderSidebar();
      renderMainView();
      showToast('Local data migrated to this board', 'success');
    } catch (_) {
      showToast("Migration failed — please try again", 'error');
    }
  });
}

async function init() {
  try {
    const config = await fetchConfig();
    if (!config) {
      showToast('Supabase credentials missing — set SUPABASE_URL / SUPABASE_ANON_KEY on Vercel, or fill in config.local.js', 'error');
      return;
    }
    sb = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
    boardId = await getOrCreateBoard();
  } catch (_) {
    showToast('Could not connect to server — check your Supabase configuration', 'error');
    return;
  }
  await loadState();
  subscribeToRealtime();
  renderSidebar();
  renderMainView();
  attachEvents();
  addShareButton();
  offerLocalStorageMigration();
}

function addShareButton() {
  if (document.getElementById('btn-share')) return;
  const btn = document.createElement('button');
  btn.id = 'btn-share';
  btn.className = 'btn-ghost';
  btn.style.cssText = 'font-size:0.8rem;padding:0.35rem 0.75rem;white-space:nowrap;';
  btn.textContent = 'Copy Share Link';
  btn.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href)
      .then(() => showToast('Board link copied!', 'success'))
      .catch(() => showToast("Couldn't copy link", 'error'));
  });
  document.getElementById('board-header').appendChild(btn);
}

document.addEventListener('DOMContentLoaded', init);
