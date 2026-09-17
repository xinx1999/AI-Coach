/** 查清历史排序断言为什么失败：把页面真实文本与两条记录的实际顺序打出来 */
const { chromium } = require('playwright-core');
const EXE =
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
const BASE = process.env.BASE || 'http://localhost:4199';

const mkEx = (slug) => ({
  id: slug, slug, name: 'bench', nameZh: '杠铃 宽 卧推', metric: 'reps',
  equipment: 'barbell', equipmentZh: '杠铃', bodyPart: 'chest', bodyPartZh: '胸部',
  target: 'pectorals', targetZh: '胸大肌', muscleGroup: 'triceps', muscleGroupZh: '肱三头肌',
  secondary: [], stretch: false, home: false, gif: null, thumb: null, steps: [], instructions: '',
});
const mkSession = (name, startedAt) => ({
  name, notes: '', startedAt, completedAt: startedAt,
  exercises: [{ slug: '0458', exercise: mkEx('0458'), sets: [{ id: name, setNumber: 1, reps: 10, weight: 50, completed: true }] }],
});

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

  // 故意把顺序倒过来存：旧的在前。若代码里没有排序，页面就会照序显示旧的在上面
  await page.evaluate(
    (hist) => localStorage.setItem('strong-trainer-data', JSON.stringify(hist)),
    {
      sessions: [
        mkSession('9/10 训练', '2026-09-10T02:00:00.000Z'), // 先放旧的
        mkSession('9/17 训练', '2026-09-17T02:00:00.000Z'), // 再放新的
      ],
      favorites: [],
    },
  );

  await page.goto(BASE + '/#history');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.history-item', { timeout: 15000 });
  await page.waitForTimeout(500);

  const names = await page.$$eval('.history-name', (els) => els.map((e) => e.innerText.trim()));
  console.log('页面上的历史顺序（上→下）：', JSON.stringify(names));

  const dates = await page.$$eval('.history-date', (els) => els.map((e) => e.innerText.trim()));
  console.log('对应的日期列：', JSON.stringify(dates));

  const bodyText = await page.$eval('.history-list', (e) => e.innerText);
  console.log('\n.history-list 文本前 240 字：');
  console.log(bodyText.slice(0, 240).replace(/\n/g, ' | '));

  console.log('\n判读：');
  console.log('  期望第一条是「9/17 训练」（较新）');
  console.log('  实际第一条是：', names[0]);

  await browser.close();
})();
