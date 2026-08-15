const TIME_BLOCKS = [
  { id: 'morning', label: '上午', start: 8 * 60, end: 12 * 60 },
  { id: 'afternoon', label: '下午', start: 13 * 60, end: 18 * 60 },
  { id: 'evening', label: '晚上', start: 18 * 60 + 30, end: 22 * 60 + 30 }
];

const CATEGORY_FALLBACK = {
  工作: { duration: 60, block: 'morning' },
  学习: { duration: 60, block: 'afternoon' },
  健康: { duration: 45, block: 'evening' },
  生活: { duration: 30, block: 'evening' },
  其他: { duration: 30, block: 'afternoon' }
};

const PRIORITY_RANK = { P1: 0, P2: 1, P3: 2 };

const CHINESE_NUMBERS = {
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10
};

function chineseNumberToInt(text) {
  if (/^\d+$/.test(text)) return Number(text);
  let total = 0;
  let current = 0;
  for (const char of text) {
    if (char === '十') {
      total += (current || 1) * 10;
      current = 0;
    } else if (CHINESE_NUMBERS[char]) {
      current = CHINESE_NUMBERS[char];
    } else {
      return null;
    }
  }
  return total + current || null;
}

function parseDurationFromTitle(title, fallbackDuration = 30) {
  const text = String(title || '').trim().toLowerCase();
  const patterns = [
    { regex: /(\d+(?:\.\d+)?)\s*(?:小时|小時|h)/, unit: 'hours' },
    { regex: /([一二两三四五六七八九十\d]+(?:\.[\d]+)?)\s*(?:小时|小時)/, unit: 'hours' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:分钟|分鐘|分|min)/, unit: 'minutes' },
    { regex: /(\d+(?:\.\d+)?)\s*(?:公里|千米|km)/, unit: 'km' },
    { regex: /半小时/, unit: 'halfhour' },
    { regex: /一刻钟/, unit: 'quarter' }
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (!match) continue;
    if (pattern.unit === 'halfhour') return { duration: 30, source: 'title' };
    if (pattern.unit === 'quarter') return { duration: 15, source: 'title' };
    const raw = match[1];
    const value = raw ? chineseNumberToInt(raw) : null;
    if (value === null) continue;
    if (pattern.unit === 'hours') return { duration: Math.max(15, Math.round(value * 60)), source: 'title' };
    if (pattern.unit === 'minutes') return { duration: Math.max(5, Math.round(value)), source: 'title' };
    if (pattern.unit === 'km') {
      return { duration: Math.max(20, Math.round(value * 9)), source: 'title' };
    }
  }
  return { duration: Number(fallbackDuration) || 30, source: 'fallback' };
}

function matchRule(title, rules) {
  const text = String(title || '').toLowerCase();
  for (const rule of rules || []) {
    if (!rule.enabled) continue;
    const keyword = String(rule.keyword || '').trim().toLowerCase();
    if (keyword && text.includes(keyword)) return rule;
  }
  return null;
}

function timeWindowFor(rule, category) {
  if (rule && Number.isFinite(Number(rule.start_min)) && Number.isFinite(Number(rule.end_min))) {
    return { start: Number(rule.start_min), end: Number(rule.end_min), label: '自定义' };
  }
  const blockName = rule?.time_block || CATEGORY_FALLBACK[category]?.block || 'afternoon';
  const block = TIME_BLOCKS.find((item) => item.id === blockName) || TIME_BLOCKS[1];
  return { start: block.start, end: block.end, label: block.label };
}

function estimateTask(task, rules) {
  const rule = matchRule(task.title, rules);
  const fallback = CATEGORY_FALLBACK[task.category] || CATEGORY_FALLBACK.其他;
  const fallbackDuration = rule?.duration_min || fallback.duration;
  const parsed = task.duration_min
    ? { duration: Number(task.duration_min), source: 'user' }
    : parseDurationFromTitle(task.title, fallbackDuration);
  const window = timeWindowFor(rule, task.category);
  return {
    duration: Math.max(1, Math.min(1440, parsed.duration)),
    source: parsed.source,
    rule,
    window
  };
}

