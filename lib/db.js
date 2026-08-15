const crypto = require('crypto');
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
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT,
    avatar_color TEXT NOT NULL DEFAULT '#1f6f5c',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    start_min INTEGER,
    duration_min INTEGER,
    priority TEXT NOT NULL DEFAULT 'P2',
    category TEXT NOT NULL DEFAULT '其他',
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    sync_calendar INTEGER NOT NULL DEFAULT 0,
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

  CREATE INDEX IF NOT EXISTS idx_tasks_remote_uid ON tasks(remote_uid);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (user_id, key)
  );

  CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE CASCADE,
    keyword TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '其他',
    duration_min INTEGER NOT NULL DEFAULT 30,
    time_block TEXT NOT NULL DEFAULT 'afternoon',
    start_min INTEGER,
    end_min INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'star',
    color TEXT NOT NULL DEFAULT '#1f6f5c',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS habit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (habit_id, date)
  );

  CREATE TABLE IF NOT EXISTS focus_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    task_id INTEGER,
    minutes INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS weekly_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    week INTEGER NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, year, week)
  );

  CREATE TABLE IF NOT EXISTS daily_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, date)
  );

  CREATE TABLE IF NOT EXISTS yearly_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, year)
  );

  CREATE TABLE IF NOT EXISTS annual_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const DEFAULT_SETTINGS = {
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
  ['电话', '工作', 20, 'afternoon'],
  ['多邻国', '学习', 20, 'afternoon'],
  ['背单词', '学习', 30, 'afternoon'],
  ['百词斩', '学习', 20, 'afternoon'],
  ['作业', '学习', 60, 'afternoon'],
  ['回复', '工作', 30, 'afternoon'],
  ['整理', '生活', 30, 'evening'],
  ['通勤', '生活', 30, 'morning'],
  ['早餐', '生活', 20, 'morning'],
  ['午餐', '生活', 30, 'afternoon'],
  ['晚餐', '生活', 30, 'evening']
];

const CATEGORIES = ['工作', '学习', '生活', '健康', '其他'];
const PRIORITIES = ['P1', 'P2', 'P3'];
const AVATAR_COLORS = ['#1f6f5c', '#2563eb', '#e8622d', '#c2415c', '#6b7a3f', '#7c5cbf'];

function nowIso() {
  return new Date().toISOString();
}

function normalizePriority(value) {
  return PRIORITIES.includes(value) ? value : 'P2';
}

function normalizeCategory(value) {
  return CATEGORIES.includes(value) ? value : '其他';
}

function normalizeBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback ? 1 : 0;
  return value ? 1 : 0;
}

