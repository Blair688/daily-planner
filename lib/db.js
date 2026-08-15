const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'daily-planner.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    start_min INTEGER,
    duration_min INTEGER,
    priority TEXT NOT NULL DEFAULT 'P2',
    category TEXT NOT NULL DEFAULT '其他',
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    sync_calendar INTEGER NOT NULL DEFAULT 1,
    sync_reminder INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'local',
    locked INTEGER NOT NULL DEFAULT 0,
    remote_kind TEXT,
    remote_uid TEXT,
    remote_href TEXT,
    remote_etag TEXT,
    remote_updated TEXT,
    last_synced_at TEXT,
    deleted_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);
  CREATE INDEX IF NOT EXISTS idx_tasks_remote_uid ON tasks(remote_uid);
  CREATE INDEX IF NOT EXISTS idx_tasks_remote_href ON tasks(remote_href);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '其他',
    duration_min INTEGER NOT NULL DEFAULT 30,
    time_block TEXT NOT NULL DEFAULT 'afternoon',
    start_min INTEGER,
    end_min INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1
  );
`);

const DEFAULT_SETTINGS = {
  apple_id: '',
  app_password: '',
  calendar_href: '',
  reminder_href: '',
  sync_interval_min: '10',
  sync_calendar_enabled: '1',
  sync_reminder_enabled: '0',
  last_sync_at: '',
  last_sync_status: '',
  last_sync_message: '',
  timezone: 'Asia/Shanghai',
  theme_preset: 'emerald',
  theme_color: '#1f6f5c',
  day_start_min: '540',
  day_end_min: '1320',
  lunch_start_min: '720',
  lunch_end_min: '810'
};

const DEFAULT_RULES = [
  ['会议', '工作', 60, 'morning'],
  ['开会', '工作', 60, 'morning'],
  ['写作', '工作', 90, 'morning'],
  ['报告', '工作', 90, 'morning'],
  ['方案', '工作', 90, 'morning'],
  ['文档', '工作', 60, 'morning'],
  ['阅读', '学习', 60, 'afternoon'],
  ['学习', '学习', 60, 'afternoon'],
  ['课程', '学习', 60, 'afternoon'],
  ['健身', '健康', 45, 'evening'],
  ['跑步', '健康', 45, 'evening'],
  ['运动', '健康', 45, 'evening'],
  ['瑜伽', '健康', 45, 'evening'],
  ['散步', '健康', 30, 'evening'],
  ['冥想', '健康', 20, 'evening'],
  ['买菜', '生活', 30, 'evening'],
  ['购物', '生活', 30, 'evening'],
  ['家务', '生活', 30, 'evening'],
  ['电话', '工作', 20, 'afternoon']
];

function nowIso() {
  return new Date().toISOString();
}

function init() {
  const ruleColumns = db.prepare('PRAGMA table_info(rules)').all();
  if (!ruleColumns.some((column) => column.name === 'start_min')) {
    db.exec('ALTER TABLE rules ADD COLUMN start_min INTEGER');
  }
  if (!ruleColumns.some((column) => column.name === 'end_min')) {
    db.exec('ALTER TABLE rules ADD COLUMN end_min INTEGER');
  }

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insertSetting.run(key, value);
  }

  const ruleCount = db.prepare('SELECT COUNT(*) AS count FROM rules').get().count;
  if (ruleCount === 0) {
    const insertRule = db.prepare(
      'INSERT INTO rules (keyword, category, duration_min, time_block, enabled) VALUES (?, ?, ?, ?, 1)'
    );
    const insertMany = db.transaction((rows) => {
      for (const row of rows) insertRule.run(...row);
    });
    insertMany(DEFAULT_RULES);
  }
}

const CATEGORIES = ['工作', '学习', '生活', '健康', '其他'];
const PRIORITIES = ['P1', 'P2', 'P3'];

function normalizePriority(value) {
  return PRIORITIES.includes(value) ? value : 'P2';
}

function normalizeCategory(value) {
  return CATEGORIES.includes(value) ? value : '其他';
}

function normalizeBool(value, fallback) {
  if (value === undefined || value === null) return fallback ? 1 : 0;
  return value ? 1 : 0;
}

function normalizeInt(value, { min = 0, max = 1440, fallback = null } = {}) {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) return fallback;
  return Math.round(num);
}

function taskFromRow(row) {
  if (!row) return null;
  return {
    ...row,
    sync_calendar: Boolean(row.sync_calendar),
    sync_reminder: Boolean(row.sync_reminder),
    locked: Boolean(row.locked)
  };
}

function validateTaskInput(input, { partial = false } = {}) {
  const out = {};
  if (!partial || input.title !== undefined) {
    const title = String(input.title || '').trim();
    if (!title) throw new Error('任务标题不能为空');
    out.title = title;
  }
  if (!partial || input.date !== undefined) {
    const date = String(input.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式应为 YYYY-MM-DD');
    out.date = date;
  }
  if (input.priority !== undefined) out.priority = normalizePriority(input.priority);
  if (input.category !== undefined) out.category = normalizeCategory(input.category);
  if (input.note !== undefined) out.note = String(input.note || '');
  if (input.start_min !== undefined) {
    const start = normalizeInt(input.start_min, { min: 0, max: 1439, fallback: null });
    out.start_min = start;
    if (input.locked === undefined) out.locked = start === null ? 0 : 1;
  }
  if (input.locked !== undefined) out.locked = normalizeBool(input.locked, false);
  if (input.duration_min !== undefined) {
    out.duration_min = normalizeInt(input.duration_min, { min: 1, max: 1440, fallback: null });
  }
  if (input.status !== undefined) {
    out.status = input.status === 'done' ? 'done' : 'pending';
  }
  if (input.sync_calendar !== undefined) {
    out.sync_calendar = normalizeBool(input.sync_calendar, true);
  }
  if (input.sync_reminder !== undefined) {
    out.sync_reminder = normalizeBool(input.sync_reminder, false);
  }
  if (input.source !== undefined) {
    out.source = input.source === 'icloud' ? 'icloud' : 'local';
  }
  if (input.remote_kind !== undefined) out.remote_kind = String(input.remote_kind || '');
  if (input.remote_uid !== undefined) out.remote_uid = String(input.remote_uid || '');
  if (input.remote_href !== undefined) out.remote_href = String(input.remote_href || '');
  if (input.remote_etag !== undefined) out.remote_etag = String(input.remote_etag || '');
  if (input.remote_updated !== undefined) out.remote_updated = String(input.remote_updated || '');
  if (input.last_synced_at !== undefined) out.last_synced_at = String(input.last_synced_at || '');
  return out;
}

function getTasks({ date, includeDeleted = false, from, to } = {}) {
  const clauses = [];
  const params = [];
  if (!includeDeleted) clauses.push('deleted_at IS NULL');
  if (date) {
    clauses.push('date = ?');
    params.push(date);
  } else if (from && to) {
    clauses.push('date >= ? AND date <= ?');
    params.push(from, to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT * FROM tasks
    ${where}
    ORDER BY date ASC,
      CASE priority WHEN 'P1' THEN 0 WHEN 'P2' THEN 1 ELSE 2 END,
      COALESCE(start_min, 1440) ASC,
      id DESC
  `).all(...params);
  return rows.map(taskFromRow);
}

