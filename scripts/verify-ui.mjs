import { chromium } from 'playwright-core';

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3000';

async function capture(page, name) {
  await page.screenshot({ path: `C:/Users/wangyinuo/.codex/visualizations/2026/08/15/01a004d6-9465-7ae3-a4db-6aeac2336297/${name}.png`, fullPage: true });
}

async function textOverflow(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.button, .tab, .task-title, .badge, .stat strong'))
      .filter((el) => el.scrollWidth > el.clientWidth + 2)
      .map((el) => el.textContent.trim())
      .slice(0, 20)
  );
}

async function overflowOffenders(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('body *'))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { tag: el.tagName, id: el.id, cls: el.className, right: Math.round(rect.right), left: Math.round(rect.left), width: Math.round(rect.width) };
      })
      .filter((item) => item.right > window.innerWidth + 1 || item.left < -1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 15)
  );
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const errors = [];
const testTitle = `UI 验证任务 ${Date.now()}`;

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  desktop.on('pageerror', (error) => errors.push(`desktop: ${error.message}`));
  desktop.on('console', (message) => {
    if (message.type() === 'error') errors.push(`desktop console: ${message.text()}`);
  });
  await desktop.goto(BASE, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('.task-item');

  await desktop.fill('#task-title', testTitle);
  await desktop.fill('#task-duration', '45');
  await desktop.click('#form-submit');
  await desktop.waitForFunction((title) => Array.from(document.querySelectorAll('.task-title')).some((el) => el.textContent.includes(title)), testTitle);
  await capture(desktop, 'desktop-v2-today');

  await desktop.click('#auto-schedule');
  await desktop.waitForTimeout(800);

  const afterAdd = await fetch(`${BASE}/api/tasks?date=${encodeURIComponent(await desktop.inputValue('#task-date'))}`);
  const afterAddTasks = await afterAdd.json();
  const testTaskId = afterAddTasks.find((task) => task.title === testTitle)?.id;

  await desktop.click('button[data-view="timeline"]');
  await desktop.waitForSelector('.timeline-block');
  await capture(desktop, 'desktop-v2-timeline');

  if (testTaskId) {
    const block = desktop.locator(`.timeline-block[data-id="${testTaskId}"]`);
    const box = await block.boundingBox();
    let dragExecuted = false;
    if (box) {
      dragExecuted = true;
      await desktop.mouse.move(box.x + box.width / 2, box.y + 10);
      await desktop.mouse.down();
      await desktop.mouse.move(box.x + box.width / 2, box.y + 60, { steps: 8 });
      await desktop.mouse.up();
      await desktop.waitForTimeout(800);
    }
    const afterDrag = await fetch(`${BASE}/api/tasks?date=${encodeURIComponent(await desktop.inputValue('#task-date'))}`);
    const afterDragTasks = await afterDrag.json();
    const draggedTask = afterDragTasks.find((task) => task.title === testTitle);
    console.log(JSON.stringify({ dragExecuted, dragBox: box, startAfterDrag: draggedTask?.start_min, durationAfterDrag: draggedTask?.duration_min }));
  }

  await desktop.click('button[data-view="settings"]');
  await desktop.waitForSelector('#theme-presets .theme-swatch');
  await desktop.click('[data-theme-id="coral"]');
  await desktop.click('#theme-save');
  await desktop.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#e8622d');
  await capture(desktop, 'desktop-v2-settings');

  const desktopOverflow = await desktop.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const desktopTextOverflow = await textOverflow(desktop);
  const desktopOffenders = await overflowOffenders(desktop);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.on('pageerror', (error) => errors.push(`mobile: ${error.message}`));
  mobile.on('console', (message) => {
    if (message.type() === 'error') errors.push(`mobile console: ${message.text()}`);
  });
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('.task-item');
  const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const mobileTextOverflow = await textOverflow(mobile);
  await capture(mobile, 'mobile-v2-today');

  const taskResult = await fetch(`${BASE}/api/tasks?date=${encodeURIComponent(await desktop.inputValue('#task-date'))}`);
  const tasks = await taskResult.json();
  const testTask = tasks.find((task) => task.title === testTitle);

  console.log(JSON.stringify({
    testTitle,
    testTaskId: testTask?.id,
    testTaskStartMin: testTask?.start_min,
    testTaskDurationMin: testTask?.duration_min,
    desktopOverflow,
    mobileOverflow,
    desktopTextOverflow,
    mobileTextOverflow,
    desktopOffenders,
    errors
  }, null, 2));

  if (testTask?.id) {
    await fetch(`${BASE}/api/tasks/${testTask.id}`, { method: 'DELETE' });
  }
} finally {
  await browser.close();
}
