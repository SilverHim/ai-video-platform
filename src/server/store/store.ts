import { DatabaseSync } from 'node:sqlite';
import type { FormInput } from '../../shared/catalog/types.js';
import type { MediaMeta } from '../../shared/catalog/types.js';
import type { ExchangeRecord, PresetRecord, ResultRecord, TaskListQuery, TaskRecord, TemplateRecord } from '../../shared/task/records.js';
import { MIGRATIONS } from './schema.js';

type Row = Record<string, unknown>;

const j = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));
const p = <T>(v: unknown, fallback: T): T => (typeof v === 'string' ? (JSON.parse(v) as T) : fallback);

export interface AssetRecord {
  id: string;
  sha256: string;
  filename: string | null;
  mime: string;
  bytes: number;
  /** 相对 dataDir 的路径 */
  path: string;
  createdAt: number;
  meta: MediaMeta | null;
  /** 上传目标缓存：targetId → {url, expiresAt} */
  uploads: Record<string, { url: string; expiresAt: number | null }>;
}

export interface PollState {
  nextAt: number;
  attempts: number;
  consecutiveErrors: number;
  pausedReason?: string;
}

/**
 * 任务 / 结果 / 素材的持久化。基于 Node 内置 node:sqlite（同步 API），
 * 外面只暴露这个类，必要时可换成 better-sqlite3 实现同样的接口。
 */
