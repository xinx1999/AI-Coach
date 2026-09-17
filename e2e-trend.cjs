/**
 * 验证力量趋势图：数据层取值口径、图表渲染、指标切换、动作筛选、
 * 空状态与数据不足时的表现。
 * 只读检查 + 构造临时数据（每次先清 localStorage），不碰用户真实数据。
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

const mkEx = (slug, nameZh, metric = 'reps') => ({
  id: slug, slug, name: nameZh, nameZh, metric,
  equipment: 'barbell', equipmentZh: '杠铃',
  bodyPart: 'chest', bodyPartZh: '胸部',
  target: 'pectorals', targetZh: '胸大肌',
  muscleGroup: 'triceps', muscleGroupZh: '肱三头肌',
  secondary: [{ en: 'triceps', zh: '肱三头肌' }],
  stretch: false, home: false,
  gif: null, thumb: null, steps: [], instructions: '',
});

/** 造一次训练：sets 形如 [[重量, 次数], ...] */
const mkSess = (daysAgo, slug, nameZh, sets, metric = 'reps') => ({
  name: `${nameZh}训练`,
  notes: '',
  startedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  completedAt: new Date(Date.now() - daysAgo * 86400000 + 3600000).toISOString(),
  exercises: [
    {
      slug,
      exercise: mkEx(slug, nameZh, metric),
      sets: sets.map(([weight, reps], i) => ({
        id: `s${i}`, setNumber: i + 1, reps, weight,
        actualReps: reps, actualWeight: weight, completed: true,
      })),
    },
  ],
});

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1100 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

  const reset = async (sessions) => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.evaluate((s) => {
      localStorage.clear();
      if (s) localStorage.setItem('strong-trainer-data', JSON.stringify({ favorites: [], sessions: s }));
    }, sessions);
    await page.goto(BASE + '/#history', { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
  };

  // ============ A. 数据不足时的空状态 ============
  console.log('\n[A] 数据不足时的表现');
  await reset([]);
  check(await page.isVisible('.trend-card'), '无历史时趋势卡仍在（不藏功能）');
  check(await page.isVisible('.trend-empty'), '显示说明文案');
  const emptyText = await page.locator('.trend-empty').innerText();
  check(emptyText.includes('2 次'), '文案说清需要几次记录');
  check(emptyText.includes('实际完成'), '文案告诉用户去哪里填重量');

  // 只有 1 次记录 → 一个点画不出趋势，仍应提示而不是给个假图
  await reset([mkSess(1, '0122', '杠铃 宽 卧推', [[60, 8]])]);
  check(await page.isVisible('.trend-empty'), '仅 1 次记录时仍提示数据不足');
  check((await page.locator('.trend-chart').count()) === 0, '不渲染只有单点的假图表');

  // ============ B. 正常趋势 ============
  console.log('\n[B] 趋势渲染');
  // 卧推 3 次：60→65→70，次数固定 8
  await reset([
    mkSess(30, '0122', '杠铃 宽 卧推', [[60, 8]]),
    mkSess(20, '0122', '杠铃 宽 卧推', [[65, 8]]),
    mkSess(10, '0122', '杠铃 宽 卧推', [[70, 8]]),
  ]);
  check(await page.isVisible('.trend-chart'), '渲染折线图');
  const dots = await page.locator('.trend-dot').count();
  check(dots === 3, `数据点数量正确（实际 ${dots}）`);
  check((await page.locator('.trend-line').count()) === 1, '画出折线路径');

  // 断言「线上升」而不是断言具体像素：取第一个与最后一个点的 y，后者应更小（屏幕坐标向上）
  const ys = await page.locator('.trend-dot').evaluateAll((els) => els.map((e) => +e.getAttribute('cy')));
  check(ys[ys.length - 1] < ys[0], `重量上升在图上表现为线上升（y ${ys[0].toFixed(0)} → ${ys[ys.length - 1].toFixed(0)}）`);

  // 默认视角是 1RM：70×(1+8/30)=88.7，所以显示的应当是估算值而不是 70
  const bestText = await page.locator('.trend-best').innerText();
  check(bestText.includes('88.7'), `1RM 视角显示估算最好成绩（${bestText.replace(/\n/g, ' ')}）`);
  check(bestText.includes('最重') === false, '1RM 视角下标为「最好」而非「最重」');

  // ============ C. 估算 1RM 口径 ============
  console.log('\n[C] 估算 1RM');
  // 重量不变、次数增加：只看重量是平线，1RM 应该上升
  await reset([
    mkSess(20, '0122', '杠铃 宽 卧推', [[60, 5]]),
    mkSess(10, '0122', '杠铃 宽 卧推', [[60, 12]]),
  ]);
  // 默认视角为 1RM，应显示 +delta
  const deltaUp = await page.locator('.trend-delta').innerText();
  check(await page.isVisible('.trend-delta'), `重量不变但 1RM 有变化时显示差值（${deltaUp.replace(/\n/g, ' ')}）`);
  check(/^\+/.test(deltaUp.trim()), '差值为正（次数增加被正确计入）');
  // 60×(1+5/30)=70，60×(1+12/30)=84 → +14
  check(deltaUp.includes('14'), `差值数值正确（期望 +14kg，实际 ${deltaUp.replace(/\n/g, ' ')}）`);

  // 切到「最大重量」视角：重量没变，应为持平而非上涨
  await page.locator('.trend-toggle-btn', { hasText: '最大重量' }).click();
  await page.waitForFunction(() => {
    const el = document.querySelector('.trend-delta');
    return el && el.textContent.includes('0');
  }, null, { timeout: 4000 });
  const deltaFlat = await page.locator('.trend-delta').innerText();
  check(deltaFlat.includes('0'), `最大重量视角下为持平（${deltaFlat.replace(/\n/g, ' ')}）`);
  const flatCls = await page.locator('.trend-delta').getAttribute('class');
  check(flatCls.includes('flat'), '持平状态的样式类正确');

  // 切回 1RM 应恢复
  await page.locator('.trend-toggle-btn', { hasText: '估算 1RM' }).click();
  await page.waitForTimeout(250);
  check((await page.locator('.trend-delta').innerText()).includes('14'), '切回 1RM 后差值恢复');

  // ============ D. 多动作选择 ============
  console.log('\n[D] 动作选择');
  await reset([
    mkSess(30, '0122', '杠铃 宽 卧推', [[60, 8]]),
    mkSess(20, '0122', '杠铃 宽 卧推', [[65, 8]]),
    mkSess(25, '0066', '杠铃 单臂 侧 硬拉', [[100, 5]]),
    mkSess(15, '0066', '杠铃 单臂 侧 硬拉', [[110, 5]]),
    mkSess(5, '0066', '杠铃 单臂 侧 硬拉', [[120, 5]]),
  ]);
  const chips = await page.locator('.trend-chip').count();
  check(chips === 2, `两个动作都可选（实际 ${chips}）`);
  const firstChip = await page.locator('.trend-chip').first().innerText();
  check(firstChip.includes('硬拉'), `记录次数多的排在前面（首位 ${firstChip.replace(/\n/g, ' ')}）`);

  await page.locator('.trend-chip', { hasText: '杠铃 宽 卧推' }).click();
  await page.waitForTimeout(250);
  // 切到卧推后 1RM 视角：65×(1+8/30)=82.3（切走前是硬拉的 120 系列）
  const afterSwitch = await page.locator('.trend-best').innerText();
  check(afterSwitch.includes('82.3'), `切换动作后数据跟着变（${afterSwitch.replace(/\n/g, ' ')}）`);
  const dotsAfter = await page.locator('.trend-dot').count();
  check(dotsAfter === 2, `切换后数据点数量正确（实际 ${dotsAfter}）`);

  // ============ E. 只统计负重类 ============
  console.log('\n[E] 计量方式过滤');
  // 距离类动作没有重量可比，不该出现在趋势选择里
  await reset([
    mkSess(30, '0685', '跑步', [[0, 0]], 'distance'),
    mkSess(20, '0685', '跑步', [[0, 0]], 'distance'),
    mkSess(20, '0122', '杠铃 宽 卧推', [[60, 8]]),
    mkSess(10, '0122', '杠铃 宽 卧推', [[65, 8]]),
  ]);
  const chipNames = await page.locator('.trend-chip').allInnerTexts();
  check(!chipNames.some((n) => n.includes('跑步')), '距离类动作不出现在趋势里');
  check(chipNames.some((n) => n.includes('卧推')), '负重类动作正常出现');

  // ============ F. 同次训练取最重一组 ============
  console.log('\n[F] 取值口径');
  // 一次训练里热身 40kg、正式 80kg，应取 80 而不是平均或第一组
  await reset([
    mkSess(30, '0122', '杠铃 宽 卧推', [[40, 12], [80, 5], [75, 6]]),
    mkSess(10, '0122', '杠铃 宽 卧推', [[45, 12], [85, 5]]),
  ]);
  const ysF = await page.locator('.trend-dot').evaluateAll((els) => els.map((e) => +e.getAttribute('cy')));
  // 切到最大重量视角看原始公斤数，不受 1RM 换算干扰
  await page.locator('.trend-toggle-btn', { hasText: '最大重量' }).click();
  await page.waitForTimeout(300);
  const bestF = await page.locator('.trend-best').innerText();
  check(bestF.includes('85'), `最好成绩取全局最大值（${bestF.replace(/\n/g, ' ')}）`);
  // 第一次训练有 40/80/75 三组，取最重 80 而非第一组 40
  const t2 = await page.locator('.trend-dot').nth(0).evaluate((e) => e.querySelector('title').textContent);
  check(t2.includes('80'), `单次训练取最重一组而非第一组（${t2}）`);
  const t1 = await page.locator('.trend-dot').nth(1).evaluate((e) => e.querySelector('title').textContent);
  check(t1.includes('85'), `第二次训练取最重一组（${t1}）`);

  // ============ G. 未完成组不计入 ============
  console.log('\n[G] 只统计已完成组');
  const sess = mkSess(10, '0122', '杠铃 宽 卧推', [[60, 8], [200, 1]]);
  sess.exercises[0].sets[1].completed = false; // 200kg 那组没做完
  await reset([mkSess(20, '0122', '杠铃 宽 卧推', [[60, 8]]), sess]);
  await page.locator('.trend-toggle-btn', { hasText: '最大重量' }).click();
  await page.waitForTimeout(300);
  const bestG = await page.locator('.trend-best').innerText();
  check(!bestG.includes('200'), `未完成的组不参与统计（${bestG.replace(/\n/g, ' ')}）`);
  check(bestG.includes('60'), `只统计已完成组（${bestG.replace(/\n/g, ' ')}）`);

  // ============ H. 边界与健壮性 ============
  console.log('\n[H] 边界情况');
  // 所有重量相同 → 除零风险，应正常渲染
  await reset([
    mkSess(20, '0122', '杠铃 宽 卧推', [[60, 8]]),
    mkSess(10, '0122', '杠铃 宽 卧推', [[60, 8]]),
  ]);
  check(await page.isVisible('.trend-chart'), '数值完全相同时仍能渲染（无除零）');
  const sameYs = await page.locator('.trend-dot').evaluateAll((els) => els.map((e) => +e.getAttribute('cy')));
  check(new Set(sameYs.map((y) => y.toFixed(1))).size === 1, '相同数值的点画在同一水平线上');
  const flatDelta = await page.locator('.trend-delta').innerText();
  check(flatDelta.includes('0'), `完全相同显示 0 而非编造变化（${flatDelta.replace(/\n/g, ' ')}）`);

  // 大量数据点不应崩
  const many = [];
  for (let i = 40; i >= 1; i--) many.push(mkSess(i, '0122', '杠铃 宽 卧推', [[60 + i, 8]]));
  await reset(many);
  const manyDots = await page.locator('.trend-dot').count();
  check(manyDots === 40, `40 次记录全部渲染（实际 ${manyDots}）`);

  // ============ I. 控制台 ============
  console.log('\n[I] 控制台');
  check(errors.length === 0, errors.length ? `有错误：${errors.slice(0, 3).join(' | ')}` : '无控制台错误');

  await browser.close();
  console.log(fail === 0 ? '\n===== 全部通过 =====' : `\n===== ${fail} 项失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
})();