function getTask(id) {
  return taskFromRow(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
}

function createTask(input) {
  const data = validateTaskInput(input);
  const timestamp = nowIso();
  const result = db.prepare(`
    INSERT INTO tasks (
      title, date, start_min, duration_min, priority, category, note, status,
      sync_calendar, sync_reminder, source, locked, remote_kind, remote_uid, remote_href,
      remote_etag, remote_updated, last_synced_at, created_at, updated_at
    ) VALUES (
      @title, @date, @start_min, @duration_min, @priority, @category, @note, @status,
      @sync_calendar, @sync_reminder, @source, @locked, @remote_kind, @remote_uid, @remote_href,
      @remote_etag, @remote_updated, @last_synced_at, @created_at, @updated_at
    )
  `).run({
    title: data.title,
    date: data.date,
    start_min: data.start_min ?? null,
    duration_min: data.duration_min ?? null,
    priority: data.priority ?? 'P2',
    category: data.category ?? '其他',
    note: data.note ?? '',
    status: data.status ?? 'pending',
    sync_calendar: data.sync_calendar ?? 1,
    sync_reminder: data.sync_reminder ?? 0,
    source: data.source ?? 'local',
    locked: data.locked ?? 0,
    remote_kind: data.remote_kind ?? null,
    remote_uid: data.remote_uid ?? null,
    remote_href: data.remote_href ?? null,
    remote_etag: data.remote_etag ?? null,
    remote_updated: data.remote_updated ?? null,
    last_synced_at: data.last_synced_at ?? null,
    created_at: timestamp,
    updated_at: timestamp
  });
  return getTask(result.lastInsertRowid);
}

function updateTask(id, changes) {
  const existing = getTask(id);
  if (!existing) return null;
  const data = validateTaskInput(changes, { partial: true });

  if (changes.status !== undefined) {
    data.completed_at = changes.status === 'done' ? nowIso() : null;
  }

  const fields = [
    'title', 'date', 'start_min', 'duration_min', 'priority', 'category', 'note',
    'status', 'sync_calendar', 'sync_reminder', 'source', 'locked', 'remote_kind',
    'remote_uid', 'remote_href', 'remote_etag', 'remote_updated', 'last_synced_at',
    'completed_at'
  ];
  const assignments = [];
  const params = { id };
  for (const field of fields) {
    if (data[field] !== undefined) {
      assignments.push(`${field} = @${field}`);
      params[field] = data[field];
    }
  }
  params.updated_at = nowIso();
  assignments.push('updated_at = @updated_at');

  if (assignments.length === 0) return existing;
  db.prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = @id`).run(params);
  return getTask(id);
}

function softDeleteTask(id) {
  const existing = getTask(id);
  if (!existing) return null;
  db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
    nowIso(),
    nowIso(),
    id
  );
  return getTask(id);
}

function purgeDeletedTask(id) {
  db.prepare('DELETE FROM tasks WHERE id = ? AND deleted_at IS NOT NULL').run(id);
}

function hardDeleteTask(id) {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

function listDeletedTasks() {
  return db
    .prepare("SELECT * FROM tasks WHERE deleted_at IS NOT NULL ORDER BY updated_at ASC")
    .all()
    .map(taskFromRow);
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

function setSettings(patch) {
  const current = getSettings();
  const next = { ...current };
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key)) continue;
    if (key === 'sync_interval_min') {
      const num = Number(value);
      next[key] = Number.isFinite(num) && num >= 1 ? String(Math.round(num)) : current[key];
    } else if (key === 'sync_calendar_enabled' || key === 'sync_reminder_enabled') {
      next[key] = value ? '1' : '0';
    } else if (['day_start_min', 'day_end_min', 'lunch_start_min', 'lunch_end_min'].includes(key)) {
      const num = Number(value);
      next[key] = Number.isFinite(num) && num >= 0 && num <= 1440 ? String(Math.round(num)) : current[key];
    } else if (key === 'theme_color') {
      const color = String(value || '').trim();
      next[key] = /^#[0-9a-fA-F]{6}$/.test(color) ? color : current[key];
    } else if (key === 'theme_preset') {
      next[key] = String(value || '').trim() || current[key];
    } else {
      next[key] = String(value ?? '');
    }
  }

  const upsert = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(next)) upsert.run(key, value);
  });
  transaction();
  return getSettings();
}

function setSetting(key, value) {
  return setSettings({ [key]: value });
}

function getRules() {
  return db.prepare('SELECT * FROM rules ORDER BY id ASC').all();
}

function replaceRules(rules) {
  if (!Array.isArray(rules)) throw new Error('规则必须是数组');
  const clean = rules.map((rule, index) => ({
    keyword: String(rule.keyword || '').trim(),
    category: normalizeCategory(rule.category),
    duration_min: normalizeInt(rule.duration_min, { min: 1, max: 1440, fallback: 30 }),
    time_block: ['morning', 'afternoon', 'evening'].includes(rule.time_block)
      ? rule.time_block
      : 'afternoon',
    start_min: normalizeInt(rule.start_min, { min: 0, max: 1439, fallback: null }),
    end_min: normalizeInt(rule.end_min, { min: 1, max: 1439, fallback: null }),
    enabled: rule.enabled === false || rule.enabled === 0 ? 0 : 1
  }));
  const missingKeyword = clean.some((rule) => !rule.keyword);
  if (missingKeyword) throw new Error('规则关键词不能为空');

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM rules').run();
    const insert = db.prepare(`
      INSERT INTO rules (keyword, category, duration_min, time_block, start_min, end_min, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const rule of clean) {
      insert.run(
        rule.keyword,
        rule.category,
        rule.duration_min,
        rule.time_block,
        rule.start_min,
        rule.end_min,
        rule.enabled
      );
    }
  });
  transaction();
  return getRules();
}

