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

check('标题', '# Hello', o => o.includes('<h1>Hello</h1>'));
check('粗体 / 斜体 / 删除线', '**B** *I* ~~S~~', o =>
  o.includes('<strong>B</strong>') && o.includes('<em>I</em>') && o.includes('<del>S</del>'));
check('行内代码', 'a `x` b', o => o.includes('<code>x</code>'));
check('链接与目标', '[t](https://a.com)', o =>
  o.includes('href="https://a.com"') && o.includes('rel="noopener noreferrer"') && o.includes('>t</a>'));
check('XSS: javascript: 链接被拦截', '[x](javascript:alert(1))', o =>
  !o.includes('javascript:') && o.includes('href="#"'));
check('XSS: 原始 HTML 被转义', '<script>alert(1)</script>', o =>
  !o.includes('<script>') && o.includes('&lt;script&gt;'));
check('XSS: 图片 onerror 被转义', '<img src=x onerror=alert(1)>', o =>
  !o.includes('<img src=x') && o.includes('&lt;img'));
check('XSS: 大写协议也被拦截', '[x](JaVaScRiPt:alert(1))', o => !/javascript:/i.test(o));
check('图片 data URI 放行', '![p](data:image/png;base64,iVBORw0KGgo=)', o =>
  o.includes('<img src="data:image/png'));
check('围栏代码块转义', '```js\n<script>\n```', o =>
  o.includes('<pre><code') && o.includes('&lt;script&gt;'));
check('无序列表', '- a\n- b', o => o.includes('<ul>') && (o.match(/<li>/g) || []).length === 2);
check('有序列表', '1. a\n2. b', o => o.includes('<ol>'));
check('任务列表', '- [x] done', o => o.includes('type="checkbox"') && o.includes('checked'));
check('引用块', '> quote', o => o.includes('<blockquote>') && o.includes('quote'));
check('表格', '| A | B |\n| --- | --- |\n| 1 | 2 |', o =>
  o.includes('<table>') && o.includes('<th>A</th>') && o.includes('<td>1</td>'));
check('分割线', '---', o => o.trim() === '<hr />');
check('段落软换行', 'a\nb', o => o.includes('a<br />b'));
check('空输入', '', o => o === '');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