function freeSegments(start, end, busy) {
  const overlaps = busy
    .filter(([busyStart, busyEnd]) => busyEnd > start && busyStart < end)
    .map(([busyStart, busyEnd]) => [Math.max(busyStart, start), Math.min(busyEnd, end)])
    .sort((a, b) => a[0] - b[0]);

  const segments = [];
  let cursor = start;
  for (const [busyStart, busyEnd] of overlaps) {
    if (busyStart > cursor) segments.push({ start: cursor, end: busyStart });
    cursor = Math.max(cursor, busyEnd);
  }
  if (cursor < end) segments.push({ start: cursor, end });
  return segments;
}

function intersectSegments(segments, start, end) {
  return segments
    .map((segment) => ({ start: Math.max(segment.start, start), end: Math.min(segment.end, end) }))
    .filter((segment) => segment.end > segment.start);
}

function placeInSegments(segments, duration) {
  for (const segment of segments) {
    const start = Math.ceil(segment.start / 15) * 15;
    if (segment.end - start >= duration) return { start, end: start + duration };
  }
  return null;
}

function isMealTask(task) {
  const text = String(task.title || '');
  return /午餐|午饭|吃饭|外卖|早餐|晚饭|晚餐|夜宵/.test(text) || task.category === '生活';
}

function scheduleDay(tasks, rules, { regenerate = false, settings = {} } = {}) {
  const dayStart = Number(settings.day_start_min) || 9 * 60;
  const dayEnd = Number(settings.day_end_min) || 22 * 60;
  const lunchStart = Number(settings.lunch_start_min) || 12 * 60;
  const lunchEnd = Number(settings.lunch_end_min) || 13 * 60 + 30;

  const fixed = [];
  const movable = [];
  const cleared = [];

  for (const task of tasks) {
    if (task.status === 'done' || task.deleted_at) continue;
    const estimate = estimateTask(task, rules);
    const duration = estimate.duration;

    if (task.start_min !== null && task.start_min !== undefined && task.locked) {
      fixed.push({
        ...task,
        start: task.start_min,
        duration: task.duration_min || duration
      });
      continue;
    }

    if (task.start_min !== null && task.start_min !== undefined && !task.locked && regenerate) {
      cleared.push(task.id);
      movable.push({ ...task, start_min: null, duration, estimate });
      continue;
    }

    if (task.start_min === null || task.start_min === undefined) {
      movable.push({ ...task, start_min: null, duration, estimate });
    }
  }

  const busy = fixed.map((task) => [task.start, task.start + task.duration]);
  const baseSegments = freeSegments(dayStart, dayEnd, busy);
  const segmentsWithLunch = freeSegments(dayStart, dayEnd, [...busy, [lunchStart, lunchEnd]]);

  movable.sort((a, b) => {
    const priorityDiff = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
    if (priorityDiff !== 0) return priorityDiff;
    return b.duration - a.duration;
  });

  const scheduled = [];
  const unscheduled = [];

  for (const task of movable) {
    const fullSegments = isMealTask(task) ? baseSegments : segmentsWithLunch;
    const preferred = intersectSegments(fullSegments, task.estimate.window.start, task.estimate.window.end);
    const placed = placeInSegments(preferred, task.duration) || placeInSegments(fullSegments, task.duration);

    if (placed) {
      scheduled.push({
        id: task.id,
        start_min: placed.start,
        duration_min: task.duration,
        source: task.estimate.source,
        block: task.estimate.window.label
      });
    } else {
      unscheduled.push({
        id: task.id,
        title: task.title,
        reason: '当天没有足够的空闲时段'
      });
    }
  }

  return { scheduled, unscheduled, fixed: fixed.map((task) => task.id), cleared };
}

module.exports = {
  TIME_BLOCKS,
  CATEGORY_FALLBACK,
  PRIORITY_RANK,
  parseDurationFromTitle,
  estimateTask,
  matchRule,
  scheduleDay
};