function normalizeInt(value, { min = 0, max = 1440, fallback = null } = {}) {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) return fallback;
  return Math.round(num);
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureDefaultUser() {
  let user = db.prepare('SELECT * FROM users WHERE username = ?').get('default');
  if (!user) {
    const result = db.prepare(`
      INSERT INTO users (username, display_name, password_hash, avatar_color, created_at)
      VALUES ('default', '默认用户', NULL, '#1f6f5c', ?)
    `).run(nowIso());
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  }

  db.prepare('UPDATE tasks SET user_id = ? WHERE user_id IS NULL OR user_id = 0').run(user.id);
  db.prepare('UPDATE rules SET user_id = ? WHERE user_id IS NULL OR user_id = 0').run(user.id);

  const legacySettings = db.prepare('SELECT key, value FROM settings').all();
  const upsertSetting = db.prepare(`
    INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
  `);
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const legacy = legacySettings.find((row) => row.key === key);
    upsertSetting.run(user.id, key, legacy ? legacy.value : value);
  }

  const ruleCount = db.prepare('SELECT COUNT(*) AS count FROM rules WHERE user_id = ?').get(user.id).count;
  if (ruleCount === 0) {
    const insertRule = db.prepare(`
      INSERT INTO rules (user_id, keyword, category, duration_min, time_block, enabled)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    const insertMany = db.transaction((rows) => {
      for (const row of rows) insertRule.run(user.id, ...row);
    });
    insertMany(DEFAULT_RULES);
  } else {
    ensureDefaultRulesForUser(user.id);
  }
  return user;
}

function init() {
  ensureColumn('tasks', 'user_id', 'INTEGER NOT NULL DEFAULT 1');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(user_id, date)');
  ensureColumn('rules', 'user_id', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('rules', 'start_min', 'INTEGER');
  ensureColumn('rules', 'end_min', 'INTEGER');
  ensureDefaultUser();
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    avatar_color: row.avatar_color,
    has_password: Boolean(row.password_hash),
    created_at: row.created_at
  };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password || ''), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function createUser({ username, display_name: displayName, password }) {
  const cleanUsername = String(username || '').trim().toLowerCase();
  const cleanName = String(displayName || '').trim() || cleanUsername;
  if (!/^[a-z0-9_\-\u4e00-\u9fa5]{2,32}$/i.test(cleanUsername)) {
    throw new Error('用户名需为 2-32 位字母、数字、下划线、连字符或中文');
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (exists) throw new Error('用户名已存在');

  const result = db.prepare(`
    INSERT INTO users (username, display_name, password_hash, avatar_color, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    cleanUsername,
    cleanName,
    password ? hashPassword(password) : null,
    AVATAR_COLORS[crypto.randomInt(AVATAR_COLORS.length)],
    nowIso()
  );
  const userId = result.lastInsertRowid;
  seedRulesForUser(userId);
  return getUserById(userId);
}

function seedRulesForUser(userId) {
  const insert = db.prepare(`
    INSERT INTO rules (user_id, keyword, category, duration_min, time_block, enabled)
    VALUES (?, ?, ?, ?, ?, 1)
  `);
  const transaction = db.transaction(() => {
    for (const rule of DEFAULT_RULES) insert.run(userId, ...rule);
  });
  transaction();
}

function ensureDefaultRulesForUser(userId) {
  const existing = new Set(
    db.prepare('SELECT keyword FROM rules WHERE user_id = ?').all(userId).map((row) => row.keyword)
  );
  const insert = db.prepare(`
    INSERT INTO rules (user_id, keyword, category, duration_min, time_block, enabled)
    VALUES (?, ?, ?, ?, ?, 1)
  `);
  const transaction = db.transaction(() => {
    for (const rule of DEFAULT_RULES) {
      if (!existing.has(rule[0])) insert.run(userId, ...rule);
    }
  });
  transaction();
}

function getUserById(id) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? publicUser(row) : null;
}

function getUserByUsername(username) {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim().toLowerCase());
  return row ? publicUser(row) : null;
}

function findUserAuth(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim().toLowerCase()) || null;
}

function listUsers() {
  return db.prepare('SELECT * FROM users ORDER BY id ASC').all().map(publicUser);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, nowIso(), expiresAt);
  return token;
}

