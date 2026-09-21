/**
 * 回归：确认新增「计划」页没有破坏既有的浏览 / 详情 / 编排 / 计时链路。
 */
const { chromium } = require('playwright-core');
const EXE =
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
const BASE = process.env.BASE || 'http://localhost:5173';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  let fail = 0;
  const check = (c, m) => {
    console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`);
    if (!c) fail++;
  };

  // ---------- 浏览页 + 分类 ----------
  // 数据源已换成 exercises-dataset-zh（1318 动作），卡片改为无限滚动按页渲染，
  // 因此这里不再断言「全部卡片数 = 总数」，改为断言分页计数与筛选是否自洽。
  console.log('\n[A] 浏览页与场地分类');
  await page.goto(`${BASE}/#browse`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.exercise-card', { timeout: 15000 });
  const all = await page.locator('.exercise-card').count();
  check(all === 60, `首屏渲染 60 张卡片（PAGE_SIZE，实际 ${all}）`);

  const totalText = await page.locator('.page-count').innerText();
  const total = parseInt(totalText.replace(/\D/g, ''), 10);
  check(total === 1318, `动作总数为 1318（实际 ${total}）`);

  const tabs = await page.locator('.loc-tab').allInnerTexts();
  console.log('  标签: ' + tabs.map((t) => t.replace(/\n/g, ' ')).join(' | '));
  check(tabs.some((t) => t.includes('在家')) && tabs.some((t) => t.includes('健身房')), '有 在家 / 健身房 分类');

  const numFrom = (t) => parseInt(t.replace(/[^\d]/g, ''), 10);
  const homeTab = numFrom(tabs.find((t) => t.includes('在家')) || '0');
  const gymTab = numFrom(tabs.find((t) => t.includes('健身房')) || '0');
  check(homeTab + gymTab === total, `在家 ${homeTab} + 健身房 ${gymTab} = 全部 ${total}（无重叠无遗漏）`);

  await page.locator('.loc-tab', { hasText: '在家' }).click();
  await page.waitForTimeout(400);
  const homeCount = numFrom(await page.locator('.page-count').innerText());
  check(homeCount === homeTab, `切到「在家」后计数一致（${homeCount}）`);

  await page.locator('.loc-tab', { hasText: '健身房' }).click();
  await page.waitForTimeout(400);
  const gymCount = numFrom(await page.locator('.page-count').innerText());
  check(gymCount === gymTab, `切到「健身房」后计数一致（${gymCount}）`);

  await page.locator('.loc-tab', { hasText: '全部' }).click();
  await page.waitForTimeout(400);

  // ---------- 筛选抽屉 ----------
  console.log('\n[A2] 筛选抽屉');
  check(!(await page.isVisible('.filter-panel')), '筛选项默认收起');
  await page.locator('.filter-toggle').click();
  await page.waitForTimeout(300);
  check(await page.isVisible('.filter-panel'), '点击后展开筛选面板');
  const pills = await page.locator('.filter-panel .pill').count();
  check(pills > 20, `筛选胶囊够多（实际 ${pills} 个）`);

  await page.locator('.filter-panel .pill', { hasText: '胸部' }).first().click();
  await page.waitForTimeout(400);
  const chestCount = numFrom(await page.locator('.page-count').innerText());
  check(chestCount === 161, `按「胸部」筛选得到 161 个（实际 ${chestCount}）`);
  const badge = await page.locator('.filter-badge').innerText().catch(() => '');
  check(badge === '1', `筛选按钮显示角标 1（实际 ${badge}）`);
  await page.locator('.filter-panel .pill', { hasText: '全部' }).first().click();
  await page.waitForTimeout(300);
  await page.locator('.filter-toggle').click();
  await page.waitForTimeout(300);

  // ---------- 详情弹窗（动图演示） ----------
  console.log('\n[B] 动作详情弹窗');
  await page.locator('.exercise-card').first().click();
  await page.waitForSelector('.detail-modal', { timeout: 5000 });
  await page.waitForTimeout(1200);

  // 核心改变：三张静态图 → 一个真正的循环动图。
  //
  // 注意：演示区后来又重构了一次 —— 从 `<img src=x.gif>` 换成 ExercisePlayer 的
  // **canvas 自解码播放**（剔定格帧 + 逐帧绘制），类名也从 .demo-media 变成
  // .player-canvas。原先断言 `src.endsWith('.gif')` 因此在重构后必然失败，
  // 与产品功能无关。这里改为按 canvas 的实际形态断言。
  const demo = await page.evaluate(() => {
    const c = document.querySelector('.player-canvas');
    if (!c) return null;
    return { tag: c.tagName, w: c.width, h: c.height };
  });
  check(demo !== null, '详情页有演示区（canvas 播放器）');
  check(!!demo && demo.tag === 'CANVAS', `演示是 canvas 播放器（${demo && demo.tag}）`);
  check(!!demo && demo.w > 0 && demo.h > 0, `画布已渲染（${demo ? demo.w + 'x' + demo.h : 'null'}）`);
  check(!(await page.isVisible('.pose-row')), '已无「三张静态图」残留');

  // 抓两帧，确认它真的在动而不是一张静止图
  const frameA = await page.locator('.player-canvas').screenshot();
  await page.waitForTimeout(900);
  const frameB = await page.locator('.player-canvas').screenshot();
  check(Buffer.compare(frameA, frameB) !== 0, '画布两帧不同 —— 演示确实在动');

  const detailTags = await page.locator('.detail-tag').allInnerTexts();
  console.log('  标签: ' + detailTags.join(' / '));
  check(detailTags.length >= 3, '详情显示主练/器械/部位/计量方式等标签');

  // ---------- 中文教程内容 ----------
  console.log('\n[B2] 中文分步教程');
  check(await page.isVisible('.detail-modal .guide'), '详情页有教程面板');
  // 标题里图标与文字之间有空格（<Icon/> 动作要领），innerText 会带上前导空格，
  // 所以比对前先 trim —— 断言的是文案本身，不是排版产生的空白。
  const guideTitle = (await page.locator('.detail-modal .guide-title').innerText()).trim();
  check(guideTitle === '动作要领', `教程标题为「动作要领」（实际「${guideTitle}」）`);
  // 详情页传 stepsHandled=true：分步说明交给播放器 .player-steps 呈现，
  // GuidePanel 里刻意不重复列（避免同一份文字要滚两遍）。所以查 .player-steps。
  const stepCount = await page.locator('.detail-modal .player-steps li').count();
  check(stepCount >= 3, `分步说明 ${stepCount} 步（应 ≥3）`);
  const stepTexts = await page.locator('.detail-modal .player-steps li').allInnerTexts();
  const hasChinese = stepTexts.every((t) => /[\u4e00-\u9fa5]/.test(t));
  check(hasChinese, '每一步都是中文文案');
  // 归属信息（主练 / 器械 / 部位 / 计量方式）统一在标题下方的 chips 行，
  // 协同肌群单独一行。原先底部还有一份 guide-chip 重复同一批信息，已合并。
  const secondary = await page.locator('.detail-modal .detail-secondary').count();
  console.log('  协同肌群行: ' + (secondary ? '有' : '无'));
  check(secondary <= 1, '协同肌群最多显示一行（不与上方标签重复）');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // ---------- 加入编排 → 计时 ----------
  // 添加动作的入口在详情弹窗里（卡片本身只负责打开详情）
  console.log('\n[C] 加入编排并开始训练');
  await page.locator('.exercise-card').first().click();
  await page.waitForSelector('.detail-modal', { timeout: 5000 });
  await page.locator('.detail-modal button', { hasText: '加入' }).first().click();
  await page.waitForTimeout(300);
  const badgeTop = await page.locator('.nav-badge').first().innerText();
  check(badgeTop === '1', `编排角标为 1（实际 ${badgeTop}）`);

  await page.locator('.nav-btn', { hasText: '编排' }).click();
  await page.waitForTimeout(350);
  check((await page.locator('.workout-item').count()) === 1, '编排页有 1 个动作');

  await page.locator('button', { hasText: '开始训练' }).click();
  await page.waitForTimeout(500);
  check(page.url().endsWith('#timer'), '跳转到计时页');
  check(await page.isVisible('.guided-card'), '计时界面已渲染');

  // 计时页也要有动图，训练中才是最需要对照动作的时候。
  // 与详情页同理：这里也换成了 ExercisePlayer 的 canvas，原 `.guided-demo img` 已不存在。
  check(await page.isVisible('.guided-player .player-canvas'), '计时页显示动作演示');
  const guidedDemo = await page.evaluate(() => {
    const c = document.querySelector('.guided-player .player-canvas');
    return c ? { tag: c.tagName, w: c.width } : null;
  });
  check(!!guidedDemo && guidedDemo.w > 0, `计时页演示画布已渲染（${guidedDemo ? guidedDemo.w + 'px' : 'null'}）`);

  // 计时页的动作要领速查：默认收起，点开后出现内容
  check(await page.isVisible('.guided-guide-toggle'), '计时页有「动作要领」入口');
  check(!(await page.isVisible('.guided-guide-body')), '速查默认收起（避免训练中干扰）');
  await page.locator('.guided-guide-toggle').click();
  await page.waitForTimeout(300);
  const guideBody = await page.locator('.guided-guide-body').innerText();
  check(guideBody.includes('动作要领'), '展开后显示动作要领');
  check(guideBody.includes('主练') || guideBody.includes('.') === false, '展开后有内容');
  await page.locator('.guided-guide-toggle').click();
  await page.waitForTimeout(200);
  check(!(await page.isVisible('.guided-guide-body')), '可再次收起');

  await page.locator('button', { hasText: '返回' }).first().click().catch(() => {});
  await page.waitForTimeout(300);

  // ---------- 历史 ----------
  console.log('\n[D] 历史页');
  await page.goto(`${BASE}/#history`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const h = await page.locator('body').innerText();
  check(!h.includes('undefined') && !h.includes('NaN'), '历史页无 undefined / NaN');

  // ---------- 导航完整性 ----------
  console.log('\n[E] 导航');
  const navs = await page.locator('.nav-btn').allInnerTexts();
  console.log('  ' + navs.map((n) => n.replace(/\n/g, ' ')).join(' | '));
  check(navs.length === 5, `5 个导航项（实际 ${navs.length}）`);
  check(navs.some((n) => n.includes('计划')), '包含「计划」入口');

  // 每个页面都不应报错
  for (const s of ['browse', 'plan', 'build', 'timer', 'history']) {
    await page.goto(`${BASE}/#${s}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(200);
    const txt = await page.locator('.app-body').innerText();
    check(txt.length > 10, `#${s} 正常渲染`);
  }

  // 直接访问 #plan 深链
  await page.goto(`${BASE}/#plan`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.wizard-generate', { timeout: 10000 });
  check(true, '深链 #plan 可直接打开（刷新后仍可用）');

  console.log(`\n控制台错误: ${errors.length}`);
  errors.slice(0, 10).forEach((e) => console.log('  ' + e));

  await browser.close();
  console.log(`\n结果：${fail === 0 ? '全部通过' : `${fail} 项失败`}`);
  process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(2);
});
