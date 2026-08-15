const test = require('node:test');
const assert = require('node:assert/strict');
const ical = require('node-ical');
const { buildEventIcs, buildReminderIcs, friendlySyncError, CalDavError } = require('../lib/caldav');

const baseTask = {
  id: 1,
  title: '项目评审, 2026',
  date: '2026-08-15',
  start_min: 9 * 60 + 30,
  duration_min: 90,
  priority: 'P1',
  category: '工作',
  note: '带上方案\n第二行',
  status: 'pending'
};

test('buildEventIcs 生成带时间的 VEVENT 并可回读', () => {
  const ics = buildEventIcs(baseTask, 'uid-123');
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /UID:uid-123/);
  assert.match(ics, /DTSTART:20260815T093000/);
  assert.match(ics, /DTEND:20260815T110000/);

  const parsed = ical.sync.parseICS(ics);
  const event = Object.values(parsed).find((value) => value && value.type === 'VEVENT');
  assert.equal(event.uid, 'uid-123');
  assert.equal(event.summary, '项目评审, 2026');
  assert.ok(event.start instanceof Date);
});

test('buildEventIcs 未排期任务生成全天事件', () => {
  const ics = buildEventIcs({ ...baseTask, start_min: null, duration_min: null }, 'uid-all-day');
  assert.match(ics, /DTSTART;VALUE=DATE:20260815/);
  assert.match(ics, /DTEND;VALUE=DATE:20260816/);
});

test('buildReminderIcs 生成带 DUE 的 VTODO', () => {
  const ics = buildReminderIcs(baseTask, 'uid-reminder');
  assert.match(ics, /BEGIN:VTODO/);
  assert.match(ics, /UID:uid-reminder/);
  assert.match(ics, /DUE:20260815T093000/);
  assert.match(ics, /STATUS:NEEDS-ACTION/);

  const done = buildReminderIcs({ ...baseTask, status: 'done' }, 'uid-done');
  assert.match(done, /STATUS:COMPLETED/);
  assert.match(done, /COMPLETED:/);
});

test('friendlySyncError 对 401 和 403 返回明确指引', () => {
  assert.match(friendlySyncError(new CalDavError('401', 401, '')), /App 专用密码/);
  assert.match(friendlySyncError(new CalDavError('403', 403, '')), /邮箱形式的 Apple ID/);
});