function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT users.* FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ? AND sessions.expires_at > ?
  `).get(token, nowIso());
  return row ? publicUser(row) : null;
}

function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function getSettings(userId) {
  const rows = db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(userId);
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

function setSettings(userId, patch) {
  const current = getSettings(userId);
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    if (['day_start_min', 'day_end_min', 'lunch_start_min', 'lunch_end_min'].includes(key)) {
      const num = Number(value);
      next[key] = Number.isFinite(num) && num >= 0 && num <= 1440 ? String(Math.round(num)) : current[key];
    } else if (key === 'theme_color') {
      next[key] = /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value) : current[key];
    } else if (key === 'theme_preset') {
      next[key] = String(value || '').trim() || current[key];
    } else {
      next[key] = String(value ?? '');
    }
  }
  const upsert = db.prepare(`
    INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
  `);
  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(next)) upsert.run(userId, key, value);
  });
  transaction();
  return getSettings(userId);
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
  if (input.status !== undefined) out.status = input.status === 'done' ? 'done' : 'pending';
  if (input.source !== undefined) out.source = input.source === 'icloud' ? 'icloud' : 'local';
  if (input.remote_kind !== undefined) out.remote_kind = String(input.remote_kind || '');
  if (input.remote_uid !== undefined) out.remote_uid = String(input.remote_uid || '');
  if (input.remote_href !== undefined) out.remote_href = String(input.remote_href || '');
  if (input.remote_etag !== undefined) out.remote_etag = String(input.remote_etag || '');
  if (input.remote_updated !== undefined) out.remote_updated = String(input.remote_updated || '');
  if (input.last_synced_at !== undefined) out.last_synced_at = String(input.last_synced_at || '');
  return out;
}

function getTasks({ userId, date, includeDeleted = false, from, to } = {}) {
  const clauses = ['user_id = ?'];
  const params = [userId];
  if (!includeDeleted) clauses.push('deleted_at IS NULL');
  if (date) {
    clauses.push('date = ?');
    params.push(date);
  } else if (from && to) {
    clauses.push('date >= ? AND date <= ?');
    params.push(from, to);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;
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

function getTask(id, userId) {
  return taskFromRow(db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, userId));
}

function createTask(input, userId) {
  const data = validateTaskInput(input);
  const timestamp = nowIso();
  const result = db.prepare(`
    INSERT INTO tasks (
      user_id, title, date, start_min, duration_min, priority, category, note, status,
      sync_calendar, sync_reminder, source, locked, created_at, updated_at
    ) VALUES (
      @user_id, @title, @date, @start_min, @duration_min, @priority, @category, @note, @status,
      @sync_calendar, @sync_reminder, @source, @locked, @created_at, @updated_at
    )
  `).run({
    user_id: userId,
    title: data.title,
    date: data.date,
    start_min: data.start_min ?? null,
    duration_min: data.duration_min ?? null,
    priority: data.priority ?? 'P2',
    category: data.category ?? '其他',
    note: data.note ?? '',
    status: data.status ?? 'pending',
    sync_calendar: 0,
    sync_reminder: 0,
    source: data.source ?? 'local',
    locked: data.locked ?? 0,
    created_at: timestamp,
    updated_at: timestamp
  });
  return getTask(result.lastInsertRowid, userId);
}

function updateTask(id, changes, userId) {
  const existing = getTask(id, userId);
  if (!existing) return null;
  const data = validateTaskInput(changes, { partial: true });
  if (changes.status !== undefined) {
    data.completed_at = changes.status === 'done' ? nowIso() : null;
  }
  const fields = [
    'title', 'date', 'start_min', 'duration_min', 'priority', 'category', 'note',
    'status', 'locked', 'source', 'remote_kind', 'remote_uid', 'remote_href',
    'remote_etag', 'remote_updated', 'last_synced_at', 'completed_at'
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
  db.prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = @id AND user_id = @userId`)
    .run({ ...params, userId });
  return getTask(id, userId);
}

function softDeleteTask(id, userId) {
  const existing = getTask(id, userId);
  if (!existing) return null;
  db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(nowIso(), nowIso(), id, userId);
  return getTask(id, userId);
}

function clearTasks(userId, scope = 'pending') {
  if (scope === 'all') {
    return db.prepare('DELETE FROM tasks WHERE user_id = ? AND deleted_at IS NULL').run(userId).changes;
  }
  return db.prepare("DELETE FROM tasks WHERE user_id = ? AND status = 'pending' AND deleted_at IS NULL").run(userId).changes;
}

