/* ============================================================
 * 墨记 Mojot · Markdown 渲染引擎
 * 零依赖、自带 XSS 防护：先转义 HTML，再识别 Markdown 语法；
 * 不执行任何原始 HTML，链接/图片 URL 走白名单协议校验。
 *
 * 每个块级元素（含 li / tr / 引用内块）都带 data-line-start /
 * data-line-end（0-based 源码行号），供编辑器把「预览区选中的
 * 渲染文本」反向映射回源码选区，实现所见即所得地改代码。
 *
 * 对外接口：window.MojotMarkdown.render(src, opts) -> HTML 字符串
 *          window.MojotMarkdown.escapeHtml(s)
 *          window.MojotMarkdown.flattenLine(line) -> {plain, map}
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

  function unescapeHtml(s) {
    return String(s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  /* 只允许安全协议；其余一律降级为 '#'，杜绝 javascript: / vbscript: 等 */
  function safeUrl(raw, isImage) {
    var url = String(raw || '').trim().replace(/[\u0000-\u001f\u007f]/g, '');
    url = url.replace(/^['"]|['"]$/g, '');
    var lower = url.toLowerCase();
    if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/|\?)/.test(lower)) return url;
    if (isImage && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(url)) return url;
    if (!/:/.test(url) && url.length && !/^\/\//.test(url)) return url;
    return '#';
  }

  /* 给块级 HTML 的第一个开始标签注入源码行号（不改变标签结构与样式） */
  function withLines(html, start, end) {
    return String(html).replace(/^<([A-Za-z][A-Za-z0-9]*)([^>]*)>/, function (_, tag, rest) {
      return '<' + tag + ' data-line-start="' + start + '" data-line-end="' + end + '"' + rest + '>';
    });
  }

  /* ------------------------------------------------------------
   * flattenLine：把一行 Markdown 源码「摊平」成可搜索的纯文本，
   * 同时保留每个纯文本字符在源码行内的原始下标，用于反向映射。
   * 例：`**粗体** 和 [链接](url)` → plain `粗体 和 链接`
   * ------------------------------------------------------------ */
  function flattenLine(line) {
    var s = String(line == null ? '' : line);
    var plain = '';
    var map = [];
    var i = 0;

    function keep(from, to) {
      for (var k = from; k < to; k++) { plain += s[k]; map.push(k); }
    }
    function skip(to) { i = to; }

    // 行首块前缀：标题 / 引用 / 列表 / 任务框
    var prefix = s.match(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+(?:\[[ xX]\]\s+)?)/);
    if (prefix) skip(prefix[0].length);
    // 行尾可选闭合 # 号
    var closingHashes = /\s+#+\s*$/.test(s) ? s.match(/\s+#+\s*$/)[0] : '';

    var endLimit = s.length - closingHashes.length;

    while (i < endLimit) {
      var c = s[i];

      // 图片 ![alt](url)：整段跳过（预览里是图片，无可选文本）
      if (c === '!' && s[i + 1] === '[') {
        var imgM = s.slice(i).match(/^!\[[^\]]*\]\([^)]*\)/);
        if (imgM) { skip(i + imgM[0].length); continue; }
      }
      // 链接 [label](url)：只保留 label 的可读文本及其原始位置
      if (c === '[') {
        var linkM = s.slice(i).match(/^\[([^\]]+)\]\([^)]*\)/);
        if (linkM) { keep(i + 1, i + 1 + linkM[1].length); skip(i + linkM[0].length); continue; }
      }
      // 成对强调标记 ** / __ / ~~ / 单个 * _ ` ~
      if (c === '*' || c === '_' || c === '~' || c === '`') {
        var run = 1;
        while (i + run < endLimit && s[i + run] === c) run++;
        skip(i + run);
        continue;
      }
      // 其余字符按原样保留
      plain += c; map.push(i); i++;
    }

    return { plain: plain, map: map };
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

    /* 4~6) 强调：CommonMark 要求闭合标记左侧不能是空白。
       这里做「宽容渲染」：若作者写了 `**文本 **` 或 `*文本 *`，
       把闭合侧空白移到标签外面，使格式仍能正确触发。
       开头仍要求紧跟非空白，避免把 `2 * 3 * 4` 误判为强调。   */
    text = text.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)(\s*)\1/g,
      function (_, m, body, trail) { return '<strong>' + body + '</strong>' + trail; });
    text = text.replace(/~~(?=\S)([\s\S]*?\S)(\s*)~~/g,
      function (_, body, trail) { return '<del>' + body + '</del>' + trail; });
    text = text.replace(/(^|[^*])\*(?=\S)([^*\n]*?\S)(\s*)\*(?!\*)/g,
      function (_, pre, body, trail) { return pre + '<em>' + body + '</em>' + trail; });
    text = text.replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)(\s*)_(?!_)(?![A-Za-z0-9])/g,
      function (_, pre, body, trail) { return pre + '<em>' + body + '</em>' + trail; });

    // 7) 恢复行内代码占位符
    text = text.replace(/\u0000MOJOTc(\d+)\u0000/gi, function (_, i) { return codes[+i] || ''; });
    text = text.replace(/\u0000MOJOTC(\d+)\u0000/g, function (_, i) { return codes[+i] || ''; });

    return text;
  }

  function softBreaks(html) { return html.replace(/\n/g, '<br />'); }

  /* ---------- 块级渲染 ---------- */
  function render(src, opts) {
    opts = opts || {};
    var offset = opts.lineOffset || 0; // 引用块内递归时传入绝对行号偏移
    var lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var i = 0;
    var n = lines.length;
    var abs = function (k) { return k + offset; };

    function isBlank(s) { return !s.trim(); }

    while (i < n) {
      var line = lines[i];

      if (isBlank(line)) { i++; continue; }

      // 围栏代码块 ``` / ~~~（带语言标签）
      var fence = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_+\-.#]*)\s*$/);
      if (fence) {
        var fenceStart = i;
        var marker = fence[1][0];
        var lang = fence[2] || '';
        var buf = [];
        i++;
        while (i < n && !new RegExp('^\\s{0,3}' + marker + '{3,}\\s*$').test(lines[i])) {
          buf.push(lines[i]); i++;
        }
        if (i < n) i++;
        var label = lang ? '<span class="code-lang">' + escapeHtml(lang) + '</span>' : '';
        out.push(withLines('<pre data-language="' + escapeHtml(lang) + '">' + label +
          '<code' + (lang ? ' class="language-' + escapeHtml(lang) + '"' : '') + '>' +
          escapeHtml(buf.join('\n')) + '\n</code></pre>', abs(fenceStart), abs(i - 1)));
        continue;
      }

      // ATX 标题
      var h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) {
        var lv = h[1].length;
        out.push(withLines('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>', abs(i), abs(i)));
        i++; continue;
      }

      // 分割线
      if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        out.push(withLines('<hr />', abs(i), abs(i))); i++; continue;
      }

      // 引用块：内部块用绝对行号重新渲染
      if (/^\s{0,3}>/.test(line)) {
        var qStart = i;
        var qbuf = [];
        while (i < n && /^\s{0,3}>/.test(lines[i])) {
          qbuf.push(lines[i].replace(/^\s{0,3}>\s?/, '')); i++;
        }
        var inner = render(qbuf.join('\n'), { lineOffset: abs(qStart) });
        out.push(withLines('<blockquote>' + inner + '</blockquote>', abs(qStart), abs(i - 1)));
        continue;
      }

      // 表格
      if (line.indexOf('|') !== -1 && i + 1 < n &&
          /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
        var tStart = i;
        var splitRow = function (row) {
          var t = row.trim().replace(/^\|/, '').replace(/\|$/, '');
          return t.split('|').map(function (c) { return c.trim(); });
        };
        var heads = splitRow(line);
        i += 2;
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
          rows.push({ cells: splitRow(lines[i]), line: abs(i), raw: lines[i] }); i++;
        }
        var th = heads.map(function (c, k) {
          var a = aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '';
          return '<th' + a + ' data-col="' + k + '">' + inline(c) + '</th>';
        }).join('');
        var tb = rows.map(function (r) {
          return withLines('<tr>' + heads.map(function (_, k) {
            var a = aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '';
            var cell = tableCellAt(r.raw, k);
            var start = cell.start + (cell.raw.length - cell.raw.replace(/^\s+/, '').length);
            return '<td' + a + ' data-col="' + k + '" data-col-start="' + start +
              '" data-cell-raw="' + escapeHtml(cell.raw) + '">' +
              inline(r.cells[k] || '') + '</td>';
          }).join('') + '</tr>', r.line, r.line);
        }).join('');
        out.push(withLines('<table><thead>' +
          withLines('<tr>', abs(tStart), abs(tStart)) + th + '</tr></thead><tbody>' + tb +
          '</tbody></table>', abs(tStart), abs(i - 1)));
        continue;
      }

      // 列表（无序 / 有序 / 任务）
      var listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (listMatch) {
        var lStart = i;
        var ordered = /\d/.test(listMatch[2]);
        var isTaskList = false;
        var items = [];
        while (i < n) {
          var m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (!m) {
            if (items.length && /^\s{2,}\S/.test(lines[i]) && !isBlank(lines[i])) {
              items[items.length - 1].text += '\n' + lines[i].trim(); i++; continue;
            }
            break;
          }
          if (/\d/.test(m[2]) !== ordered) break;
          var itemLine = abs(i);
          var content = m[3];
          var taskM = content.match(/^\[([ xX])\]\s+(.*)$/);
          if (taskM) {
            isTaskList = true;
            var checked = taskM[1].toLowerCase() === 'x';
            content = '<input type="checkbox" data-line="' + itemLine + '"' +
              (checked ? ' checked' : '') + ' disabled /> ' + inline(taskM[2]);
          } else {
            content = inline(softBreaks(content));
          }
          items.push({ text: content, line: itemLine });
          i++;
        }
        var tag = ordered ? 'ol' : 'ul';
        var cls = isTaskList ? ' class="task-list"' : '';
        var lis = items.map(function (it) {
          return withLines('<li>' + it.text + '</li>', it.line, it.line);
        }).join('');
        out.push(withLines('<' + tag + cls + '>' + lis + '</' + tag + '>', abs(lStart), abs(i - 1)));
        continue;
      }

      // 普通段落
      var pStart = i;
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
      out.push(withLines('<p>' + softBreaks(inline(para.join('\n'))) + '</p>',
        abs(pStart), abs(i - 1)));
    }

    return out.join('\n');
  }

  /* 定位源码表格行中第 col 个单元格。
     返回 { start: 单元格内容在整行中的起始下标, raw: 该单元格原始文本 }。
     例：'| 单元格甲 | 单元格乙 |' 且 col=0 → { start: 2, raw: ' 单元格甲 ' } */
  function tableCellAt(line, col) {
    var s = String(line);
    var trimmed = s.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
    var cells = trimmed.split('|');
    if (col >= cells.length) return { start: s.length, raw: '' };
    var base = s.indexOf(trimmed);
    if (base < 0) base = 0;
    for (var c = 0; c < col; c++) base += cells[c].length + 1;
    var raw = cells[col] || '';
    return { start: base, raw: raw };
  }

  global.MojotMarkdown = {
    render: render, inline: inline, escapeHtml: escapeHtml, unescapeHtml: unescapeHtml,
    safeUrl: safeUrl, flattenLine: flattenLine, withLines: withLines,
    tableCellAt: tableCellAt
  };
})(window);
