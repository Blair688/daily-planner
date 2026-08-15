const os = require('os');
const path = require('path');
const express = require('express');
const db = require('./lib/db');
const { scheduleDay } = require('./lib/scheduler');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(express.json({ limit: '2mb' }));

function authToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function requireAuth(req, res, next) {
  const user = db.getSessionUser(authToken(req));
  if (!user) return res.status(401).json({ error: '请先登录' });
  req.user = user;
  req.userId = user.id;
  next();
}

app.get('/api/info', (req, res) => {
  const addresses = [];
  for (const [, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family === 'IPv4' && !info.internal) addresses.push({ address: info.address });
    }
  }
  res.json({
    hostname: os.hostname(),
    port: PORT,
    addresses,
    urls: addresses.map((item) => `http://${item.address}:${PORT}`)
  });
});

app.get('/api/users', (req, res) => {
  res.json(db.listUsers());
});

app.post('/api/auth/register', (req, res) => {
  try {
    const user = db.createUser(req.body || {});
    const token = db.createSession(user.id);
    res.status(201).json({ token, user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const body = req.body || {};
  const row = db.findUserAuth(body.username);
  if (!row) return res.status(401).json({ error: '用户不存在' });
  if (row.password_hash && !db.verifyPassword(body.password, row.password_hash)) {
    return res.status(401).json({ error: '密码错误' });
  }
  const user = db.getUserById(row.id);
  const token = db.createSession(user.id);
  res.json({ token, user });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.deleteSession(authToken(req));
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json(req.user);
});

app.use('/api', (req, res, next) => {
  const fullPath = req.originalUrl.split('?')[0];
  if (['/api/users', '/api/info', '/api/auth/register', '/api/auth/login'].includes(fullPath)) {
    return next();
  }
  return requireAuth(req, res, next);
});

app.get('/api/tasks', (req, res) => {
  const { date, from, to } = req.query;
  res.json(db.getTasks({ userId: req.userId, date: date || undefined, from: from || undefined, to: to || undefined }));
});

app.post('/api/tasks', (req, res) => {
  try {
    res.status(201).json(db.createTask(req.body || {}, req.userId));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/tasks/clear', (req, res) => {
  const scope = (req.body || {}).scope === 'all' ? 'all' : 'pending';
  const count = db.clearTasks(req.userId, scope);
  res.json({ ok: true, count });
});

app.patch('/api/tasks/:id', (req, res) => {
  const task = db.updateTask(Number(req.params.id), req.body || {}, req.userId);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  const task = db.softDeleteTask(Number(req.params.id), req.userId);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  res.json({ ok: true });
});

app.post('/api/schedule/auto', (req, res) => {
  const body = req.body || {};
  const date = body.date || new Date().toLocaleDateString('en-CA');
  const tasks = db.getTasks({ userId: req.userId, date });
  const result = scheduleDay(tasks, db.getRules(req.userId), {
    regenerate: Boolean(body.regenerate),
    settings: db.getSettings(req.userId)
  });

  const scheduled = [];
  for (const item of result.scheduled) {
    scheduled.push(
      db.updateTask(item.id, {
        start_min: item.start_min,
        duration_min: item.duration_min,
        locked: 0
      }, req.userId)
    );
  }

  const scheduledIds = new Set(result.scheduled.map((item) => item.id));
  for (const id of result.cleared) {
    if (!scheduledIds.has(id)) {
      db.updateTask(id, { start_min: null, locked: 0 }, req.userId);
    }
  }

  res.json({ ...result, scheduled });
});

app.get('/api/rules', (req, res) => {
  res.json(db.getRules(req.userId));
});

app.put('/api/rules', (req, res) => {
  try {
    res.json(db.replaceRules(req.userId, req.body || []));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/settings', (req, res) => {
  res.json(db.getSettings(req.userId));
});

app.put('/api/settings', (req, res) => {
  res.json(db.setSettings(req.userId, req.body || {}));
});

app.get('/api/habits', (req, res) => {
  res.json(db.getHabits(req.userId));
});

app.post('/api/habits', (req, res) => {
  try {
    res.status(201).json(db.createHabit(req.userId, req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch('/api/habits/:id', (req, res) => {
  try {
    const habit = db.updateHabit(Number(req.params.id), req.userId, req.body || {});
    if (!habit) return res.status(404).json({ error: '习惯不存在' });
    res.json(habit);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/habits/:id', (req, res) => {
  const ok = db.deleteHabit(Number(req.params.id), req.userId);
  res.json({ ok });
});

app.post('/api/habits/:id/checkin', (req, res) => {
  const ok = db.checkHabit(Number(req.params.id), req.userId, (req.body || {}).date);
  if (ok === null) return res.status(404).json({ error: '习惯不存在' });
  res.json({ ok: true });
});

app.delete('/api/habits/:id/checkin', (req, res) => {
  db.uncheckHabit(Number(req.params.id), req.userId, req.query.date || '');
  res.json({ ok: true });
});

app.get('/api/habits/stats', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: '月份格式应为 YYYY-MM' });
  res.json(db.getHabitStats(req.userId, month));
});

app.post('/api/focus/sessions', (req, res) => {
  try {
    res.status(201).json(db.createFocusSession(req.userId, req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/focus/sessions', (req, res) => {
  const { date, from, to } = req.query;
  res.json(db.getFocusSessions(req.userId, { date: date || undefined, from: from || undefined, to: to || undefined }));
});

app.get('/api/reviews/:year/:week', (req, res) => {
  const year = Number(req.params.year);
  const week = Number(req.params.week);
  res.json(db.getReview(req.userId, year, week) || { year, week, content: '' });
});

app.put('/api/reviews/:year/:week', (req, res) => {
  const year = Number(req.params.year);
  const week = Number(req.params.week);
  res.json(db.saveReview(req.userId, year, week, (req.body || {}).content));
});

app.get('/api/stats/dashboard', (req, res) => {
  res.json(db.getDashboardStats(req.userId, req.query.date || undefined));
});

app.get('/api/backup', (req, res) => {
  const data = db.exportData(req.userId);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="daily-planner-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
});

app.post('/api/backup', (req, res) => {
  try {
    const data = db.importData(req.userId, req.body);
    res.json({ ok: true, ...data });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.use('/vendor/lucide.min.js', express.static(path.join(__dirname, 'node_modules', 'lucide', 'dist', 'umd', 'lucide.min.js')));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体不是有效的 JSON' });
  }
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  const actualPort = server.address().port;
  const urls = [];
  for (const [, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family === 'IPv4' && !info.internal) urls.push(`http://${info.address}:${actualPort}`);
    }
  }
  console.log('日常规划 3.0 服务已启动');
  console.log(`本机访问：http://localhost:${actualPort}`);
  console.log(`PORT:${actualPort}`);
  for (const url of urls) console.log(`手机访问：${url}`);
});