function hardDeleteTask(id) {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

function listDeletedTasks(userId) {
  return db.prepare('SELECT * FROM tasks WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY updated_at ASC')
    .all(userId)
    .map(taskFromRow);
}

function getRules(userId) {
  return db.prepare('SELECT * FROM rules WHERE user_id = ? ORDER BY id ASC').all(userId);
}

function replaceRules(userId, rules) {
  if (!Array.isArray(rules)) throw new Error('规则必须是数组');
  const clean = rules.map((rule) => ({
    keyword: String(rule.keyword || '').trim(),
    category: normalizeCategory(rule.category),
    duration_min: normalizeInt(rule.duration_min, { min: 1, max: 1440, fallback: 30 }),
    time_block: ['morning', 'afternoon', 'evening'].includes(rule.time_block) ? rule.time_block : 'afternoon',
    start_min: normalizeInt(rule.start_min, { min: 0, max: 1439, fallback: null }),
    end_min: normalizeInt(rule.end_min, { min: 1, max: 1439, fallback: null }),
    enabled: rule.enabled === false || rule.enabled === 0 ? 0 : 1
  }));
  if (clean.some((rule) => !rule.keyword)) throw new Error('规则关键词不能为空');
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM rules WHERE user_id = ?').run(userId);
    const insert = db.prepare(`
      INSERT INTO rules (user_id, keyword, category, duration_min, time_block, start_min, end_min, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const rule of clean) {
      insert.run(userId, rule.keyword, rule.category, rule.duration_min, rule.time_block, rule.start_min, rule.end_min, rule.enabled);
    }
  });
  transaction();
  return getRules(userId);
}

function habitFromRow(row) {
  if (!row) return null;
  return { ...row, archived: Boolean(row.archived) };
}

function getHabits(userId, { includeArchived = false } = {}) {
  const rows = db.prepare(`
    SELECT * FROM habits WHERE user_id = ? ${includeArchived ? '' : 'AND archived = 0'}
    ORDER BY archived ASC, id DESC
  `).all(userId);
  return rows.map(habitFromRow);
}

function getHabit(id, userId) {
  return habitFromRow(db.prepare('SELECT * FROM habits WHERE id = ? AND user_id = ?').get(id, userId));
}

function createHabit(userId, { name, icon, color }) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('习惯名称不能为空');
  const timestamp = nowIso();
  const result = db.prepare(`
    INSERT INTO habits (user_id, name, icon, color, archived, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(userId, cleanName, String(icon || 'star'), /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#1f6f5c', timestamp, timestamp);
  return getHabit(result.lastInsertRowid, userId);
}

function updateHabit(id, userId, changes) {
  const existing = getHabit(id, userId);
  if (!existing) return null;
  const fields = [];
  const params = { id, userId };
  if (changes.name !== undefined) {
    const name = String(changes.name || '').trim();
    if (!name) throw new Error('习惯名称不能为空');
    fields.push('name = @name');
    params.name = name;
  }
  if (changes.icon !== undefined) {
    fields.push('icon = @icon');
    params.icon = String(changes.icon || 'star');
  }
  if (changes.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(changes.color)) {
    fields.push('color = @color');
    params.color = changes.color;
  }
  if (changes.archived !== undefined) {
    fields.push('archived = @archived');
    params.archived = changes.archived ? 1 : 0;
  }
  if (fields.length === 0) return existing;
  fields.push('updated_at = @updated_at');
  params.updated_at = nowIso();
  db.prepare(`UPDATE habits SET ${fields.join(', ')} WHERE id = @id AND user_id = @userId`).run(params);
  return getHabit(id, userId);
}

function deleteHabit(id, userId) {
  const result = db.prepare('DELETE FROM habits WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}

function checkHabit(habitId, userId, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式应为 YYYY-MM-DD');
  const habit = getHabit(habitId, userId);
  if (!habit) return null;
  db.prepare(`
    INSERT INTO habit_logs (habit_id, date, created_at) VALUES (?, ?, ?)
    ON CONFLICT(habit_id, date) DO NOTHING
  `).run(habitId, date, nowIso());
  return true;
}

function uncheckHabit(habitId, userId, date) {
  db.prepare('DELETE FROM habit_logs WHERE habit_id = ? AND date = ? AND habit_id IN (SELECT id FROM habits WHERE user_id = ?)')
    .run(habitId, date, userId);
  return true;
}

function getHabitLogs(habitId, userId, from, to) {
  return db.prepare(`
    SELECT hl.* FROM habit_logs hl
    JOIN habits h ON h.id = hl.habit_id
    WHERE h.user_id = ? AND hl.habit_id = ? AND hl.date >= ? AND hl.date <= ?
    ORDER BY hl.date ASC
  `).all(userId, habitId, from, to);
}

function currentStreak(logDates) {
  const dates = new Set(logDates);
  let streak = 0;
  const cursor = new Date();
  if (!dates.has(isoDate(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (dates.has(isoDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function longestStreak(logDates) {
  const sorted = [...new Set(logDates)].sort();
  let best = 0;
  let current = 0;
  let previous = null;
  for (const date of sorted) {
    const time = new Date(`${date}T00:00:00`).getTime();
    if (previous !== null && time - previous === 86400000) {
      current += 1;
    } else {
      current = 1;
    }
    best = Math.max(best, current);
    previous = time;
  }
  return best;
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getHabitStats(userId, month) {
  const [year, mon] = month.split('-').map(Number);
  const from = `${year}-${String(mon).padStart(2, '0')}-01`;
  const to = isoDate(new Date(year, mon, 0));
  const habits = getHabits(userId);
  return habits.map((habit) => {
    const logs = getHabitLogs(habit.id, userId, from, to);
    const dates = logs.map((log) => log.date);
    return {
      ...habit,
      month_count: dates.length,
      current_streak: currentStreak(dates),
      longest_streak: longestStreak(dates),
      logs: logs.map((log) => ({ date: log.date, note: log.note }))
    };
  });
}

function createFocusSession(userId, { date, task_id: taskId, minutes, note, started_at: startedAt }) {
  const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : isoDate(new Date());
  const cleanMinutes = normalizeInt(minutes, { min: 1, max: 1440, fallback: 25 });
  const result = db.prepare(`
    INSERT INTO focus_sessions (user_id, date, task_id, minutes, note, started_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, cleanDate, normalizeInt(taskId, { min: 1, max: 2147483647, fallback: null }), cleanMinutes, String(note || ''), startedAt || nowIso());
  return db.prepare('SELECT * FROM focus_sessions WHERE id = ?').get(result.lastInsertRowid);
}

function getFocusSessions(userId, { from, to, date } = {}) {
  const clauses = ['user_id = ?'];
  const params = [userId];
  if (date) {
    clauses.push('date = ?');
    params.push(date);
  } else if (from && to) {
    clauses.push('date >= ? AND date <= ?');
    params.push(from, to);
  }
  return db.prepare(`SELECT * FROM focus_sessions WHERE ${clauses.join(' AND ')} ORDER BY started_at DESC`).all(...params);
}

function getReview(userId, year, week) {
  return db.prepare('SELECT * FROM weekly_reviews WHERE user_id = ? AND year = ? AND week = ?').get(userId, year, week) || null;
}

function saveReview(userId, year, week, content) {
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO weekly_reviews (user_id, year, week, content, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, year, week) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `).run(userId, year, week, String(content || ''), timestamp);
  return getReview(userId, year, week);
}

function getDailyReview(userId, date) {
  return db.prepare('SELECT * FROM daily_reviews WHERE user_id = ? AND date = ?').get(userId, date) || null;
}

function saveDailyReview(userId, date, content) {
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO daily_reviews (user_id, date, content, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `).run(userId, date, String(content || ''), timestamp);
  return getDailyReview(userId, date);
}

function getYearlyReview(userId, year) {
  return db.prepare('SELECT * FROM yearly_reviews WHERE user_id = ? AND year = ?').get(userId, year) || null;
}

function saveYearlyReview(userId, year, content) {
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO yearly_reviews (user_id, year, content, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, year) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `).run(userId, year, String(content || ''), timestamp);
  return getYearlyReview(userId, year);
}

function getAnnualGoals(userId, year) {
  return db.prepare(`
    SELECT * FROM annual_goals WHERE user_id = ? AND year = ? ORDER BY created_at ASC
  `).all(userId, year);
}

function createAnnualGoal(userId, { year, title, status }) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw new Error('年度目标不能为空');
  const timestamp = nowIso();
  const result = db.prepare(`
    INSERT INTO annual_goals (user_id, year, title, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, year, cleanTitle, ['todo', 'doing', 'done'].includes(status) ? status : 'todo', timestamp, timestamp);
  return db.prepare('SELECT * FROM annual_goals WHERE id = ?').get(result.lastInsertRowid);
}

function updateAnnualGoal(id, userId, changes) {
  const existing = db.prepare('SELECT * FROM annual_goals WHERE id = ? AND user_id = ?').get(id, userId);
  if (!existing) return null;
  const fields = [];
  const params = { id, userId };
  if (changes.title !== undefined) {
    const title = String(changes.title || '').trim();
    if (!title) throw new Error('年度目标不能为空');
    fields.push('title = @title');
    params.title = title;
  }
  if (changes.status !== undefined && ['todo', 'doing', 'done'].includes(changes.status)) {
    fields.push('status = @status');
    params.status = changes.status;
  }
  if (fields.length === 0) return existing;
  fields.push('updated_at = @updated_at');
  params.updated_at = nowIso();
  db.prepare(`UPDATE annual_goals SET ${fields.join(', ')} WHERE id = @id AND user_id = @userId`).run(params);
  return db.prepare('SELECT * FROM annual_goals WHERE id = ?').get(id);
}

function deleteAnnualGoal(id, userId) {
  return db.prepare('DELETE FROM annual_goals WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

function getMonthStats(userId, month) {
  const [year, mon] = month.split('-').map(Number);
  const days = new Date(year, mon, 0).getDate();
  const daysInMonth = [];
  for (let day = 1; day <= days; day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const tasks = getTasks({ userId, date });
    const habitCount = db.prepare(`
      SELECT COUNT(*) AS count FROM habit_logs hl
      JOIN habits h ON h.id = hl.habit_id
      WHERE h.user_id = ? AND hl.date = ?
    `).get(userId, date).count;
    const focusMinutes = getFocusSessions(userId, { date }).reduce((sum, item) => sum + item.minutes, 0);
    daysInMonth.push({
      date,
      tasks_total: tasks.length,
      tasks_done: tasks.filter((task) => task.status === 'done').length,
      habits: habitCount,
      focus_minutes: focusMinutes
    });
  }
  return daysInMonth;
}

function dateRange(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cursor <= end) {
    dates.push(isoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function weekRange(date) {
  const current = new Date(`${date}T00:00:00`);
  const day = current.getDay() || 7;
  const monday = new Date(current);
  monday.setDate(current.getDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: isoDate(monday), to: isoDate(sunday) };
}

function getDashboardStats(userId, date) {
  const today = date || isoDate(new Date());
  const tasks = getTasks({ userId, date: today });
  const done = tasks.filter((task) => task.status === 'done').length;
  const week = weekRange(today);
  const habits = getHabits(userId);
  const habitLogs = db.prepare(`
    SELECT hl.date, hl.habit_id FROM habit_logs hl
    JOIN habits h ON h.id = hl.habit_id
    WHERE h.user_id = ? AND hl.date = ?
  `).all(userId, today);
  const focusToday = getFocusSessions(userId, { date: today });
  const focusWeek = getFocusSessions(userId, { from: week.from, to: week.to });
  const toDate = isoDate(new Date(new Date(`${today}T00:00:00`).getTime() + 6 * 86400000));
  const upcoming = getTasks({ userId, from: today, to: toDate })
    .filter((task) => task.status === 'pending')
    .slice(0, 6);
  const trend = [];
  const trendFrom = isoDate(new Date(new Date(`${today}T00:00:00`).getTime() - 6 * 86400000));
  for (const day of dateRange(trendFrom, today)) {
    const dayTasks = getTasks({ userId, date: day });
    trend.push({ date: day, total: dayTasks.length, done: dayTasks.filter((task) => task.status === 'done').length });
  }
  const month = today.slice(0, 7);
  const heatmap = {};
  for (const log of db.prepare(`
    SELECT hl.date, COUNT(*) AS count FROM habit_logs hl
    JOIN habits h ON h.id = hl.habit_id
    WHERE h.user_id = ? AND hl.date LIKE ?
    GROUP BY hl.date
  `).all(userId, `${month}-%`)) {
    heatmap[log.date] = log.count;
  }
  return {
    date: today,
    tasks: { total: tasks.length, done, pending: tasks.length - done, completion: tasks.length ? Math.round((done / tasks.length) * 100) : 0 },
    habits: { total: habits.length, done_today: new Set(habitLogs.map((log) => log.habit_id)).size, heatmap },
    focus: {
      today_minutes: focusToday.reduce((sum, item) => sum + item.minutes, 0),
      week_minutes: focusWeek.reduce((sum, item) => sum + item.minutes, 0)
    },
    upcoming,
    trend
  };
}

function exportData(userId) {
  return {
    version: 3,
    exported_at: nowIso(),
    user: getUserById(userId),
    settings: getSettings(userId),
    rules: getRules(userId),
    tasks: getTasks({ userId, includeDeleted: false }),
    habits: getHabits(userId, { includeArchived: true }),
    focus_sessions: getFocusSessions(userId, { from: '1970-01-01', to: '2999-12-31' }),
    reviews: db.prepare('SELECT * FROM weekly_reviews WHERE user_id = ? ORDER BY year DESC, week DESC').all(userId)
  };
}

function importData(userId, payload) {
  if (!payload || typeof payload !== 'object') throw new Error('备份内容无效');
  const transaction = db.transaction(() => {
    if (payload.settings && typeof payload.settings === 'object') setSettings(userId, payload.settings);
    if (Array.isArray(payload.rules)) replaceRules(userId, payload.rules);
    if (Array.isArray(payload.tasks)) {
      db.prepare('DELETE FROM tasks WHERE user_id = ?').run(userId);
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
          locked: task.locked
        }, userId);
      }
    }
    if (Array.isArray(payload.habits)) {
      db.prepare('DELETE FROM habits WHERE user_id = ?').run(userId);
      for (const habit of payload.habits) {
        const created = createHabit(userId, habit);
        for (const log of habit.logs || []) checkHabit(created.id, userId, log.date);
      }
    }
    if (Array.isArray(payload.focus_sessions)) {
      for (const session of payload.focus_sessions) createFocusSession(userId, session);
    }
    if (Array.isArray(payload.reviews)) {
      for (const review of payload.reviews) saveReview(userId, review.year, review.week, review.content);
    }
  });
  transaction();
  return exportData(userId);
}

init();

module.exports = {
  db,
  init,
  nowIso,
  createUser,
  getUserById,
  getUserByUsername,
  findUserAuth,
  listUsers,
  createSession,
  getSessionUser,
  deleteSession,
  verifyPassword,
  getSettings,
  setSettings,
  getTasks,
  getTask,
  createTask,
  updateTask,
  softDeleteTask,
  clearTasks,
  hardDeleteTask,
  listDeletedTasks,
  getRules,
  replaceRules,
  getHabits,
  getHabit,
  createHabit,
  updateHabit,
  deleteHabit,
  checkHabit,
  uncheckHabit,
  getHabitLogs,
  getHabitStats,
  currentStreak,
  longestStreak,
  createFocusSession,
  getFocusSessions,
  getReview,
  saveReview,
  getDailyReview,
  saveDailyReview,
  getYearlyReview,
  saveYearlyReview,
  getAnnualGoals,
  createAnnualGoal,
  updateAnnualGoal,
  deleteAnnualGoal,
  getMonthStats,
  getDashboardStats,
  exportData,
  importData,
  CATEGORIES,
  PRIORITIES
};
