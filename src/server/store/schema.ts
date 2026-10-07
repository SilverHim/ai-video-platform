/** SQLite 迁移：只追加，不修改已有条目 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    origin TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    api_model TEXT NOT NULL,
    mode_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    upstream_task_id TEXT,
    base_url_id TEXT NOT NULL,
    form_json TEXT NOT NULL,
    request_json TEXT,
    error_json TEXT,
    failures_json TEXT,
    usage_json TEXT,
    actual_json TEXT,
    capture TEXT NOT NULL DEFAULT 'none',
    output_dir TEXT,
    parent_task_id TEXT,
    cost_json TEXT,
    poll_json TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    note TEXT
  );
  CREATE INDEX idx_tasks_created ON tasks(created_at DESC);
  CREATE INDEX idx_tasks_status ON tasks(status);
  CREATE UNIQUE INDEX idx_tasks_upstream ON tasks(provider_id, upstream_task_id) WHERE upstream_task_id IS NOT NULL;

  CREATE TABLE results (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    role TEXT NOT NULL,
    kind TEXT NOT NULL,
    path TEXT,
    mime TEXT,
    bytes INTEGER,
    width INTEGER,
    height INTEGER,
    remote_url TEXT,
    remote_expires_at INTEGER,
    layer_json TEXT,
    sha256 TEXT
  );
  CREATE UNIQUE INDEX idx_results_task_idx ON results(task_id, role, idx);

  CREATE TABLE exchanges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    status INTEGER,
    body TEXT NOT NULL
  );
  CREATE INDEX idx_exchanges_task ON exchanges(task_id, id);

  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE,
    filename TEXT,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    meta_json TEXT,
    uploads_json TEXT
  );

  CREATE TABLE capture_ledger (
    key TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    path TEXT,
    updated_at INTEGER NOT NULL,
    error TEXT
  );
  `,
];
