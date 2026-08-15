const os = require('os');
const path = require('path');
const express = require('express');
const db = require('./lib/db');
const { scheduleDay } = require('./lib/scheduler');
const { discoverCollections, runSync, diagnoseConnection, friendlySyncError } = require('./lib/caldav');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(express.json({ limit: '2mb' }));

app.get('/api/info', (req, res) => {
  const addresses = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family === 'IPv4' && !info.internal) {
        addresses.push({ name, address: info.address });
      }
    }
  }
  res.json({
    hostname: os.hostname(),
    port: PORT,
    addresses,
    urls: addresses.map((item) => `http://${item.address}:${PORT}`)
  });
});

app.get('/api/tasks', (req, res) => {
  const { date, from, to } = req.query;
  res.json(db.getTasks({ date: date || undefined, from: from || undefined, to: to || undefined }));
});

app.post('/api/tasks', (req, res) => {
  try {
    res.status(201).json(db.createTask(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch('/api/tasks/:id', (req, res) => {
  const task = db.updateTask(Number(req.params.id), req.body || {});
  if (!task) return res.status(404).json({ error: '任务不存在' });
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  const task = db.softDeleteTask(Number(req.params.id));
  if (!task) return res.status(404).json({ error: '任务不存在' });
  res.json({ ok: true });
});

app.post('/api/schedule/auto', (req, res) => {
  const body = req.body || {};
  const date = body.date || new Date().toLocaleDateString('en-CA');
  const tasks = db.getTasks({ date });
  const result = scheduleDay(tasks, db.getRules(), {
    regenerate: Boolean(body.regenerate),
    settings: db.getSettings()
  });

  const scheduled = [];
  for (const item of result.scheduled) {
    scheduled.push(
      db.updateTask(item.id, {
        start_min: item.start_min,
        duration_min: item.duration_min,
        locked: 0
      })
    );
  }

  const scheduledIds = new Set(result.scheduled.map((item) => item.id));
  for (const id of result.cleared) {
    if (!scheduledIds.has(id)) {
      db.updateTask(id, { start_min: null, locked: 0 });
    }
  }

  res.json({ ...result, scheduled });
});

app.get('/api/rules', (req, res) => {
  res.json(db.getRules());
});

app.put('/api/rules', (req, res) => {
  try {
    res.json(db.replaceRules(req.body || []));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/settings', (req, res) => {
  res.json(db.getSettings());
});

app.put('/api/settings', (req, res) => {
  const body = { ...(req.body || {}) };
  if (body.app_password === undefined || body.app_password === '') {
    delete body.app_password;
  }
  const settings = db.setSettings(body);
  scheduleSyncTimer();
  res.json(settings);
});

app.post('/api/settings/test-connection', async (req, res) => {
  try {
    const stored = db.getSettings();
    const settings = {
      ...stored,
      apple_id: (req.body?.apple_id || stored.apple_id).trim(),
      app_password: req.body?.app_password || stored.app_password
    };
    if (!settings.apple_id || !settings.app_password) {
      return res.status(400).json({ error: '请填写 Apple ID 和 App 专用密码' });
    }
    const discovered = await discoverCollections(settings);
    res.json({
      ok: true,
      message: `连接成功，发现 ${discovered.calendars.length} 个日历、${discovered.reminderLists.length} 个提醒列表`,
      ...discovered
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: friendlySyncError(error) });
  }
});

app.post('/api/sync/diagnose', async (req, res) => {
  const result = await diagnoseConnection(db.getSettings());
  res.json(result);
});

app.post('/api/sync', async (req, res) => {
  if (syncing) {
    return res.status(409).json({ ok: false, message: '同步正在进行中' });
  }
  try {
    const result = await runSync(db);
    res.json(result);
  } catch (error) {
    db.setSetting('last_sync_status', 'error');
    const message = friendlySyncError(error);
    db.setSetting('last_sync_message', message);
    res.status(500).json({ ok: false, message });
  }
});

app.get('/api/sync/status', (req, res) => {
  const settings = db.getSettings();
  res.json({
    last_sync_at: settings.last_sync_at,
    last_sync_status: settings.last_sync_status,
    last_sync_message: settings.last_sync_message,
    syncing
  });
});

app.get('/api/backup', (req, res) => {
  const data = db.exportData();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="daily-planner-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
});

app.post('/api/backup', (req, res) => {
  try {
    const data = db.importData(req.body);
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

let syncing = false;
let syncTimer = null;

function scheduleSyncTimer() {
  if (syncTimer) clearInterval(syncTimer);
  const intervalMin = Math.max(1, Number(db.getSettings().sync_interval_min) || 10);
  syncTimer = setInterval(() => {
    if (syncing) return;
    const settings = db.getSettings();
    if (!settings.apple_id || !settings.app_password) return;
    syncing = true;
    runSync(db)
      .catch(() => {})
      .finally(() => {
        syncing = false;
      });
  }, intervalMin * 60 * 1000);
  syncTimer.unref?.();
}

const server = app.listen(PORT, '0.0.0.0', () => {
  const actualPort = server.address().port;
  const settings = db.getSettings();
  const urls = [];
  for (const [, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family === 'IPv4' && !info.internal) urls.push(`http://${info.address}:${actualPort}`);
    }
  }
  console.log('日常规划服务已启动');
  console.log(`本机访问：http://localhost:${actualPort}`);
  console.log(`PORT:${actualPort}`);
  for (const url of urls) console.log(`手机访问：${url}`);
  console.log(`iCloud 自动同步间隔：${settings.sync_interval_min || 10} 分钟`);

  scheduleSyncTimer();
  if (settings.apple_id && settings.app_password) {
    setTimeout(() => {
      syncing = true;
      runSync(db)
        .catch(() => {})
        .finally(() => {
          syncing = false;
        });
    }, 5000);
  }
});
