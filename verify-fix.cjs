/** 验证修复：有进行中训练时应用新计划 → 必须弹确认，而不是静默替换 */
const { chromium } = require('playwright-core');
const EXE =
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe';
const BASE = 'http://localhost:5173';

const SESSION = {
  name: '遗留训练',
  notes: '',
  startedAt: new Date().toISOString(),
  exercises: [
    {
      slug: 'bench-press',
      exercise: {
        id: 'e', slug: 'bench-press', name: 'Bench Press', exerciseType: 'weight_reps',
        equipment: 'Barbell', primaryMuscle: 'Chest', secondaryMuscles: [], isStretch: false, frames: [],
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
  await page.locator('.muscle-chip', { hasText: '胸部' }).first().click();
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
  check(modalText.includes('不会'), '明确告知不会存入历史');

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
    (await page.evaluate(() => localStorage.getItem('strong-trainer-active-session'))) !== 'null',
    '进行中的训练仍保留',
  );

  // ---------- 4. 仍要替换 ----------
  console.log('\n[4] 点「仍要替换」→ 写入新计划并清掉旧训练');
  await page.locator('.wizard-apply').click();
  await page.waitForTimeout(300);
  await page.locator('.modal-card button', { hasText: '仍要替换' }).click();
  await page.waitForTimeout(400);
  check(page.url().endsWith('#build'), '跳转到编排页');
  const buildCount = await page.locator('.workout-item').count();
  console.log(`  编排页动作数: ${buildCount}`);
  check(buildCount > 0, '新计划已写入编排');
  check(
    (await page.evaluate(() => localStorage.getItem('strong-trainer-active-session'))) === 'null',
    '旧的进行中训练已清掉',
  );
  check((await page.locator('.nav-btn .nav-dot').count()) === 0, '计时小红点已消失');

  await goto('timer');
  console.log('  计时页空状态:', await page.isVisible('.empty-state'));

  // ---------- 5. 无进行中训练时不应弹窗 ----------
  console.log('\n[5] 没有进行中训练时 → 直接应用，不弹窗');
  await page.evaluate(() => localStorage.setItem('strong-trainer-draft-workout', '[]'));
  await goto('plan');
  await page.locator('.muscle-chip', { hasText: '背部' }).first().click();
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

  console.log(`\n控制台错误: ${errors.length}`);
  errors.slice(0, 5).forEach((e) => console.log('  ' + e));
  await browser.close();
  console.log(`\n结果：${fail === 0 ? '全部通过' : `${fail} 项失败`}`);
  process.exit(fail === 0 && errors.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
