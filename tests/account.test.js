const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-planner-account-'));
process.env.DB_PATH = path.join(tempDir, 'account.db');

const db = require('../lib/db');

test('创建密码账号和免密档案', () => {
  const alice = db.createUser({ username: 'alice', display_name: '爱丽丝', password: 'secret123' });
  const bob = db.createUser({ username: 'bob', display_name: '鲍勃' });
  assert.equal(alice.has_password, true);
  assert.equal(bob.has_password, false);
  assert.ok(db.verifyPassword('secret123', db.findUserAuth('alice').password_hash));
  assert.equal(db.verifyPassword('wrong', db.findUserAuth('alice').password_hash), false);
});

test('会话令牌可换取用户', () => {
  const user = db.getUserByUsername('alice');
  const token = db.createSession(user.id);
  const sessionUser = db.getSessionUser(token);
  assert.equal(sessionUser.username, 'alice');
  db.deleteSession(token);
  assert.equal(db.getSessionUser(token), null);
});

test('习惯连续天数计算', () => {
  assert.equal(db.currentStreak(['2026-08-13', '2026-08-14', '2026-08-15']), 3);
  assert.equal(db.currentStreak(['2026-08-14']), 1);
  assert.equal(db.longestStreak(['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-14']), 3);
});

test('不同账号的数据互相隔离', () => {
  const alice = db.getUserByUsername('alice');
  const bob = db.getUserByUsername('bob');
  db.createTask({ title: 'Alice 的任务', date: '2026-08-15' }, alice.id);
  assert.equal(db.getTasks({ userId: alice.id }).length, 1);
  assert.equal(db.getTasks({ userId: bob.id }).length, 0);

  db.createHabit(bob.id, { name: 'Bob 的习惯', icon: 'star', color: '#1f6f5c' });
  assert.equal(db.getHabits(alice.id).length, 0);
  assert.equal(db.getHabits(bob.id).length, 1);
});

test('周复盘按用户和周期唯一保存', () => {
  const alice = db.getUserByUsername('alice');
  db.saveReview(alice.id, 2026, 33, '第一版');
  db.saveReview(alice.id, 2026, 33, '第二版');
  const review = db.getReview(alice.id, 2026, 33);
  assert.equal(review.content, '第二版');
});
