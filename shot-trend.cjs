/** 截取趋势图，用于人工核对视觉效果 */
const { chromium } = require('playwright-core');
const EXE = 'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';

const mkSess = (daysAgo, sets) => ({
  name: '胸推日',
  notes: '',
  startedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  completedAt: new Date(Date.now() - daysAgo * 86400000 + 3600000).toISOString(),
  exercises: [{
    slug: '0122',
    exercise: {
      id: '0122', slug: '0122', name: 'barbell bench press', nameZh: '杠铃 宽 卧推',
      metric: 'reps', equipment: 'barbell', equipmentZh: '杠铃',
      bodyPart: 'chest', bodyPartZh: '胸部', target: 'pectorals', targetZh: '胸大肌',
      muscleGroup: 'triceps', muscleGroupZh: '肱三头肌',
      secondary: [{ en: 'triceps', zh: '肱三头肌' }],
      stretch: false, home: false, gif: null, thumb: null, steps: [], instructions: '',
    },
    sets: sets.map(([w, r], i) => ({
      id: `s${i}`, setNumber: i + 1, reps: r, weight: w,
      actualReps: r, actualWeight: w, completed: true,
    })),
  }],
});

(async () => {
  const b = await chromium.launch({ executablePath: EXE });
  const ctx = await b.newContext({ viewport: { width: 760, height: 1200 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const sessions = [
    mkSess(70, [[60, 8], [62.5, 8], [62.5, 7]]),
    mkSess(56, [[62.5, 8], [65, 8], [65, 7]]),
    mkSess(42, [[65, 8], [67.5, 8], [67.5, 6]]),
    mkSess(28, [[67.5, 8], [70, 8], [70, 6]]),
    mkSess(14, [[70, 8], [72.5, 8], [72.5, 7]]),
    mkSess(3, [[72.5, 8], [75, 8], [75, 7]]),
  ];
  await p.goto('http://localhost:4199/', { waitUntil: 'networkidle' });
  await p.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('strong-trainer-data', JSON.stringify({ favorites: [], sessions: s }));
  }, sessions);
  await p.goto('http://localhost:4199/#history', { waitUntil: 'networkidle' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);

  const card = p.locator('.trend-card');
  await card.screenshot({ path: 'trend-1rm.png' });
  console.log('已保存 trend-1rm.png');

  await p.locator('.trend-toggle-btn', { hasText: '最大重量' }).click();
  await p.waitForTimeout(500);
  await card.screenshot({ path: 'trend-weight.png' });
  console.log('已保存 trend-weight.png');

  await p.screenshot({ path: 'trend-page.png', fullPage: true });
  console.log('已保存 trend-page.png');
  await b.close();
})();
