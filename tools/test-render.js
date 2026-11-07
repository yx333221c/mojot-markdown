/* 渲染引擎单元验证（本地开发用，不参与网页运行） */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'markdown.js'), 'utf8'), sandbox);
const MD = sandbox.window.MojotMarkdown;

let pass = 0, fail = 0;
function check(name, src, expect) {
  const out = MD.render(src);
  const ok = expect(out);
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '\n        got: ' + out.slice(0, 300)); }
}
function checkFn(name, fn) {
  let ok = false, extra = '';
  try { ok = fn(); } catch (e) { extra = e.message; }
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '  [' + extra + ']'); }
}

/* ---------- 基础渲染 ---------- */
check('标题', '# Hello', o => o.includes('<h1') && o.includes('>Hello</h1>'));
check('粗体 / 斜体 / 删除线', '**B** *I* ~~S~~', o =>
  o.includes('<strong>B</strong>') && o.includes('<em>I</em>') && o.includes('<del>S</del>'));
check('行内代码', 'a `x` b', o => o.includes('<code>x</code>'));
check('链接与目标', '[t](https://a.com)', o =>
  o.includes('href="https://a.com"') && o.includes('rel="noopener noreferrer"') && o.includes('>t</a>'));
check('图片 data URI 放行', '![p](data:image/png;base64,iVBORw0KGgo=)', o =>
  o.includes('<img src="data:image/png'));
check('围栏代码块转义', '```js\n<script>\n```', o =>
  o.includes('<pre') && o.includes('&lt;script&gt;'));
check('无序列表', '- a\n- b', o => o.includes('<ul') && (o.match(/<li /g) || []).length === 2);
check('有序列表', '1. a\n2. b', o => o.includes('<ol'));
check('任务列表', '- [x] done', o => o.includes('type="checkbox"') && o.includes('checked'));
check('引用块', '> quote', o => o.includes('<blockquote') && o.includes('quote'));
check('表格', '| A | B |\n| --- | --- |\n| 1 | 2 |', o =>
  o.includes('<table') && o.includes('<th') && o.includes('>A</th>') && o.includes('>1</td>'));
check('分割线', '---', o => o.includes('<hr'));
check('段落软换行', 'a\nb', o => o.includes('a<br />b'));
check('空输入', '', o => o === '');

/* ---------- XSS 防护 ---------- */
check('XSS: javascript: 链接被拦截', '[x](javascript:alert(1))', o =>
  !o.includes('javascript:') && o.includes('href="#"'));
check('XSS: 原始 HTML 被转义', '<script>alert(1)</script>', o =>
  !o.includes('<script>') && o.includes('&lt;script&gt;'));
check('XSS: 图片 onerror 被转义', '<img src=x onerror=alert(1)>', o =>
  !o.includes('<img src=x') && o.includes('&lt;img'));
check('XSS: 大写协议也被拦截', '[x](JaVaScRiPt:alert(1))', o => !/javascript:/i.test(o));

/* ---------- 反馈 2：闭合标记前有空格也要能渲染 ---------- */
check('闭合粗体前有空格：仍渲染粗体', '**文本 ** 后文', o =>
  o.includes('<strong>文本</strong>') && o.includes(' 后文'));
check('闭合斜体前有空格：仍渲染斜体', '*文本 * 后文', o =>
  o.includes('<em>文本</em>') && o.includes(' 后文'));
check('闭合删除线前有空格：仍渲染删除线', '~~文本 ~~ 后文', o =>
  o.includes('<del>文本</del>') && o.includes(' 后文'));
check('闭合标记前无空格：行为不变', '**文本** 后文', o =>
  o.includes('<strong>文本</strong>') && o.includes(' 后文'));
check('开头标记后仍是空格：不误判为强调', '** 文本**', o =>
  !o.includes('<strong>文本</strong>') || o.includes('** 文本**'));

/* ---------- 反馈 3：围栏代码块显示语言标签 ---------- */
check('代码块语言标签 js', '```js\nlet a = 1;\n```', o =>
  o.includes('class="code-lang">js</span>') && o.includes('data-language="js"'));
check('代码块语言标签 python', '```python\nprint(1)\n```', o =>
  o.includes('class="code-lang">python</span>'));
check('无语言时不显示标签', '```\nplain\n```', o =>
  !o.includes('class="code-lang"') && o.includes('data-language=""'));
check('代码语言经转义防注入', '```js" onmouseover="x\ncode\n```', o =>
  !/onmouseover="x"/.test(o.replace(/&quot;/g, '')) || o.includes('&quot;'));

/* ---------- 反馈 4：引用块默认正体（斜体由 CSS 决定，HTML 不含 em） ---------- */
check('引用块默认不带 em 标签', '> 普通引用文本', o =>
  o.includes('<blockquote') && !o.includes('<em>'));
check('引用块显式斜体才生成 em', '> 这里 *是斜体*', o =>
  o.includes('<blockquote') && o.includes('<em>是斜体</em>'));

/* ---------- 反馈 1：源码行映射（预览选区反向定位的基础） ---------- */
check('每个块级元素带 data-line-start', '# A\n\nB\n\n- c\n- d', o => {
  const tags = o.match(/data-line-start="(\d+)"/g) || [];
  return tags.length >= 4 && /<h1 data-line-start="0"/.test(o) && /<p data-line-start="2"/.test(o);
});
check('列表项各自带正确行号', '- c\n- d', o =>
  /<li data-line-start="0"/.test(o) && /<li data-line-start="1"/.test(o));
check('表格数据行带行号', '| A | B |\n| --- | --- |\n| 1 | 2 |', o =>
  /<tr data-line-start="2"/.test(o));
check('引用块内块用绝对行号', '# T\n\n> 引用', o =>
  /<p data-line-start="2"/.test(o));
check('代码块行号覆盖围栏首尾', '```js\na\n```', o =>
  /<pre[^>]*data-line-start="0"[^>]*data-line-end="2"[^>]*data-language="js"/.test(o));

/* ---------- flattenLine 摊平映射 ---------- */
checkFn('flattenLine: 粗体标记被剔除并保留字符位置', () => {
  const f = MD.flattenLine('**粗体** 和 [链接](https://a)');
  return f.plain === '粗体 和 链接' && f.map.length === f.plain.length &&
         f.map.every((v, i) => typeof v === 'number' && v >= 0);
});
checkFn('flattenLine: 标题/列表前缀被剔除', () => {
  return MD.flattenLine('# 标题').plain === '标题' &&
         MD.flattenLine('- [x] 任务').plain === '任务';
});
checkFn('flattenLine: 反引号代码内容保留', () => {
  return MD.flattenLine('用 `code` 表示').plain === '用 code 表示';
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
