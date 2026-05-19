-- =============================================================
-- Iridescent Prism — Supabase Schema
-- Run this in the Supabase SQL Editor (supabase.com → SQL Editor)
-- =============================================================

CREATE TABLE boards (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE projects (
  id         TEXT PRIMARY KEY,
  board_id   UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  board_id    UUID NOT NULL REFERENCES boards(id)   ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  assignee    TEXT,
  due_date    DATE,
  priority    TEXT NOT NULL CHECK (priority   IN ('Low', 'Medium', 'High', 'Urgent')),
  column_name TEXT NOT NULL CHECK (column_name IN ('todo', 'inprogress', 'done')),
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Table-level privileges for the anon role (used by the publishable / anon API key).
-- Postgres checks GRANTs BEFORE row-level security — without these, every request
-- fails with "permission denied" (error 42501), even with permissive RLS policies.
-- CREATE TABLE via the SQL editor does NOT grant these automatically.
GRANT SELECT, INSERT, UPDATE, DELETE ON boards   TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks    TO anon, authenticated;

-- Row Level Security (open access — no auth for now)
ALTER TABLE boards   ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_access" ON boards   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_access" ON projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_access" ON tasks    FOR ALL USING (true) WITH CHECK (true);

-- Required for Supabase Realtime UPDATE events to include full row data
ALTER TABLE projects REPLICA IDENTITY FULL;
ALTER TABLE tasks    REPLICA IDENTITY FULL;

-- =============================================================
-- After running this SQL:
--   1. Go to Database → Replication in the Supabase dashboard
--   2. Enable realtime for the "projects" and "tasks" tables
--   3. Copy your project URL + anon key from Settings → API
--   4. Add them as Vercel environment variables:
--        SUPABASE_URL
--        SUPABASE_ANON_KEY
-- =============================================================