function exportData() {
  return {
    version: 1,
    exported_at: nowIso(),
    settings: getSettings(),
    rules: getRules(),
    tasks: getTasks({ includeDeleted: false })
  };
}

function importData(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('备份内容无效');
  const transaction = db.transaction(() => {
    if (Array.isArray(payload.settings) || (payload.settings && typeof payload.settings === 'object')) {
      const settings = { ...getSettings(), ...payload.settings };
      delete settings.app_password;
      setSettings(settings);
    }
    if (Array.isArray(payload.rules)) replaceRules(payload.rules);
    if (Array.isArray(payload.tasks)) {
      db.prepare('DELETE FROM tasks').run();
      for (const task of payload.tasks) {
        createTask({
          title: task.title,
          date: task.date,
          start_min: task.start_min,
          duration_min: task.duration_min,
          priority: task.priority,
          category: task.category,
          note: task.note,
          status: task.status,
          sync_calendar: task.sync_calendar,
          sync_reminder: task.sync_reminder,
          source: task.source,
          locked: task.locked
        });
      }
    }
  });
  transaction();
  return exportData();
}

init();

module.exports = {
  db,
  init,
  nowIso,
  getTasks,
  getTask,
  createTask,
  updateTask,
  softDeleteTask,
  purgeDeletedTask,
  hardDeleteTask,
  listDeletedTasks,
  getSettings,
  setSettings,
  setSetting,
  getRules,
  replaceRules,
  exportData,
  importData,
  CATEGORIES,
  PRIORITIES
};
