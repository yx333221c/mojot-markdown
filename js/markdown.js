/* ============================================================
 * 墨记 Mojot · Markdown 渲染引擎
 * 零依赖、自带 XSS 防护：先转义 HTML，再识别 Markdown 语法；
 * 不执行任何原始 HTML，链接/图片 URL 走白名单协议校验。
 * 对外接口：window.MojotMarkdown.render(src) -> HTML 字符串
 *          window.MojotMarkdown.escapeHtml(s)
 * ============================================================ */
(function (global) {
  'use strict';

  var PLACEHOLDER = '\u0000MOJOT';
  var PH_END = '\u0000';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* 只允许安全协议；其余一律降级为 '#'，杜绝 javascript: / vbscript: 等 */
  function safeUrl(raw, isImage) {
    var url = String(raw || '').trim().replace(/[\u0000-\u001f\u007f]/g, '');
    // 去掉首尾可能出现的引号残留
    url = url.replace(/^['"]|['"]$/g, '');
    var lower = url.toLowerCase();
    if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/|\?)/.test(lower)) return url;
    // 图片允许 base64 内联位图（仓库禁止二进制文件，便于纯文本分享）
    if (isImage && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(url)) return url;
    // 无协议的相对路径（不含冒号）也放行
    if (!/:/.test(url) && url.length && !/^\/\//.test(url)) return url;
    return '#';
  }

  /* ---------- 行内渲染 ---------- */
  function inline(src) {
    var text = escapeHtml(src);
    var codes = [];

    // 1) 保护行内代码 `...`（支持多反引号）
    text = text.replace(/(`+)([\s\S]*?)\1/g, function (_, ticks, body) {
      var i = codes.push('<code>' + body.replace(/^ | $/g, '') + '</code>') - 1;
      return PLACEHOLDER + 'C' + i + PH_END;
    });

    // 2) 图片 ![alt](url "title")
    text = text.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+&quot;([^&]*?)&quot;)?\s*\)/g,
      function (_, alt, url, title) {
        return '<img src="' + safeUrl(url, true) + '" alt="' + alt + '"' +
          (title ? ' title="' + title + '"' : '') + ' loading="lazy" />';
      });

    // 3) 链接 [text](url "title")
    text = text.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+&quot;([^&]*?)&quot;)?\s*\)/g,
      function (_, label, url, title) {
        return '<a href="' + safeUrl(url, false) + '" target="_blank" rel="noopener noreferrer"' +
          (title ? ' title="' + title + '"' : '') + '>' + label + '</a>';
      });

    // 4) 粗体 **x** / __x__
    text = text.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
    // 5) 删除线 ~~x~~
    text = text.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
    // 6) 斜体 *x* / _x_（避免与 ** 冲突：先处理再加占位保护）
    text = text.replace(/(^|[^*])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1<em>$2</em>');
    text = text.replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?!_)(?![A-Za-z0-9])/g, '$1<em>$2</em>');

    // 7) 恢复行内代码占位符
    text = text.replace(/\u0000MOJOTc(\d+)\u0000/gi, function (_, i) { return codes[+i] || ''; });
    // 兼容大写 C
    text = text.replace(/\u0000MOJOTC(\d+)\u0000/g, function (_, i) { return codes[+i] || ''; });

    return text;
  }

  /* 把段落里的软换行变成 <br> */
  function softBreaks(html) {
    return html.replace(/\n/g, '<br />');
  }

  /* ---------- 块级渲染 ---------- */
  function render(src) {
    var lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var i = 0;
    var n = lines.length;

    function isBlank(s) { return !s.trim(); }

    while (i < n) {
      var line = lines[i];

      // 空行
      if (isBlank(line)) { i++; continue; }

      // 围栏代码块 ``` / ~~~
      var fence = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_+\-.#]*)\s*$/);
      if (fence) {
        var marker = fence[1][0];
        var lang = fence[2] || '';
        var buf = [];
        i++;
        while (i < n && !new RegExp('^\\s{0,3}' + marker + '{3,}\\s*$').test(lines[i])) {
          buf.push(lines[i]); i++;
        }
        i++; // 跳过收尾围栏（若存在）
        out.push('<pre><code' + (lang ? ' class="language-' + escapeHtml(lang) + '"' : '') + '>' +
          escapeHtml(buf.join('\n')) + '\n</code></pre>');
        continue;
      }

      // ATX 标题 # ~ ######
      var h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) {
        var lv = h[1].length;
        out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
        i++; continue;
      }

      // 分割线
      if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        out.push('<hr />'); i++; continue;
      }

      // 引用块（连续 > 行，支持嵌套一层）
      if (/^\s{0,3}>/.test(line)) {
        var qbuf = [];
        while (i < n && /^\s{0,3}>/.test(lines[i])) {
          qbuf.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++;
        }
        out.push('<blockquote>' + render(qbuf.join('\n')) + '</blockquote>');
        continue;
      }

      // 表格：表头 + 分隔行
      if (line.indexOf('|') !== -1 && i + 1 < n &&
          /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
        var splitRow = function (row) {
          var t = row.trim().replace(/^\|/, '').replace(/\|$/, '');
          return t.split('|').map(function (c) { return c.trim(); });
        };
        var heads = splitRow(line);
        i += 2; // 跳过表头与分隔行
        var aligns = lines[i - 1].trim().replace(/^\|/, '').replace(/\|$/, '')
          .split('|').map(function (c) {
            c = c.trim();
            if (/^:-+:$/.test(c)) return 'center';
            if (/^-+:$/.test(c)) return 'right';
            if (/^:-+$/.test(c)) return 'left';
            return '';
          });
        var rows = [];
        while (i < n && !isBlank(lines[i]) && lines[i].indexOf('|') !== -1) {
          rows.push(splitRow(lines[i])); i++;
        }
        var th = heads.map(function (c, k) {
          var a = aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '';
          return '<th' + a + '>' + inline(c) + '</th>';
        }).join('');
        var tb = rows.map(function (r) {
          return '<tr>' + heads.map(function (_, k) {
            var a = aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '';
            return '<td' + a + '>' + inline(r[k] || '') + '</td>';
          }).join('') + '</tr>';
        }).join('');
        out.push('<table><thead><tr>' + th + '</tr></thead><tbody>' + tb + '</tbody></table>');
        continue;
      }

      // 列表（无序 / 有序 / 任务），含一层嵌套支持
      var listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (listMatch) {
        var ordered = /\d/.test(listMatch[2]);
        var isTaskList = false;
        var items = [];
        while (i < n) {
          var m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (!m) {
            // 允许列表项之后的续行（缩进）并入上一项
            if (items.length && /^\s{2,}\S/.test(lines[i]) && !isBlank(lines[i])) {
              items[items.length - 1] += '\n' + lines[i].trim(); i++; continue;
            }
            break;
          }
          if (/\d/.test(m[2]) !== ordered) break; // 类型切换则结束当前列表
          var content = m[3];
          var taskM = content.match(/^\[([ xX])\]\s+(.*)$/);
          if (taskM) {
            isTaskList = true;
            var checked = taskM[1].toLowerCase() === 'x';
            content = '<input type="checkbox" data-line="' + i + '"' +
              (checked ? ' checked' : '') + ' disabled /> ' + inline(taskM[2]);
          } else {
            content = inline(softBreaks(content));
          }
          items.push(content);
          i++;
        }
        var tag = ordered ? 'ol' : 'ul';
        var cls = isTaskList ? ' class="task-list"' : '';
        out.push('<' + tag + cls + '>' + items.map(function (it) {
          return '<li>' + it + '</li>';
        }).join('') + '</' + tag + '>');
        continue;
      }

      // 普通段落：收集连续非空、且不是其它块起始的行
      var para = [];
      while (i < n && !isBlank(lines[i])) {
        var l = lines[i];
        if (para.length && (
          /^\s{0,3}(#{1,6})\s/.test(l) ||
          /^\s{0,3}(`{3,}|~{3,})/.test(l) ||
          /^\s{0,3}>/.test(l) ||
          /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l) ||
          /^(\s*)([-*+]|\d+[.)])\s+/.test(l)
        )) break;
        para.push(l); i++;
      }
      if (!para.length) { para.push(lines[i]); i++; }
      out.push('<p>' + softBreaks(inline(para.join('\n'))) + '</p>');
    }

    return out.join('\n');
  }

  global.MojotMarkdown = { render: render, inline: inline, escapeHtml: escapeHtml, safeUrl: safeUrl };
})(window);
