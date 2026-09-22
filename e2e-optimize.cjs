/**
 * 验证本轮产品优化：备份导出/导入、计时器时间戳、偏好持久化、
 * 类型化输入、截断存档、动作排序、收藏、弹窗焦点管理。
 * 只读检查 + 构造临时数据，不破坏用户真实数据（每次跑都先清 localStorage）。
 */
// 浏览器路径走 e2e-setup（跨平台），别硬编码绝对路径 —— 本地绿、CI 红的元凶。
const { chromium, executablePath: EXE } = require('./e2e-setup.cjs');
const BASE = process.env.BASE || 'http://localhost:4199';

let fail = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fail++;
};

/**
 * 填好身高体重，让「生成计划」按钮可用。
 *
 * 清空 localStorage 后这两个输入是空的，而生成按钮的启用条件是
 * heightValid && weightValid && muscles.length > 0，
 * 默认值不走持久化 —— 不显式填的话按钮永远 disabled，后续 click 直接超时。
 */
async function fillPlanBody(page) {
  const inputs = page.locator('.wizard-input');
  if ((await inputs.count()) >= 2) {
    await inputs.nth(0).fill('170');
    await inputs.nth(1).fill('65');
    await page.waitForTimeout(200);
  }
}

/** 造一份历史记录 */
const mkSession = (daysAgo, name, slug = 'bench-press') => ({
  name,
  notes: '',
  startedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  completedAt: new Date(Date.now() - daysAgo * 86400000 + 3600000).toISOString(),
  exercises: [
    {
      slug,
      exercise: {
          id: 'e', slug, name: 'Barbell Bench Press', nameZh: '杠铃卧推',
          metric: 'reps', equipment: 'barbell', equipmentZh: '杠铃',
          bodyPart: 'chest', bodyPartZh: '胸部',
          target: 'pectorals', targetZh: '胸大肌',
          muscleGroup: 'triceps', muscleGroupZh: '肱三头肌',
          secondary: [{ en: 'triceps', zh: '肱三头肌' }],
          stretch: false, home: false,
          gif: null, thumb: null, steps: [], instructions: '',
        },
      sets: [
        { id: 'a', setNumber: 1, reps: 10, weight: 60, actualReps: 10, actualWeight: 62.5, completed: true },
        { id: 'b', setNumber: 2, reps: 10, weight: 60, completed: true },
      ],
    },
  ],
});

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({
    viewport: { width: 900, height: 1000 },
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));

  const reset = async (hash = '#history') => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/' + hash, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
  };

  // ================= A. 导出 / 导入 =================
  console.log('\n[A] 数据备份导出 / 导入');
  await reset('#history');
  // 空历史时也要有备份入口（用户可能想「先备份再练」）
  check(await page.isVisible('.backup-card'), '空历史下仍显示备份面板');
  check(await page.locator('.backup-actions button', { hasText: '导出备份' }).isDisabled(), '空历史时导出按钮禁用');

  // 灌 3 条记录
  await page.evaluate((sessions) => {
    localStorage.setItem('strong-trainer-data', JSON.stringify({ favorites: [], sessions }));
  }, [mkSession(0, '今天'), mkSession(1, '昨天'), mkSession(3, '3天前')]);
  // 数据已经写好，只需重新加载页面让组件读到它（不能再 clear）
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  check((await page.locator('.history-item').count()) === 3, '历史显示 3 条记录');

  // 真实下载一次，校验文件内容
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.backup-actions button', { hasText: '导出备份' }).click(),
  ]);
  const dlPath = await download.path();
  const fs = require('fs');
  const raw = fs.readFileSync(dlPath, 'utf8');
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { /* 下面断言会失败 */ }
  check(parsed && parsed.kind === 'strong-trainer-backup', '导出文件带格式标识');
  check(parsed && parsed.data.sessions.length === 3, '导出文件含 3 条记录');
  check(/strong-trainer-\d{4}-\d{2}-\d{2}\.json/.test(download.suggestedFilename()), `文件名带日期（${download.suggestedFilename()}）`);
  check(JSON.stringify(parsed).includes('62.5'), '导出保留了实际重量 actualWeight');

  // 导入：合并模式应跳过重复
  await page.locator(".backup-actions > button").filter({ hasText: '导入' }).first().click();
  await page.waitForTimeout(200);
  check(await page.isVisible('.backup-file'), '导入面板出现文件选择器');
  await page.locator('.backup-file').setInputFiles(dlPath);
  await page.waitForTimeout(300);
  check(await page.isVisible('.backup-alert.ok'), '显示导入预览（读到 N 条）');
  const previewText = await page.locator('.backup-alert.ok').innerText();
  check(previewText.includes('3'), `预览如实报出条数（${previewText.replace(/\n/g, ' ')}）`);
  await page.locator('button', { hasText: '合并导入' }).click();
  await page.waitForTimeout(400);
  const mergedText = await page.locator('.backup-alert').last().innerText();
  check(mergedText.includes('跳过 3'), `合并导入正确跳过重复（${mergedText.replace(/\n/g, ' ')}）`);
  check((await page.locator('.history-item').count()) === 3, '合并后条数仍为 3（未产生重复）');

  // 导入一份「新设备」备份：应真的合并进来
  const otherBackup = JSON.stringify({
    kind: 'strong-trainer-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { favorites: [], sessions: [mkSession(10, '十天前'), mkSession(20, '二十天前')] },
  });
  const tmpFile = require('path').join(process.cwd(), '.tmp-import-test.json');
  fs.writeFileSync(tmpFile, otherBackup);
  // 导入面板在上一步完成后仍保持打开（文件选择器常驻，方便连续导入）
  await page.locator('.backup-file').setInputFiles(tmpFile);
  await page.waitForTimeout(300);
  await page.locator('button', { hasText: '合并导入' }).click();
  await page.waitForTimeout(400);
  check((await page.locator('.history-item').count()) === 5, '跨设备合并后共 5 条');

  // 坏文件必须被拒绝且不破坏数据
  const badFile = require('path').join(process.cwd(), '.tmp-bad.json');
  fs.writeFileSync(badFile, '{ this is not json');
  await page.locator('.backup-file').setInputFiles(badFile);
  await page.waitForTimeout(300);
  const badText = await page.locator('.backup-alert').last().innerText();
  check(badText.includes('没有可识别') || badText.includes('不是有效'), `坏文件被拒绝（${badText.replace(/\n/g, ' ')}）`);
  check((await page.locator('.history-item').count()) === 5, '拒绝坏文件后数据完好');

  // ================= B. 计时器时间戳驱动 =================
  console.log('\n[B] 计时器：截止时间戳（抗后台节流）');
  await reset('#build');
  await page.evaluate(() => {
    localStorage.setItem('strong-trainer-draft-workout', JSON.stringify([{
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
      // 要 2 组：只勾 1 组时才进入休息，勾完最后一组会直接进结算态
      sets: [
        { id: 's1', setNumber: 1, reps: 10, weight: 60, completed: false },
        { id: 's2', setNumber: 2, reps: 10, weight: 60, completed: false },
      ],
    }]));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.locator('button', { hasText: '开始训练' }).click();
  await page.waitForSelector('.guided-card', { timeout: 10000 });
  check(await page.isVisible('.rest-preset-row'), '跟组计时界面正常');

  // 休息计时：勾一组后立刻看到倒计时，且是真在走
  await page.locator('button', { hasText: '完成这组' }).click();
  await page.waitForTimeout(300);
  check(await page.isVisible('.guided-phase.rest'), '勾完一组自动进入休息');
  const t1 = await page.locator('.guided-count').innerText();
  await page.waitForTimeout(2200);
  const t2 = await page.locator('.guided-count').innerText();
  check(t1 !== t2, `休息倒计时在走（${t1} → ${t2}）`);

  // 关键：模拟后台冻结 3 秒后恢复，剩余时间应按真实时间跳掉约 3 秒，而不是只减 1
  const beforeFreeze = await page.locator('.guided-count').innerText();
  await page.evaluate(() => {
    // 冻结主线程 3 秒，setInterval 完全无法执行——等价于后台被节流
    const end = Date.now() + 3000;
    while (Date.now() < end) { /* busy wait */ }
  });
  await page.waitForTimeout(400);
  const afterFreeze = await page.locator('.guided-count').innerText();
  const toSec = (s) => { const [m, x] = s.split(':').map(Number); return m * 60 + x; };
  const dropped = toSec(beforeFreeze) - toSec(afterFreeze);
  check(dropped >= 2 && dropped <= 5, `冻结 3 秒后剩余正确跳掉 ${dropped} 秒（旧实现只会减 0~1 秒）`);

  // ================= C. 休息偏好持久化 =================
  console.log('\n[C] 组间休息偏好持久化');
  await page.locator('.rest-preset-row .preset-btn', { hasText: '30s' }).click();
  await page.waitForTimeout(200);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const activePreset = await page.locator('.rest-preset-row .preset-btn.active').innerText();
  check(activePreset.trim() === '30s', `刷新后仍记得 30s（实际 ${activePreset.trim()}）`);

  // ================= D. 类型化输入 =================
  console.log('\n[D] 按动作类型渲染输入');
  const mkEx = (slug, name, type, eq) => ({
    slug,
    exercise: {
      // nameZh 必须逐个不同：界面优先显示中文名，
      // 全都填同一个占位名会让下移/上移的断言看不出任何变化
      id: 'e', slug, name, nameZh: `测试动作-${slug}`,
      metric: type, equipment: eq, equipmentZh: '测试器械',
      bodyPart: 'legs', bodyPartZh: '大腿',
      target: 'quads', targetZh: '股四头肌',
      muscleGroup: 'glutes', muscleGroupZh: '臀肌',
      secondary: [],
      stretch: false, home: false,
      gif: null, thumb: null, steps: [], instructions: '',
    },
    sets: [{ id: 's1', setNumber: 1, completed: false }],
  });
  await reset('#build');
  await page.evaluate((items) => {
    localStorage.setItem('strong-trainer-draft-workout', JSON.stringify(items));
  }, [
    // 新数据集只有三种计量方式：reps / duration / distance
    // equipment 必须用数据里的真实取值（全小写），'body weight' 才会被判定为无需 kg
    mkEx('running', 'Running', 'distance', 'cardio'),
    mkEx('plank', 'Plank', 'duration', 'body weight'),
    mkEx('bench-press', 'Bench Press', 'reps', 'barbell'),
    mkEx('push-up', 'Push-up', 'reps', 'body weight'),
  ]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const firstSetLabels = async (i) =>
    (await page.locator('.workout-item').nth(i).locator('.set-row').first().locator('.set-input-label').allInnerTexts()).join(',');

  check((await firstSetLabels(0)) === '秒,米', `跑步(距离类) 输入单位 = ${await firstSetLabels(0)}`);
  check((await firstSetLabels(1)) === '秒', `平板支撑(时长类) 输入单位 = ${await firstSetLabels(1)}`);
  check((await firstSetLabels(2)) === '次,kg', `卧推(负重类) 输入单位 = ${await firstSetLabels(2)}`);
  check((await firstSetLabels(3)) === '次', `俯卧撑(自重类) 输入单位 = ${await firstSetLabels(3)}（不应出现 kg）`);

  // 预估时长
  const sectionMeta = await page.locator('.section-row span').first().innerText();
  check(sectionMeta.includes('约'), `显示预估时长（${sectionMeta.replace(/\n/g, ' ')}）`);

  // ================= E. 动作排序 =================
  console.log('\n[E] 动作排序');
  const nameAt = async (i) => (await page.locator('.workout-item-name').nth(i).innerText()).split('\n')[0];
  const before0 = await nameAt(0);
  await page.locator('.workout-item').nth(0).locator('.workout-item-side button').nth(1).click(); // 下移
  await page.waitForTimeout(300);
  const after0 = await nameAt(0);
  check(before0 !== after0, `下移生效（首位 ${before0} → ${after0}）`);
  check(await page.locator('.workout-item').nth(0).locator('.workout-item-side button').nth(0).isDisabled(), '首位「上移」按钮禁用');
  check(await page.locator('.workout-item').nth(3).locator('.workout-item-side button').nth(1).isDisabled(), '末位「下移」按钮禁用');
  // 顺序要真的写进 localStorage，刷新后保持
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  check((await nameAt(0)) === after0, '排序结果刷新后保持');

  // ================= F. 收藏 =================
  console.log('\n[F] 收藏');
  await reset('#browse');
  check((await page.locator('.loc-tab').count()) === 3, '无收藏时不显示收藏页签');
  await page.locator('.exercise-card').first().hover();
  await page.waitForTimeout(200);
  await page.locator('.card-fav').first().click();
  await page.waitForTimeout(300);
  check(await page.locator('.card-fav.on').first().isVisible(), '星标点亮');
  check((await page.locator('.loc-tab').count()) === 4, '收藏后出现收藏页签');
  // 收藏要跨刷新保留
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  check((await page.locator('.card-fav.on').count()) === 1, '收藏刷新后保留');
  // 用收藏页签筛选
  await page.locator('.loc-tab', { hasText: '收藏' }).click();
  await page.waitForTimeout(300);
  check((await page.locator('.exercise-card').count()) === 1, '收藏页签只显示 1 个动作');
  // 动作库的计数在 .browse-head 里（.section-row 是编排/历史页的布局）
  check(
    (await page.locator('.browse-head .page-count').innerText()).includes('1'),
    '计数显示 1 个动作',
  );
  await page.locator('.loc-tab', { hasText: '收藏' }).click();
  await page.waitForTimeout(250);
  check((await page.locator('.exercise-card').count()) > 1, '取消收藏筛选后恢复全部');

  // 详情弹窗里也要能收藏
  await page.locator('.exercise-card').nth(2).click();
  await page.waitForTimeout(400);
  check(await page.isVisible('.detail-head-actions .icon-btn.fav-on') === false, '未收藏动作的弹窗星标未点亮');
  await page.locator('.detail-head-actions .icon-btn').first().click();
  await page.waitForTimeout(250);
  check(await page.isVisible('.detail-head-actions .icon-btn.fav-on'), '弹窗内可收藏');

  // ================= G. 弹窗焦点管理 =================
  console.log('\n[G] 弹窗焦点管理');
  const focusInfo = await page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el?.tagName, label: el?.getAttribute('aria-label') };
  });
  check(focusInfo.tag === 'BUTTON', `打开弹窗后焦点移入弹窗内（当前 ${focusInfo.tag}/${focusInfo.label}）`);
  // Tab 应被限制在弹窗内
  const trapped = await page.evaluate(() => {
    const modal = document.querySelector('.detail-modal');
    const sel = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
    return modal ? modal.querySelectorAll(sel).length : 0;
  });
  check(trapped > 0, `弹窗内可聚焦元素 ${trapped} 个`);
  // 连续 Tab 多次，焦点始终留在弹窗内
  let escaped = false;
  for (let i = 0; i < trapped + 3; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.activeElement?.closest('.detail-modal'));
    if (!inside) { escaped = true; break; }
  }
  check(!escaped, `连续 Tab ${trapped + 3} 次焦点未逃出弹窗`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(!(await page.locator('.detail-modal').isVisible().catch(() => false)), 'Esc 关闭弹窗');
  const restored = await page.evaluate(() => !!document.activeElement?.closest('.exercise-card'));
  check(restored, '关闭后焦点归还到触发的卡片');

  // ================= H. 截断存档 =================
  console.log('\n[H] 计划替换时截断存档');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.clear();
    // 有进行中的训练：3 组里完成 2 组
    localStorage.setItem('strong-trainer-active-session', JSON.stringify({
      name: '遗留训练', notes: '', startedAt: new Date().toISOString(),
      exercises: [{
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
          { id: 'a', setNumber: 1, reps: 10, weight: 60, completed: true },
          { id: 'b', setNumber: 2, reps: 10, weight: 60, completed: true },
          { id: 'c', setNumber: 3, reps: 10, weight: 60, completed: false },
        ],
      }],
    }));
    localStorage.setItem('strong-trainer-data', JSON.stringify({ favorites: [], sessions: [] }));
  });
  await page.goto(BASE + '/#plan', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await fillPlanBody(page);
  await page.locator('.muscle-chip-target').first().click();
  await page.waitForTimeout(200);
  await page.locator('button', { hasText: '生成计划' }).click();
  await page.waitForTimeout(400);
  await page.locator('button', { hasText: '用这份计划' }).click();
  await page.waitForTimeout(500);
  check(await page.isVisible('.modal-card'), '有进行中训练时弹出确认');
  const modalText = await page.locator('.modal-sub-block').last().innerText();
  check(modalText.includes('2 组') && modalText.includes('存入历史'), `文案如实说明会存 2 组（${modalText.replace(/\n/g, ' ')}）`);
  await page.locator('button', { hasText: '仍要替换' }).click();
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('strong-trainer-data') || '{}'));
  check(saved.sessions?.length === 1, `截断存档写入了 ${saved.sessions?.length} 条记录`);
  const keptSets =
    saved.sessions?.[0]?.exercises?.reduce((n, w) => n + w.sets.length, 0) ?? 0;
  check(keptSets === 2, `只保存已完成的 2 组（实际 ${keptSets} 组）`);
  check(/中途结束/.test(saved.sessions?.[0]?.name ?? ''), `名称标注了中途结束（${saved.sessions?.[0]?.name}）`);

  // 一组都没完成时不应产生空记录
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('strong-trainer-active-session', JSON.stringify({
      name: '空训练', notes: '', startedAt: new Date().toISOString(),
      exercises: [{
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
        sets: [{ id: 'a', setNumber: 1, completed: false }],
      }],
    }));
    localStorage.setItem('strong-trainer-data', JSON.stringify({ favorites: [], sessions: [] }));
  });
  await page.goto(BASE + '/#plan', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await fillPlanBody(page);
  await page.locator('.muscle-chip-target').first().click();
  await page.waitForTimeout(200);
  await page.locator('button', { hasText: '生成计划' }).click();
  await page.waitForTimeout(400);
  await page.locator('button', { hasText: '用这份计划' }).click();
  await page.waitForTimeout(500);
  const zeroText = await page.locator('.modal-sub-block').last().innerText();
  check(zeroText.includes('没有完成'), `零完成时文案不同（${zeroText.replace(/\n/g, ' ')}）`);
  await page.locator('button', { hasText: '仍要替换' }).click();
  await page.waitForTimeout(500);
  const saved2 = await page.evaluate(() => JSON.parse(localStorage.getItem('strong-trainer-data') || '{}'));
  check((saved2.sessions?.length ?? 0) === 0, '零完成时不产生空记录');

  // ================= I. 计时页实际表现记录 =================
  console.log('\n[I] 计时页记录实际表现');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('strong-trainer-draft-workout', JSON.stringify([{
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
      sets: [{ id: 's1', setNumber: 1, reps: 10, weight: 60, completed: false }],
    }]));
    // 上次练过：65kg × 8，用于验证「上次」提示
    localStorage.setItem('strong-trainer-data', JSON.stringify({
      favorites: [],
      sessions: [{
        name: '上次', notes: '', startedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        completedAt: new Date().toISOString(),
        exercises: [{
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
          sets: [{ id: 'a', setNumber: 1, reps: 8, weight: 65, completed: true }],
        }],
      }],
    }));
  });
  await page.goto(BASE + '/#build', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  check(await page.isVisible('.workout-item-last'), '编排页显示「上次」提示');
  const lastText = await page.locator('.workout-item-last').innerText();
  check(lastText.includes('65') && lastText.includes('8'), `上次数值正确（${lastText}）`);

  await page.locator('button', { hasText: '开始训练' }).click();
  await page.waitForSelector('.guided-card', { timeout: 10000 });
  check(await page.isVisible('.guided-last'), '计时页显示「上次」提示');
  check(await page.isVisible('.guided-actual'), '计时页有「实际完成」输入区');
  const actualInputs = await page.locator('.guided-actual input').count();
  check(actualInputs === 2, `实际完成有 2 个输入框（次 / kg），实际 ${actualInputs}`);

  // 填实际值 → 结束训练 → 历史里应保留实际值
  await page.locator('.guided-actual input').first().fill('7');
  await page.locator('.guided-actual input').nth(1).fill('70');
  await page.waitForTimeout(300);
  await page.locator('button', { hasText: '完成这组' }).click();
  await page.waitForTimeout(400);
  await page.locator('.set-chip').first().click(); // 确保完成
  await page.waitForTimeout(400);
  const finishVisible = await page.isVisible('.finish-card').catch(() => false);
  if (!finishVisible) {
    // 若还有未完成组，直接通过「结束训练」按钮兜底：先勾完
    const chips = await page.locator('.set-chip').count();
    for (let i = 0; i < chips; i++) {
      const cls = await page.locator('.set-chip').nth(i).getAttribute('class');
      if (!cls?.includes('done')) {
        await page.locator('.set-chip').nth(i).click();
        await page.waitForTimeout(250);
      }
    }
  }
  await page.waitForTimeout(400);
  if (await page.isVisible('.finish-card').catch(() => false)) {
    await page.locator('button', { hasText: '结束训练' }).click();
    await page.waitForTimeout(600);
  }
  const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('strong-trainer-data') || '{}'));
  const rec = hist.sessions?.find((s) => s.name !== '上次');
  const st = rec?.exercises?.[0]?.sets?.[0];
  check(st?.actualReps === 7, `历史留存实际次数 7（实际 ${st?.actualReps}）`);
  check(st?.actualWeight === 70, `历史留存实际重量 70（实际 ${st?.actualWeight}）`);

  // 历史页要能看出这是实际值
  await page.goto(BASE + '/#history', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.locator('.history-header').first().click();
  await page.waitForTimeout(300);
  const detailText = await page.locator('.history-detail').first().innerText();
  check(detailText.includes('70kg') && detailText.includes('7 次'), `历史详情显示实际值（${detailText.split('\n')[0]}）`);

  // ================= I2. 不写空值 =================
  // 过去 usePersistentState 无条件 setItem，而同文档导航会重跑 effect，
  // 于是「没有进行中的训练」会和「值为 null」混为一谈（键存在但内容是字符串 "null"）。
  console.log('\n[I2] 空值不落盘');
  const SESSION_KEY = 'strong-trainer-active-session';
  await page.evaluate((k) => localStorage.removeItem(k), SESSION_KEY);
  await page.goto(BASE + '/#timer', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.goto(BASE + '/#build', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const phantom = await page.evaluate(
    (k) => Object.keys(localStorage).includes(k) && localStorage.getItem(k) === 'null',
    SESSION_KEY,
  );
  check(!phantom, '没有值的键不被写成字符串 "null"');

  // ================= J. 控制台干净 =================
  console.log('\n[J] 控制台');
  check(errors.length === 0, errors.length === 0 ? '无控制台错误' : `有 ${errors.length} 条错误:\n${errors.join('\n')}`);

  console.log(`\n===== 合计 ${fail === 0 ? '全部通过' : fail + ' 项失败'} =====\n`);
  try { fs.unlinkSync(tmpFile); fs.unlinkSync(badFile); } catch { /* 忽略 */ }
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
