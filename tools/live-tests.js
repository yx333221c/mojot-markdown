/* 在 GitHub Pages 线上页面上下文中执行的测试体（IIFE 表达式） */
(function () {
  const src = document.querySelector('#source');
  const prev = document.querySelector('#previewBody');
  const initialDoc = src.value;
  const checks = {
    'H1 渲染': !!prev.querySelector('h1'),
    '表格渲染': !!prev.querySelector('table'),
    '代码块渲染': !!prev.querySelector('pre code'),
    '行号对齐': document.querySelectorAll('#gutter span').length === initialDoc.split('\n').length,
    'CSS 已加载': getComputedStyle(document.querySelector('.topbar')).backgroundColor !== 'rgba(0, 0, 0, 0)',
    '示例无协作光标': !initialDoc.includes('协作光标') && initialDoc.includes('本地自动保存')
  };

  // 一键加粗
  src.value = '线上加粗测试';
  src.dispatchEvent(new Event('input', { bubbles: true }));
  src.focus(); src.setSelectionRange(0, 4);
  document.querySelector('.toolbar [data-fmt="bold"]').click();
  checks['一键加粗'] = src.value === '**线上加粗**测试';
  checks['预览同步'] = !!prev.querySelector('strong');

  // 反馈 2：空格自动外移
  src.value = '  这段文本  ';
  src.dispatchEvent(new Event('input', { bubbles: true }));
  src.focus(); src.setSelectionRange(0, src.value.length);
  document.querySelector('.toolbar [data-fmt="bold"]').click();
  checks['空格自动外移'] = src.value === '  **这段文本**  ' && !!prev.querySelector('strong');

  // 反馈 3：代码块语言标签
  src.value = '```js\nlet a=1;\n```';
  src.dispatchEvent(new Event('input', { bubbles: true }));
  const lang = prev.querySelector('.code-lang');
  checks['代码语言标签'] = !!lang && lang.textContent === 'js' && getComputedStyle(lang).position === 'absolute';

  // 反馈 4：引用块正体
  src.value = '> 普通引用';
  src.dispatchEvent(new Event('input', { bubbles: true }));
  const bq = prev.querySelector('blockquote p');
  checks['引用默认正体'] = !!bq && getComputedStyle(bq).fontStyle === 'normal' && !bq.querySelector('em');

  // 反馈 1：预览区选渲染文本改格式
  src.value = '所见即所得的编辑器';
  src.dispatchEvent(new Event('input', { bubbles: true }));
  const p = prev.querySelector('p'), txt = p.firstChild;
  const rg = document.createRange(); rg.setStart(txt, 0); rg.setEnd(txt, 5);
  const ds = window.getSelection(); ds.removeAllRanges(); ds.addRange(rg);
  prev.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  checks['预览选区气泡'] = !document.querySelector('#bubble').hidden;
  document.querySelector('.bubble [data-fmt="bold"]').click();
  checks['选渲染文本改格式'] = src.value === '**所见即所得**的编辑器' && !!prev.querySelector('strong');
  ds.removeAllRanges();

  // 反馈 6：新引擎 API 可用
  checks['渲染引擎含行映射'] = typeof window.MojotMarkdown.tableCellAt === 'function';

  // ===== 第二轮反馈（线上验证） =====
  const lum = (rgb) => { const m = rgb.match(/\d+/g); return m ? (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) : null; };

  // 问题1：仅预览视图铺满
  src.value = '# 线上预览可见性\n\n正文用于验证预览模式。';
  src.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('.view-btn[data-view="preview"]').click();
  const paneP2 = document.querySelector('#panePreview');
  const h1p2 = prev.querySelector('h1');
  checks['问题1：预览视图铺满可见'] =
    getComputedStyle(paneP2).visibility === 'visible' &&
    paneP2.getBoundingClientRect().width > 1000 &&
    !!h1p2 && h1p2.getBoundingClientRect().width > 0;
  document.querySelector('.view-btn[data-view="split"]').click();

  // 问题2：浅色主题全局浅色
  if (document.documentElement.dataset.theme === 'dark') document.querySelector('#themeBtn').click();
  checks['问题2：浅色主题顶栏/工具栏/状态栏均浅色'] =
    lum(getComputedStyle(document.querySelector('.topbar')).backgroundColor) > 200 &&
    lum(getComputedStyle(document.querySelector('.toolbar')).backgroundColor) > 200 &&
    lum(getComputedStyle(document.querySelector('.statusbar')).backgroundColor) > 200;

  // 问题3：版本号非 1.0.0
  const ve = document.querySelector('#appVersion');
  checks['问题3：版本号已更新'] = !!ve && ve.textContent.trim() !== 'v1.0.0' && /\d+\.\d+\.\d+/.test(ve.textContent);

  // 问题6：预览重复加格式应取消
  src.value = '线上重复格式'; src.dispatchEvent(new Event('input', { bubbles: true }));
  const p6 = prev.querySelector('p'), t6 = p6.firstChild;
  let rg6 = document.createRange(); rg6.setStart(t6, 0); rg6.setEnd(t6, 6);
  ds.removeAllRanges(); ds.addRange(rg6);
  prev.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  document.querySelector('.bubble [data-fmt="bold"]').click();
  const once = src.value;
  const st6 = prev.querySelector('strong').firstChild;
  rg6 = document.createRange(); rg6.setStart(st6, 0); rg6.setEnd(st6, st6.nodeValue.length);
  ds.removeAllRanges(); ds.addRange(rg6);
  prev.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  document.querySelector('.bubble [data-fmt="bold"]').click();
  checks['问题6：重复加格式可取消'] = once === '**线上重复格式**' && src.value === '线上重复格式' && !src.value.includes('****');
  ds.removeAllRanges();

  // 问题7：粗体 + 斜体组合
  src.value = '线上组合'; src.dispatchEvent(new Event('input', { bubbles: true }));
  src.focus(); src.setSelectionRange(0, 4);
  document.querySelector('.toolbar [data-fmt="bold"]').click();
  src.setSelectionRange(2, 6);
  document.querySelector('.toolbar [data-fmt="italic"]').click();
  checks['问题7：粗斜体组合不吞标记'] = src.value === '**_线上组合_**' && !!prev.querySelector('strong em');

  // 恢复干净文档
  src.value = '# 墨记 Mojot\n\n线上版本运行正常。';
  src.dispatchEvent(new Event('input', { bubbles: true }));
  return checks;
})()
