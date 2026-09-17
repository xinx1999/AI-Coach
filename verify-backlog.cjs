/**
 * 评审报告「待办清单」的现状核验。
 *
 * 背景：报告的「建议优先级」里还列着 P1-1 / P1-3 / P1-4 / P2-2 / P2-6 为待办，
 * 但代码里这些能力都已经存在（getLastPerformance、metricSpecFor、焦点陷阱、
 * startedAt 排序…）。读码只能证明「写了」，不能证明「跑起来对」——
 * 这个脚本在真实运行的应用上逐条取证，用来决定报告该改成什么状态。
 *
 * 每条都断言「可观察的行为」，不依赖源码字符串。
 */
const { chromium } = require('playwright-core');
const EXE =
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
const BASE = process.env.BASE || 'http://localhost:4199';

let fail = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fail++;
};
const info = (msg) => console.log(`      ${msg}`);

/** 造一次历史记录：两个动作，其中一个有实际值、一个只有计划值 */
const seedHistory = (slug) => ({
  sessions: [
    {
      name: '9/17 训练',
      notes: '',
      startedAt: '2026-09-17T02:00:00.000Z',
      completedAt: '2026-09-17T03:00:00.000Z',
      exercises: [
        {
          slug,
          exercise: {
            id: slug, slug, name: 'barbell bench press', nameZh: '杠铃 宽 卧推',
            metric: 'reps', equipment: 'barbell', equipmentZh: '杠铃',
            bodyPart: 'chest', bodyPartZh: '胸部',
            target: 'pectorals', targetZh: '胸大肌',
            muscleGroup: 'triceps', muscleGroupZh: '肱三头肌',
            secondary: [], stretch: false, home: false,
            gif: null, thumb: null, steps: [], instructions: '',
          },
          sets: [
            // 计划 10 次 50kg，实际做了 8 次 60kg —— 必须显示实际值
            { id: 'a1', setNumber: 1, reps: 10, weight: 50, actualReps: 8, actualWeight: 60, completed: true },
          ],
        },
      ],
    },
    // 更早的一次，用来验证排序与「上次」取的是最近一次
    {
      name: '9/10 训练',
      notes: '',
      startedAt: '2026-09-10T02:00:00.000Z',
      completedAt: '2026-09-10T03:00:00.000Z',
      exercises: [
        {
          slug,
          exercise: {
            id: slug, slug, name: 'barbell bench press', nameZh: '杠铃 宽 卧推',
            metric: 'reps', equipment: 'barbell', equipmentZh: '杠铃',
            bodyPart: 'chest', bodyPartZh: '胸部',
            target: 'pectorals', targetZh: '胸大肌',
            muscleGroup: 'triceps', muscleGroupZh: '肱三头肌',
            secondary: [], stretch: false, home: false,
            gif: null, thumb: null, steps: [], instructions: '',
          },
          sets: [
            { id: 'b1', setNumber: 1, reps: 10, weight: 40, actualReps: 10, actualWeight: 40, completed: true },
          ],
        },
      ],
    },
  ],
  favorites: [],
});

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  // 先从 catalog 拿一个真实 slug，别凭常识编
  const catalog = require('./src/lib/catalog.json');
  const list = Array.isArray(catalog)
    ? catalog
    : catalog.exercises || catalog.items || Object.values(catalog)[0];
  const bench = list.find((e) => e.target === 'pectorals' && !e.home && e.metric === 'reps');
  // 注意是 metric === 'distance'，不是 'distance_duration'——后者是旧的 exerciseType 取值，
  // 现在 catalog 里 metric 只有 reps / duration / distance 三种
  const runEx = list.find((e) => e.metric === 'distance');
  info(`用真实 slug：${bench.slug}（${bench.nameZh}）/ 距离类：${runEx ? runEx.slug + '（' + runEx.nameZh + '）' : '无'}`);

  // 预置历史与编排
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ hist, draft }) => {
      localStorage.setItem('strong-trainer-data', JSON.stringify(hist));
      localStorage.setItem('strong-trainer-draft-workout', JSON.stringify(draft));
    },
    {
      hist: seedHistory(bench.slug),
      draft: [
        {
          slug: bench.slug,
          exercise: {
            id: bench.slug, slug: bench.slug, name: bench.name, nameZh: bench.nameZh,
            metric: bench.metric, equipment: bench.equipment, equipmentZh: bench.equipmentZh,
            bodyPart: bench.bodyPart, bodyPartZh: bench.bodyPartZh,
            target: bench.target, targetZh: bench.targetZh,
            muscleGroup: bench.muscleGroup, muscleGroupZh: bench.muscleGroupZh,
            secondary: [], stretch: false, home: bench.home,
            gif: bench.gif, thumb: bench.thumb, steps: [], instructions: '',
          },
          sets: [{ id: 'x1', setNumber: 1, reps: 10, weight: 55, completed: false }],
        },
        ...(runEx
          ? [{
              slug: runEx.slug,
              exercise: {
                id: runEx.slug, slug: runEx.slug, name: runEx.name, nameZh: runEx.nameZh,
                metric: runEx.metric, equipment: runEx.equipment, equipmentZh: runEx.equipmentZh,
                bodyPart: runEx.bodyPart, bodyPartZh: runEx.bodyPartZh,
                target: runEx.target, targetZh: runEx.targetZh,
                muscleGroup: runEx.muscleGroup, muscleGroupZh: runEx.muscleGroupZh,
                secondary: [], stretch: false, home: runEx.home,
                gif: runEx.gif, thumb: runEx.thumb, steps: [], instructions: '',
              },
              sets: [{ id: 'y1', setNumber: 1, reps: 10, weight: 0, completed: false }],
            }]
          : []),
      ],
    },
  );

  console.log('\n=== P1-1 「上次同动作」提示 ===');
  await page.goto(BASE + '/#build');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.workout-item', { timeout: 15000 });

  const lastEls = await page.$$('.workout-item-last');
  const lastTexts = await page.$$eval('.workout-item-last', (els) =>
    els.map((e) => e.innerText.trim()),
  );
  info(`渲染出的「上次」提示：${JSON.stringify(lastTexts)}`);
  check(lastEls.length > 0, '编排页渲染了「上次」提示');

  const first = lastTexts[0] || '';
  // 最近的 9/17 那次是 actual 8次/60kg，更早的 9/10 是 10次/40kg
  check(/60/.test(first), `提示取的是最近一次的实际值 60kg（实得「${first}」）`);
  check(!/40/.test(first), '没有误取更早那次的 40kg');
  check(/8/.test(first), '显示的是实际次数 8 次，而非计划值 10 次');

  console.log('\n=== P1-1 计时页输入 + 实际值回显 ===');
  // 开始训练，进入计时页
  const startBtn = await page.$('.btn-primary:has-text("开始")');
  if (startBtn) {
    await startBtn.click();
    await page.waitForSelector('.guided-card, .timer-ring', { timeout: 15000 });
  } else {
    // 找不到就用编排页的开始按钮选择器兜底
    const alt = await page.$('button:has-text("开始训练")');
    if (alt) await alt.click();
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(600);

  // 实际值输入框在 .guided-actual 区块里，不是靠 title 标注的
  const actualBlock = await page.$$('.guided-actual');
  const actualLabel = await page.$$eval('.guided-actual-label', (els) =>
    els.map((e) => e.innerText.trim()),
  );
  const actualInputs = await page.$$eval('.guided-actual input', (els) =>
    els.map((e) => ({ placeholder: e.placeholder, type: e.type })),
  );
  info(`「实际完成」区块 ${actualBlock.length} 个，标签 ${JSON.stringify(actualLabel)}`);
  info(`该区块内输入框：${JSON.stringify(actualInputs)}`);
  check(actualBlock.length > 0, '计时页有「实际完成」区块');
  check(actualLabel.some((t) => /实际/.test(t)), '区块标注了「实际完成」字样');
  check(actualInputs.length > 0, `区块内可输入实际值（${actualInputs.length} 个输入框）`);

  /*
   * 关键区分：实际值输入框的 placeholder 是计划值（10 / 55），
   * 而计划值的输入框在编排页。这里要证明的是「计时页能写实际值」，
   * 所以直接写入并回读，而不是只看 DOM 存在。
   */
  const firstActual = await page.$('.guided-actual input');
  if (firstActual) {
    await firstActual.fill('7');
    await page.waitForTimeout(300);
    const persisted = await page.evaluate(() => {
      const raw = localStorage.getItem('strong-trainer-active-session');
      if (!raw) return null;
      const s = JSON.parse(raw);
      const set = s?.exercises?.[0]?.sets?.[0];
      return set ? { actualReps: set.actualReps, reps: set.reps } : null;
    });
    info(`写入后持久化的首个 set：${JSON.stringify(persisted)}`);
    check(
      persisted && persisted.actualReps === 7 && persisted.reps !== 7,
      '实际值 7 写进了 actualReps，且计划值 reps 未被覆盖',
    );
  }

  const timerLast = await page.$$('.guided-last, .timer-last, [class*="last"]');
  const timerLastText = await page.$$eval('[class*="last"]', (els) =>
    els.map((e) => e.innerText.trim()).filter(Boolean),
  );
  info(`计时页「上次」相关文本：${JSON.stringify(timerLastText)}`);
  check(timerLastText.some((t) => /上次/.test(t)), '计时页也显示「上次」提示');

  console.log('\n=== P1-4 按动作类型切输入形态 ===');
  await page.goto(BASE + '/#build');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.workout-item', { timeout: 15000 });

  const titles = await page.$$eval('.set-row input', (els) => [
    ...new Set(els.map((e) => e.title || e.placeholder).filter(Boolean)),
  ]);
  info(`编排页 set 输入框的表头：${JSON.stringify(titles)}`);
  check(
    titles.some((t) => /米|距离|km|m\b/i.test(t)) || titles.some((t) => /秒|时长/.test(t)),
    '距离类动作出现了「距离/时长」输入形态（不再一律是次+kg）',
  );
  check(titles.some((t) => /次|次数/.test(t)), '力量类动作仍然是「次」');
  check(
    !titles.every((t) => /kg|公斤|重量/.test(t)),
    '不是所有动作都要求填 kg',
  );

  console.log('\n=== P2-6 历史按 startedAt 排序（非写入顺序）===');
  /*
   * 关键：**故意把存储顺序写反**（旧的在前）。
   * 若实现依赖「写入顺序」，页面就会照序显示旧的在上面，断言立刻失败。
   * 只断言「新的在上面」还不够——必须用反序输入，才证明得了是显式排序。
   */
  const reversed = seedHistory(bench.slug);
  reversed.sessions.reverse(); // 9/10 在前，9/17 在后
  await page.evaluate(
    (hist) => localStorage.setItem('strong-trainer-data', JSON.stringify(hist)),
    reversed,
  );
  info('已把存储顺序写成 [9/10, 9/17]（旧的在前）');

  await page.goto(BASE + '/#history');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.history-item', { timeout: 15000 });
  await page.waitForTimeout(500);

  // 只读列表内的名字，不要读整页 body——header 的统计文本会先命中日期串
  const histNames = await page.$$eval('.history-name', (els) =>
    els.map((e) => e.innerText.trim()),
  );
  info(`页面上的历史顺序（上→下）：${JSON.stringify(histNames)}`);
  check(histNames.length >= 2, `渲染了 ${histNames.length} 条历史`);
  check(histNames[0] === '9/17 训练', '第一条是最新的 9/17（存储里它排在后面）');
  check(histNames[1] === '9/10 训练', '第二条是较旧的 9/10');

  console.log('\n=== P2-2 弹窗焦点管理 ===');
  await page.goto(BASE + '/#browse');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.exercise-card', { timeout: 15000 });

  // 记录触发前的焦点，点开卡片
  await page.evaluate(() => {
    const card = document.querySelector('.exercise-card');
    card.setAttribute('data-probe', 'trigger');
  });
  await page.click('.exercise-card');
  await page.waitForSelector('.detail-modal', { timeout: 15000 });
  await page.waitForTimeout(300);

  const focusInModal = await page.evaluate(() => {
    const m = document.querySelector('.detail-modal');
    return m ? m.contains(document.activeElement) : false;
  });
  check(focusInModal, '弹窗打开后焦点被移入弹窗内（不再停在背后的卡片上）');

  const activeInfo = await page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName}.${a.className}` : 'none';
  });
  info(`打开后 activeElement = ${activeInfo}`);

  // Tab 循环：连续 Tab 多次，焦点应始终留在弹窗内
  let escaped = false;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const m = document.querySelector('.detail-modal');
      return m ? m.contains(document.activeElement) : false;
    });
    if (!inside) {
      escaped = true;
      break;
    }
  }
  check(!escaped, '连续 Tab 25 次焦点未逃出弹窗（焦点陷阱生效）');

  // Esc 关闭后焦点归还
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const restored = await page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName}.${a.className}`.includes('exercise-card') || a.hasAttribute('data-probe') : false;
  });
  check(restored, '关闭后焦点归还给触发它的卡片');

  console.log('\n=== 控制台 ===');
  check(errors.length === 0, `控制台错误 ${errors.length} 条`);
  if (errors.length) console.log(errors.slice(0, 6).join('\n'));

  await browser.close();
  console.log(fail === 0 ? '\n全部通过 ✅' : `\n${fail} 项失败 ❌`);
  process.exit(fail === 0 ? 0 : 1);
})();
