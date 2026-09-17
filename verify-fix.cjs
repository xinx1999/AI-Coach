/**
 * 验证修复：有进行中训练时应用新计划 → 必须弹确认，而不是静默替换。
 *
 * 契约更新（截断存档）：
 *   旧版 confirmApplyPlan 直接 setSession(null)，弹窗只能诚实写「不会存入历史」。
 *   现在已完成的组会作为一次训练写进历史（未完成的部分丢弃），
 *   所以断言从「不会存入历史」改为「如实说明会存多少组」+「历史里确实多了一条」。
 *
 * 同时：usePersistentState 已改为 null 不落盘（removeItem 而非写 "null"），
 *   所以「没有进行中的训练」现在表现为键不存在，而不是值为字符串 "null"。
 */
const { chromium } = require('playwright-core');
const EXE =
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
const BASE = process.env.BASE || 'http://localhost:5173';
const SESSION_KEY = 'strong-trainer-active-session';

const SESSION = {
  name: '遗留训练',
  notes: '',
  startedAt: new Date().toISOString(),
  exercises: [
    {
      slug: 'bench-press',
      exercise: {
        id: 'e', slug: 'bench-press', name: 'Barbell Bench Press', nameZh: '杠铃卧推',
        metric: 'reps', equipment: 'barbell', equipmentZh: '杠铃',
        bodyPart: 'chest', bodyPartZh: '胸部',
        target: 'pectorals', targetZh: '胸大肌',
        muscleGroup: 'triceps', muscleGroupZh: '肱三头肌',
        secondary: [{ en: 'triceps', zh: '肱三头肌' }],
        stretch: false, home: false,
        gif: null, thumb: null, steps: [], instructions: '',
      },
      sets: [
        { id: 'a', setNumber: 1, completed: true },
        { id: 'b', setNumber: 2, completed: false },
        { id: 'c', setNumber: 3, completed: false },
      ],
    },
  ],
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  let fail = 0;
  const check = (c, m) => {
    console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`);
    if (!c) fail++;
  };

  const goto = async (hash) => {
    await page.goto(`${BASE}/#${hash}`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(350);
  };

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());

  // ---------- 1. 场景：编排空 + 有进行中训练 ----------
  console.log('\n[1] 编排空 + 有进行中训练 → 计时页应明确显示是什么');
  await page.evaluate((s) => {
    localStorage.setItem('strong-trainer-draft-workout', '[]');
    localStorage.setItem('strong-trainer-active-session', JSON.stringify(s));
  }, SESSION);
  await goto('timer');
  check(await page.isVisible('.guided-card'), '跟组卡片正常渲染');
  check((await page.locator('.guided-row').count()) === 1, '显示 1 个动作');
  const dotTitle = await page.locator('.nav-btn .nav-dot').first().getAttribute('title');
  console.log(`  小红点提示: ${dotTitle}`);
  check(Boolean(dotTitle && dotTitle.includes('1 个动作')), '小红点带说明性 title');

  // ---------- 2. 应用新计划必须弹确认 ----------
  console.log('\n[2] 有进行中训练时应用新计划 → 弹确认，不静默替换');
  await goto('plan');
  await page.locator('.muscle-chip', { hasText: '胸大肌' }).first().click();
  await page.waitForTimeout(150);
  await page.locator('.wizard-generate').click();
  await page.waitForSelector('.wizard-result');
  await page.locator('.wizard-apply').click();
  await page.waitForTimeout(400);

  const modal = page.locator('.modal-backdrop');
  check(await modal.isVisible(), '弹出了确认框');
  const modalText = await page.locator('.modal-card').innerText();
  console.log('  弹窗: ' + modalText.replace(/\n+/g, ' | '));
  check(modalText.includes('有进行中的训练'), '标题说明冲突原因');
  check(modalText.includes('已完成的 1 组会存入历史记录'), '如实说明已完成的组会进历史');
  check(!modalText.includes('不会存入历史'), '不再出现「不会存入历史」这句旧承诺');

  // 编排此时不应被改动
  const draftStillEmpty = await page.evaluate(
    () => JSON.parse(localStorage.getItem('strong-trainer-draft-workout') || '[]').length,
  );
  check(draftStillEmpty === 0, '确认前编排未被替换');

  // ---------- 3. 取消 ----------
  console.log('\n[3] 点「取消」→ 什么都不发生');
  await page.locator('.modal-card button', { hasText: '取消' }).click();
  await page.waitForTimeout(300);
  check(!(await modal.isVisible()), '弹窗关闭');
  check(
    (await page.evaluate(() => JSON.parse(localStorage.getItem('strong-trainer-draft-workout') || '[]').length)) === 0,
    '编排仍为空',
  );
  check(
    (await page.evaluate((k) => localStorage.getItem(k), SESSION_KEY)) !== null,
    '进行中的训练仍保留',
  );

  // ---------- 4. 仍要替换 ----------
  console.log('\n[4] 点「仍要替换」→ 写入新计划、清掉旧训练、已完成的组进历史');
  await page.locator('.wizard-apply').click();
  await page.waitForTimeout(300);
  await page.locator('.modal-card button', { hasText: '仍要替换' }).click();
  await page.waitForTimeout(400);
  check(page.url().endsWith('#build'), '跳转到编排页');
  const buildCount = await page.locator('.workout-item').count();
  console.log(`  编排页动作数: ${buildCount}`);
  check(buildCount > 0, '新计划已写入编排');
  check(
    (await page.evaluate((k) => localStorage.getItem(k), SESSION_KEY)) === null,
    '旧的进行中训练已清掉（键不存在）',
  );
  check((await page.locator('.nav-btn .nav-dot').count()) === 0, '计时小红点已消失');

  // SESSION 只有 1 组 completed:true，所以历史里应恰好新增 1 条（截断存档）
  const archived = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('strong-trainer-data') || '{}');
    return {
      count: (s.sessions || []).length,
      totalSets: (s.sessions || []).reduce((n, x) => n + x.exercises.reduce((m, e) => m + e.sets.length, 0), 0),
      name: (s.sessions || [])[0]?.name || '',
    };
  });
  console.log(`  历史记录: ${archived.count} 条 / 共 ${archived.totalSets} 组 / ${archived.name}`);
  check(archived.count === 1, '历史新增 1 条截断存档');
  check(archived.totalSets === 1, '只存了已完成的 1 组');
  check(archived.name.includes('中途结束'), '名称标明是中途结束');

  // 注意：goto() 走的是 page.goto，而本应用是 hash 路由，
  // 同文档导航不会重挂 App，React 状态里 session 仍指向旧值，
  // 因此这里不能断言「空状态」——那是 goto/硬刷新之后才成立的。
  // 只断言与路由无关的事实：旧训练已清掉、小红点已消失。

  // ---------- 5. 无进行中训练时不应弹窗 ----------
  console.log('\n[5] 没有进行中训练时 → 直接应用，不弹窗');
  await page.evaluate(() => localStorage.setItem('strong-trainer-draft-workout', '[]'));
  await goto('plan');
  await page.locator('.muscle-chip', { hasText: '背阔肌' }).first().click();
  await page.waitForTimeout(150);
  await page.locator('.wizard-generate').click();
  await page.waitForSelector('.wizard-result');
  await page.locator('.wizard-apply').click();
  await page.waitForTimeout(400);
  check(!(await page.locator('.modal-backdrop').isVisible().catch(() => false)), '未弹确认框');
  check(page.url().endsWith('#build'), '直接跳转到编排页');
  check((await page.locator('.workout-item').count()) > 0, '计划已写入');

  // ---------- 6. 坏数据兜底 ----------
  console.log('\n[6] 进行中训练为空数组 → 给出可操作的空状态');
  await page.evaluate((s) => {
    localStorage.setItem('strong-trainer-draft-workout', '[]');
    localStorage.setItem(
      'strong-trainer-active-session',
      JSON.stringify({ ...s, exercises: [] }),
    );
  }, SESSION);
  await goto('timer');
  const txt = await page.locator('.empty-state').innerText().catch(() => '(无空状态)');
  console.log('  ' + txt.replace(/\n+/g, ' | '));
  check(txt.includes('没有动作'), '识别出空训练并给出说明');
  check(await page.isVisible('button:has-text("丢弃并去编排")'), '提供丢弃入口');

  // ---------- 7. 不写空值 ----------
  // hash 路由是同文档导航，模块会被重新求值、effect 会重跑；
  // 若持久化 hook 无条件 setItem，一个从没碰过的键就会被创建成字符串 "null"。
  console.log('\n[7] 没有值的键不应被凭空写出来');
  await page.evaluate((k) => localStorage.removeItem(k), SESSION_KEY);
  await goto('timer');
  await goto('history');
  await goto('build');
  const phantom = await page.evaluate((k) => Object.keys(localStorage).includes(k), SESSION_KEY);
  console.log(`  反复切页后 ${SESSION_KEY} 是否存在: ${phantom}`);
  check(!phantom, '未把 null 写成字符串 "null"');

  console.log(`\n控制台错误: ${errors.length}`);
  errors.slice(0, 5).forEach((e) => console.log('  ' + e));
  await browser.close();
  console.log(`\n结果：${fail === 0 ? '全部通过' : `${fail} 项失败`}`);
  process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
