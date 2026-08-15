const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-planner-test-'));
  const dbPath = path.join(dir, 'test.db');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '0', DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    let stdout = '';
    const onData = (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/PORT:(\d+)/);
      if (match) {
        cleanup();
        resolve({ child, port: Number(match[1]), dbPath });
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`服务提前退出，退出码 ${code}\n${stdout}`));
    };
    const cleanup = () => {
      child.stdout.off('data', onData);
      child.stderr.off('data', onError);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onError);
    child.on('error', onError);
    child.on('exit', onExit);
  });
}

async function api(base, route, options = {}, token = '') {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${route}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  return { status: response.status, data };
}

test('API 端到端：多账号、任务、习惯、专注、复盘', async () => {
  const { child, port, dbPath } = await startServer();
  const base = `http://localhost:${port}`;
  try {
    const registered = await api(base, '/api/auth/register', {
      method: 'POST',
      body: { username: 'alice', display_name: '爱丽丝', password: 'secret123' }
    });
    assert.equal(registered.status, 201);
    const token = registered.data.token;

    const created = await api(base, '/api/tasks', {
      method: 'POST',
      body: { title: '跑步 5 公里', date: '2026-08-15', priority: 'P1', category: '健康' }
    }, token);
    assert.equal(created.status, 201);

    const scheduled = await api(base, '/api/schedule/auto', {
      method: 'POST',
      body: { date: '2026-08-15', regenerate: true }
    }, token);
    assert.equal(scheduled.status, 200);
    assert.equal(scheduled.data.scheduled.length, 1);

    const patched = await api(base, `/api/tasks/${created.data.id}`, {
      method: 'PATCH',
      body: { start_min: 19 * 60, duration_min: 60, locked: 1 }
    }, token);
    assert.equal(patched.data.start_min, 19 * 60);

    const settings = await api(base, '/api/settings', {
      method: 'PUT',
      body: { theme_color: '#7c5cbf', theme_preset: 'violet', day_start_min: 9 * 60, day_end_min: 21 * 60 }
    }, token);
    assert.equal(settings.status, 200);
    assert.equal(settings.data.theme_color, '#7c5cbf');

    const habit = await api(base, '/api/habits', {
      method: 'POST',
      body: { name: '晨跑', icon: 'run', color: '#2563eb' }
    }, token);
    assert.equal(habit.status, 201);

    const checkin = await api(base, `/api/habits/${habit.data.id}/checkin`, {
      method: 'POST',
      body: { date: '2026-08-15' }
    }, token);
    assert.equal(checkin.status, 200);

    const stats = await api(base, '/api/habits/stats?month=2026-08', {}, token);
    assert.equal(stats.data[0].month_count, 1);
    assert.equal(typeof stats.data[0].current_streak, 'number');

    const focus = await api(base, '/api/focus/sessions', {
      method: 'POST',
      body: { date: '2026-08-15', minutes: 25, note: '深度工作' }
    }, token);
    assert.equal(focus.status, 201);

    const review = await api(base, '/api/reviews/2026/33', {
      method: 'PUT',
      body: { content: '本周完成得不错' }
    }, token);
    assert.equal(review.status, 200);
    assert.equal(review.data.content, '本周完成得不错');

    const dashboard = await api(base, '/api/stats/dashboard?date=2026-08-15', {}, token);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.data.tasks.total, 1);
    assert.equal(dashboard.data.focus.today_minutes, 25);

    const second = await api(base, '/api/auth/register', {
      method: 'POST',
      body: { username: 'bob', display_name: '鲍勃' }
    });
    const secondToken = second.data.token;
    const bobTasks = await api(base, '/api/tasks', {}, secondToken);
    assert.equal(bobTasks.data.length, 0);
    const bobHabits = await api(base, '/api/habits', {}, secondToken);
    assert.equal(bobHabits.data.length, 0);

    await api(base, '/api/tasks', {
      method: 'POST',
      body: { title: '待清空任务', date: '2026-08-15' }
    }, token);
    const cleared = await api(base, '/api/tasks/clear', {
      method: 'POST',
      body: { scope: 'pending' }
    }, token);
    assert.equal(cleared.status, 200);
    assert.ok(cleared.data.count >= 2);
    const afterClear = await api(base, '/api/tasks', {}, token);
    assert.equal(afterClear.data.length, 0);
  } finally {
    child.kill();
    try {
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
    } catch {}
  }
});