export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file, { enableForeignKeyConstraints: true, timeout: 5000 });
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as Row | undefined;
    let version = row ? Number(row.value) : 0;
    while (version < MIGRATIONS.length) {
      this.tx(() => {
        this.db.exec(MIGRATIONS[version]!);
        version += 1;
        this.db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', $v) ON CONFLICT(key) DO UPDATE SET value = $v").run({ v: String(version) });
      });
    }
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /* ---------------- 任务 ---------------- */

  insertTask(t: Omit<TaskRecord, 'results'>): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, created_at, updated_at, origin, provider_id, model_id, api_model, mode_id, kind, status,
          upstream_task_id, base_url_id, form_json, request_json, error_json, failures_json, usage_json, actual_json, capture,
          output_dir, parent_task_id, cost_json, favorite, note)
         VALUES ($id, $created_at, $updated_at, $origin, $provider_id, $model_id, $api_model, $mode_id, $kind, $status,
          $upstream_task_id, $base_url_id, $form_json, $request_json, $error_json, $failures_json, $usage_json, $actual_json, $capture,
          $output_dir, $parent_task_id, $cost_json, $favorite, $note)`,
      )
      .run({
        id: t.id,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
        origin: t.origin,
        provider_id: t.providerId,
        model_id: t.modelId,
        api_model: t.apiModel,
        mode_id: t.modeId,
        kind: t.kind,
        status: t.status,
        upstream_task_id: t.upstreamTaskId,
        base_url_id: t.baseUrlId,
        form_json: JSON.stringify(t.form),
        request_json: j(t.request),
        error_json: j(t.error),
        failures_json: j(t.failures),
        usage_json: j(t.usage),
        actual_json: j(t.actual),
        capture: t.capture,
        output_dir: t.outputDir,
        parent_task_id: t.parentTaskId,
        cost_json: j(t.costEstimate),
        favorite: t.favorite ? 1 : 0,
        note: t.note,
      });
  }

  updateTask(id: string, patch: Partial<Omit<TaskRecord, 'id' | 'results' | 'createdAt'>>, now = Date.now()): void {
    const cols: Record<string, unknown> = { updated_at: now };
    const map: Record<string, [string, (v: unknown) => unknown]> = {
      status: ['status', (v) => v],
      upstreamTaskId: ['upstream_task_id', (v) => v],
      request: ['request_json', j],
      error: ['error_json', j],
      failures: ['failures_json', j],
      usage: ['usage_json', j],
      actual: ['actual_json', j],
      capture: ['capture', (v) => v],
      outputDir: ['output_dir', (v) => v],
      costEstimate: ['cost_json', j],
      favorite: ['favorite', (v) => (v ? 1 : 0)],
      note: ['note', (v) => v],
      form: ['form_json', (v) => JSON.stringify(v)],
    };
    for (const [k, v] of Object.entries(patch)) {
      const m = map[k];
      if (m) cols[m[0]] = m[1](v);
    }
    const sets = Object.keys(cols).map((c) => `${c} = $${c}`).join(', ');
    this.db.prepare(`UPDATE tasks SET ${sets} WHERE id = $id`).run({ ...(cols as Record<string, string | number | null>), id });
  }

  setPoll(id: string, poll: PollState | null): void {
    this.db.prepare('UPDATE tasks SET poll_json = $poll WHERE id = $id').run({ poll: j(poll), id });
  }

  getPoll(id: string): PollState | null {
    const row = this.db.prepare('SELECT poll_json FROM tasks WHERE id = $id').get({ id }) as Row | undefined;
    return p<PollState | null>(row?.poll_json, null);
  }

  getTask(id: string): TaskRecord | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = $id').get({ id }) as Row | undefined;
    return row ? this.toTask(row) : null;
  }

  findByUpstream(providerId: string, upstreamTaskId: string): TaskRecord | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE provider_id = $p AND upstream_task_id = $u').get({ p: providerId, u: upstreamTaskId }) as Row | undefined;
    return row ? this.toTask(row) : null;
  }

  listTasks(q: TaskListQuery = {}): TaskRecord[] {
    const where: string[] = [];
    const args: Record<string, string | number> = {};
    const add = (cond: string, key: string, v: string | number | undefined) => {
      if (v === undefined || v === '') return;
      where.push(cond);
      args[key] = v;
    };
    add('created_at < $before', 'before', q.before);
    add('status = $status', 'status', q.status);
    add('provider_id = $provider', 'provider', q.providerId);
    add('model_id = $model', 'model', q.modelId);
    add('origin = $origin', 'origin', q.origin);
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
    const sql = `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ${limit}`;
    return (this.db.prepare(sql).all(args) as Row[]).map((r) => this.toTask(r));
  }

  /** 需要继续轮询的异步任务 */
  listActiveAsync(): TaskRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE kind = 'async' AND status IN ('queued','running','unknown') AND upstream_task_id IS NOT NULL ORDER BY created_at")
      .all() as Row[];
    return rows.map((r) => this.toTask(r));
  }

  deleteTask(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM tasks WHERE id = $id').run({ id }).changes) > 0;
  }

  /* ---------------- 结果 ---------------- */

  upsertResult(r: ResultRecord & { sha256?: string | null }): void {
    this.db
      .prepare(
        `INSERT INTO results (id, task_id, idx, role, kind, path, mime, bytes, width, height, remote_url, remote_expires_at, layer_json, sha256)
         VALUES ($id, $task_id, $idx, $role, $kind, $path, $mime, $bytes, $width, $height, $remote_url, $remote_expires_at, $layer_json, $sha256)
         ON CONFLICT(task_id, role, idx) DO UPDATE SET path = excluded.path, mime = excluded.mime, bytes = excluded.bytes,
           width = excluded.width, height = excluded.height, remote_url = excluded.remote_url,
           remote_expires_at = excluded.remote_expires_at, layer_json = excluded.layer_json, sha256 = excluded.sha256`,
      )
      .run({
        id: r.id,
        task_id: r.taskId,
        idx: r.index,
        role: r.role,
        kind: r.kind,
        path: r.path,
        mime: r.mime,
        bytes: r.bytes,
        width: r.width,
        height: r.height,
        remote_url: r.remoteUrl,
        remote_expires_at: r.remoteExpiresAt,
        layer_json: j(r.layer),
        sha256: r.sha256 ?? null,
      });
  }

  listResults(taskId: string): ResultRecord[] {
    const rows = this.db.prepare('SELECT * FROM results WHERE task_id = $t ORDER BY role, idx').all({ t: taskId }) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      taskId: String(r.task_id),
      index: Number(r.idx),
      role: r.role as ResultRecord['role'],
      kind: r.kind as ResultRecord['kind'],
      path: (r.path as string | null) ?? null,
      mime: (r.mime as string | null) ?? null,
      bytes: r.bytes === null ? null : Number(r.bytes),
      width: r.width === null ? null : Number(r.width),
      height: r.height === null ? null : Number(r.height),
      remoteUrl: (r.remote_url as string | null) ?? null,
      remoteExpiresAt: r.remote_expires_at === null ? null : Number(r.remote_expires_at),
      layer: p(r.layer_json, null),
    }));
  }

  /* ---------------- 交换记录 ---------------- */

  addExchange(e: Omit<ExchangeRecord, 'id'>, keepLast = 50): void {
    this.db.prepare('INSERT INTO exchanges (task_id, at, kind, status, body) VALUES ($t, $at, $kind, $status, $body)').run({
      t: e.taskId,
      at: e.at,
      kind: e.kind,
      status: e.status,
      body: e.body.length > 200_000 ? `${e.body.slice(0, 200_000)}…(已截断)` : e.body,
    });
    // 只保留第一条 submit 和最近 keepLast 条，避免轮询记录无限增长
    this.db
      .prepare(
        `DELETE FROM exchanges WHERE task_id = $t AND kind = 'poll' AND id NOT IN (
           SELECT id FROM exchanges WHERE task_id = $t AND kind = 'poll' ORDER BY id DESC LIMIT ${keepLast})`,
      )
      .run({ t: e.taskId });
  }

  listExchanges(taskId: string): ExchangeRecord[] {
    const rows = this.db.prepare('SELECT * FROM exchanges WHERE task_id = $t ORDER BY id').all({ t: taskId }) as Row[];
    return rows.map((r) => ({ id: Number(r.id), taskId: String(r.task_id), at: Number(r.at), kind: r.kind as ExchangeRecord['kind'], status: r.status === null ? null : Number(r.status), body: String(r.body) }));
  }

  /* ---------------- 素材 ---------------- */

  insertAsset(a: AssetRecord): void {
    this.db
      .prepare('INSERT INTO assets (id, sha256, filename, mime, bytes, path, created_at, meta_json, uploads_json) VALUES ($id, $sha, $fn, $mime, $bytes, $path, $at, $meta, $uploads)')
      .run({ id: a.id, sha: a.sha256, fn: a.filename, mime: a.mime, bytes: a.bytes, path: a.path, at: a.createdAt, meta: j(a.meta), uploads: j(a.uploads) });
  }

  getAsset(id: string): AssetRecord | null {
    const row = this.db.prepare('SELECT * FROM assets WHERE id = $id').get({ id }) as Row | undefined;
    return row ? this.toAsset(row) : null;
  }

  getAssetBySha(sha256: string): AssetRecord | null {
    const row = this.db.prepare('SELECT * FROM assets WHERE sha256 = $s').get({ s: sha256 }) as Row | undefined;
    return row ? this.toAsset(row) : null;
  }

  setAssetUploads(id: string, uploads: AssetRecord['uploads']): void {
    this.db.prepare('UPDATE assets SET uploads_json = $u WHERE id = $id').run({ u: j(uploads), id });
  }

  /* ---------------- 落盘账本（保证每个结果只下载一次） ---------------- */

  getLedger(key: string): { state: string; path: string | null } | null {
    const row = this.db.prepare('SELECT state, path FROM capture_ledger WHERE key = $k').get({ k: key }) as Row | undefined;
    return row ? { state: String(row.state), path: (row.path as string | null) ?? null } : null;
  }

  setLedger(key: string, state: 'downloading' | 'done' | 'failed', path: string | null, error: string | null = null, now = Date.now()): void {
    this.db
      .prepare('INSERT INTO capture_ledger (key, state, path, updated_at, error) VALUES ($k, $s, $p, $at, $e) ON CONFLICT(key) DO UPDATE SET state = $s, path = $p, updated_at = $at, error = $e')
      .run({ k: key, s: state, p: path, at: now, e: error });
  }

  /* ---------------- 预设 / 模板 ---------------- */

  listPresets(modelId?: string): PresetRecord[] {
    const rows = (modelId ? this.db.prepare('SELECT * FROM presets WHERE model_id = $m ORDER BY updated_at DESC').all({ m: modelId }) : this.db.prepare('SELECT * FROM presets ORDER BY updated_at DESC').all()) as Row[];
    return rows.map((r) => ({ id: String(r.id), name: String(r.name), modelId: String(r.model_id), modeId: String(r.mode_id), values: p(r.values_json, {}), prompt: (r.prompt as string | null) ?? null, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) }));
  }

  getPreset(id: string): PresetRecord | null {
    return this.listPresets().find((x) => x.id === id) ?? null;
  }

  upsertPreset(x: PresetRecord): void {
    this.db
      .prepare(
        `INSERT INTO presets (id, name, model_id, mode_id, values_json, prompt, created_at, updated_at) VALUES ($id, $name, $m, $mode, $v, $prompt, $c, $u)
         ON CONFLICT(id) DO UPDATE SET name = $name, model_id = $m, mode_id = $mode, values_json = $v, prompt = $prompt, updated_at = $u`,
      )
      .run({ id: x.id, name: x.name, m: x.modelId, mode: x.modeId, v: JSON.stringify(x.values), prompt: x.prompt, c: x.createdAt, u: x.updatedAt });
  }

  deletePreset(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM presets WHERE id = $id').run({ id }).changes) > 0;
  }

  listTemplates(): TemplateRecord[] {
    return (this.db.prepare('SELECT * FROM templates ORDER BY updated_at DESC').all() as Row[]).map((r) => ({ id: String(r.id), name: String(r.name), text: String(r.text), tags: p(r.tags_json, []), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) }));
  }

  upsertTemplate(x: TemplateRecord): void {
    this.db
      .prepare(
        `INSERT INTO templates (id, name, text, tags_json, created_at, updated_at) VALUES ($id, $name, $text, $tags, $c, $u)
         ON CONFLICT(id) DO UPDATE SET name = $name, text = $text, tags_json = $tags, updated_at = $u`,
      )
      .run({ id: x.id, name: x.name, text: x.text, tags: JSON.stringify(x.tags), c: x.createdAt, u: x.updatedAt });
  }

  deleteTemplate(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM templates WHERE id = $id').run({ id }).changes) > 0;
  }

  /* ---------------- 行转换 ---------------- */

  private toTask(r: Row): TaskRecord {
    const id = String(r.id);
    return {
      id,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      origin: r.origin as TaskRecord['origin'],
      providerId: String(r.provider_id),
      modelId: String(r.model_id),
      apiModel: String(r.api_model),
      modeId: String(r.mode_id),
      kind: r.kind as TaskRecord['kind'],
      status: r.status as TaskRecord['status'],
      upstreamTaskId: (r.upstream_task_id as string | null) ?? null,
      baseUrlId: String(r.base_url_id),
      form: p<FormInput>(r.form_json, {} as FormInput),
      request: p(r.request_json, null),
      error: p(r.error_json, null),
      failures: p(r.failures_json, []),
      usage: p(r.usage_json, null),
      actual: p(r.actual_json, null),
      capture: r.capture as TaskRecord['capture'],
      outputDir: (r.output_dir as string | null) ?? null,
      parentTaskId: (r.parent_task_id as string | null) ?? null,
      costEstimate: p(r.cost_json, null),
      favorite: Number(r.favorite) === 1,
      note: (r.note as string | null) ?? null,
      results: this.listResults(id),
    };
  }

  private toAsset(r: Row): AssetRecord {
    return {
      id: String(r.id),
      sha256: String(r.sha256),
      filename: (r.filename as string | null) ?? null,
      mime: String(r.mime),
      bytes: Number(r.bytes),
      path: String(r.path),
      createdAt: Number(r.created_at),
      meta: p(r.meta_json, null),
      uploads: p(r.uploads_json, {}),
    };
  }
}
