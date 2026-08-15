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

async function api(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  return { status: response.status, data };
}

test('API 端到端：任务、排程、设置、诊断', async () => {
  const { child, port, dbPath } = await startServer();
  const base = `http://localhost:${port}`;
  try {
    const created = await api(base, '/api/tasks', {
      method: 'POST',
      body: {
        title: '跑步 5 公里',
        date: '2026-08-15',
        priority: 'P1',
        category: '健康'
      }
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.title, '跑步 5 公里');

    const scheduled = await api(base, '/api/schedule/auto', {
      method: 'POST',
      body: { date: '2026-08-15', regenerate: true }
    });
    assert.equal(scheduled.status, 200);
    assert.equal(scheduled.data.scheduled.length, 1);
    assert.equal(scheduled.data.scheduled[0].duration_min, 45);

    const patched = await api(base, `/api/tasks/${created.data.id}`, {
      method: 'PATCH',
      body: { start_min: 19 * 60, duration_min: 60, locked: 1 }
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.data.start_min, 19 * 60);
    assert.equal(patched.data.locked, true);

    const settings = await api(base, '/api/settings', {
      method: 'PUT',
      body: {
        theme_color: '#7c5cbf',
        theme_preset: 'violet',
        day_start_min: 9 * 60,
        day_end_min: 21 * 60,
        lunch_start_min: 12 * 60,
        lunch_end_min: 13 * 60
      }
    });
    assert.equal(settings.status, 200);
    assert.equal(settings.data.theme_color, '#7c5cbf');
    assert.equal(settings.data.day_end_min, '1260');

    const diagnose = await api(base, '/api/sync/diagnose', { method: 'POST' });
    assert.equal(diagnose.status, 200);
    assert.ok('dns' in diagnose.data);
    assert.ok('tcp' in diagnose.data);
    assert.ok('https' in diagnose.data);

    const deleted = await api(base, `/api/tasks/${created.data.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.data.ok, true);
  } finally {
    child.kill();
    try {
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
    } catch {
      // 临时文件清理失败不影响测试结果
    }
  }
});
