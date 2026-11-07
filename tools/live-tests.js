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

  // ===== 第三轮反馈 =====
  const has4star = (s) => /\*{4}/.test(s);

  // 反馈1：源码含 **** 时全选加粗，不产生四星、不吞后续正文
  src.value = '****Markdown 源码****，右侧实**';
  src.dispatchEvent(new Event('input', { bubbles: true }));
  src.focus(); src.setSelectionRange(0, src.value.length);
  document.querySelector('.toolbar [data-fmt="bold"]').click();
  checks['三轮1：源码含****全选加粗无四星'] = !has4star(src.value) && src.value.includes('右侧实');

  // 预览区连点三次加粗，星号不增长
  src.value = '线上连点测试，后面还有内容。';
  src.dispatchEvent(new Event('input', { bubbles: true }));
  for (let i = 0; i < 3; i++) {
    const tgt = prev.querySelector('strong') ? prev.querySelector('strong').firstChild : prev.querySelector('p').firstChild;
    const rr = document.createRange(); rr.setStart(tgt, 0); rr.setEnd(tgt, tgt.nodeValue.length);
    ds.removeAllRanges(); ds.addRange(rr);
    prev.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.querySelector('.bubble [data-fmt="bold"]').click();
  }
  checks['三轮1：预览连点三次星号不增长'] = !has4star(src.value) && src.value.includes('后面还有内容');
  ds.removeAllRanges();

  // 粗斜体混合：去粗体保留斜体
  src.value = '***文本***后续';
  src.dispatchEvent(new Event('input', { bubbles: true }));
  const emL = prev.querySelector('em');
  if (emL && emL.firstChild) {
    const rr = document.createRange(); rr.setStart(emL.firstChild, 0); rr.setEnd(emL.firstChild, emL.firstChild.nodeValue.length);
    ds.removeAllRanges(); ds.addRange(rr);
    prev.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.querySelector('.bubble [data-fmt="bold"]').click();
    checks['三轮1：***文本*** 去粗体保留斜体'] = /^\*文本\*后续/.test(src.value);
    ds.removeAllRanges();
  } else {
    checks['三轮1：***文本*** 去粗体保留斜体'] = false;
  }

  // 反馈2：版本号硬编码 2.0.0
  const vEl = document.querySelector('#appVersion');
  checks['三轮2：版本号硬编码（2.0.x）'] = !!vEl && /^v2\.0\.\d+$/.test(vEl.textContent.trim());

  // 反馈3：页面不再有任何二进制资源引用（图片/字体都由 CSS 变量或系统字体提供）
  const bins = Array.from(document.querySelectorAll('img[src], link[rel="stylesheet"], script[src]'))
    .map(e => e.getAttribute('src') || e.getAttribute('href'))
    .filter(Boolean)
    .filter(u => /\.(exe|png|jpg|jpeg|gif|zip|woff2?|ttf|otf|pdf)$/i.test(u));
  checks['三轮3：页面不引用任何仓库二进制资源'] = bins.length === 0;

  // 恢复干净文档
  src.value = '# 墨记 Mojot\n\n线上版本运行正常。';
  src.dispatchEvent(new Event('input', { bubbles: true }));
  return checks;
})()
