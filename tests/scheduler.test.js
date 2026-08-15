const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateTask, scheduleDay, parseDurationFromTitle } = require('../lib/scheduler');

const rules = [
  { id: 1, keyword: '健身', category: '健康', duration_min: 45, time_block: 'evening', enabled: 1 },
  { id: 2, keyword: '会议', category: '工作', duration_min: 60, time_block: 'morning', enabled: 1 }
];

test('estimateTask 按关键词推断时长和时段', () => {
  const result = estimateTask({ title: '晚上去健身房', category: '其他', duration_min: null }, rules);
  assert.equal(result.duration, 45);
  assert.equal(result.window.label, '晚上');
  assert.equal(result.source, 'fallback');
});

test('estimateTask 优先使用用户填写时长', () => {
  const result = estimateTask({ title: '健身', category: '健康', duration_min: 120 }, rules);
  assert.equal(result.duration, 120);
  assert.equal(result.window.label, '晚上');
  assert.equal(result.source, 'user');
});

test('estimateTask 按分类兜底', () => {
  const result = estimateTask({ title: '写周报', category: '工作', duration_min: null }, rules);
  assert.equal(result.duration, 60);
  assert.equal(result.window.label, '上午');
});

test('scheduleDay 按优先级和时长放入空闲时段', () => {
  const tasks = [
    { id: 1, title: '低优先级小事', priority: 'P3', category: '其他', duration_min: 30, start_min: null, locked: 0, status: 'pending' },
    { id: 2, title: '高优先级长任务', priority: 'P1', category: '工作', duration_min: 120, start_min: null, locked: 0, status: 'pending' },
    { id: 3, title: '固定会议', priority: 'P2', category: '工作', duration_min: 60, start_min: 9 * 60, locked: 1, status: 'pending' }
  ];
  const result = scheduleDay(tasks, rules);
  const byId = Object.fromEntries(result.scheduled.map((item) => [item.id, item]));

  assert.equal(result.scheduled.length, 2);
  assert.equal(byId[2].start_min, 10 * 60);
  assert.equal(byId[1].start_min, 13 * 60 + 30);
});

test('scheduleDay 没有空闲时段时返回 unscheduled', () => {
  const fixed = [
    { id: 1, title: '上午', priority: 'P2', category: '其他', duration_min: 60, start_min: 8 * 60, locked: 1, status: 'pending' },
    { id: 2, title: '上午二', priority: 'P2', category: '其他', duration_min: 180, start_min: 9 * 60, locked: 1, status: 'pending' },
    { id: 3, title: '下午', priority: 'P2', category: '其他', duration_min: 60, start_min: 13 * 60, locked: 1, status: 'pending' },
    { id: 4, title: '下午二', priority: 'P2', category: '其他', duration_min: 240, start_min: 14 * 60, locked: 1, status: 'pending' },
    { id: 5, title: '晚上', priority: 'P2', category: '其他', duration_min: 60, start_min: 18 * 60, locked: 1, status: 'pending' },
    { id: 6, title: '晚上二', priority: 'P2', category: '其他', duration_min: 210, start_min: 19 * 60, locked: 1, status: 'pending' }
  ];
  const result = scheduleDay([...fixed, { id: 7, title: '新任务', priority: 'P1', category: '其他', duration_min: 30, start_min: null, locked: 0, status: 'pending' }], rules);
  assert.equal(result.scheduled.length, 0);
  assert.equal(result.unscheduled.length, 1);
  assert.equal(result.unscheduled[0].id, 7);
});

test('parseDurationFromTitle 支持数量词', () => {
  assert.equal(parseDurationFromTitle('跑步 5 公里').duration, 45);
  assert.equal(parseDurationFromTitle('写报告 1 小时').duration, 60);
  assert.equal(parseDurationFromTitle('阅读半小时').duration, 30);
  assert.equal(parseDurationFromTitle('开 90 分钟的会议').duration, 90);
});

test('scheduleDay 尊重自定义时段和午休', () => {
  const tasks = [
    { id: 1, title: '午休后处理杂事', priority: 'P1', category: '其他', duration_min: 30, start_min: null, locked: 0, status: 'pending' }
  ];
  const result = scheduleDay(tasks, rules, {
    settings: { day_start_min: 9 * 60, day_end_min: 18 * 60, lunch_start_min: 12 * 60, lunch_end_min: 13 * 60 + 30 }
  });
  assert.equal(result.scheduled[0].start_min, 13 * 60 + 30);
});

test('scheduleDay regenerate 会清空旧的自动排程', () => {
  const tasks = [
    { id: 1, title: '旧排程', priority: 'P2', category: '其他', duration_min: 30, start_min: 10 * 60, locked: 0, status: 'pending' }
  ];
  const result = scheduleDay(tasks, rules, { regenerate: true });
  assert.ok(result.cleared.includes(1));
  assert.equal(result.scheduled.length, 1);
});
