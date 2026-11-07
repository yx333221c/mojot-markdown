# 墨记 Mojot

> 选中文本，一键加格式；左边写 Markdown，右边实时看结果。

**当前版本：v2.0.0（重构 2 · 修复 0 · 优化 0）**——版本号直接写在 [`js/app.js`](js/app.js) 的 `VERSION` 常量里，改一处即可，无需构建脚本。

一个**纯前端、零依赖、轻量本地**的双栏 Markdown 编辑器。无构建步骤、无后端、无账号、无网络请求，文档只保存在浏览器本地；直接用浏览器打开即可使用。Windows 桌面启动器以**源码**形式提供（[`desktop/launcher.c`](desktop/launcher.c)），按下方说明本地编译即可。

界面：浅色（默认）与深色两套完整主题，顶栏 / 工具栏 / 状态栏与纸面一起换肤，双栏为源码 + 预览。

## 功能

- **选中即格式化**：既可以选左侧源码，也可以**直接选右侧渲染后的文本**，工具栏或浮动气泡一键加 **粗体**、*斜体*、~~删除线~~、`行内代码`；再次点击可取消。加格式时会自动把选区首尾空格移到标记外，避免 Markdown 闭合标记左侧有空格导致渲染失败。支持快捷键 `Ctrl+B` / `Ctrl+I` / `Ctrl+K` / `Ctrl+\`` / `Ctrl+Shift+X`。
- **双栏实时预览**：左侧源码（真实 `textarea` + 行号 + 光标定位），右侧实时渲染，滚动同步；可在「仅编辑 / 分栏 / 仅预览」间切换，分栏宽度可拖动。
- **围栏代码块语言标签**：` ```js ` 会在预览代码块右上角显示 `js`。
- **完整工具条**：H1–H3 标题、链接、图片、引用块、代码块、有序/无序/任务列表、表格、分割线、撤销重做。
- **导出**：`.md` 源文件、独立 HTML、打印为 PDF、复制 Markdown 到剪贴板。
- **本地优先**：文档与偏好自动保存到 `localStorage`，无需账号。
- **深浅主题**、字数/阅读时长统计、响应式布局。
- **安全**：自研渲染引擎先转义再解析，禁止原始 HTML，链接/图片 URL 走协议白名单，防 XSS。

## 目录结构

| 文件 | 说明 |
| --- | --- |
| `index.html` | 页面结构 |
| `css/token.css` | 设计令牌（颜色 / 字体 / 圆角 / 深浅主题） |
| `css/style.css` | 界面样式 |
| `js/markdown.js` | Markdown 渲染引擎（零依赖，含 XSS 防护、源码行映射） |
| `js/app.js` | 编辑器交互逻辑（含预览选区 → 源码选区反向映射） |
| `LICENSE` | MIT 开源许可证 |
| `tools/serve.js` | 本地静态预览服务器（零依赖） |
| `tools/test-render.js` | 渲染引擎单元测试 |
| `tools/verify-browser.js` | Headless Chrome 端到端交互测试 |
| `tools/browser-tests.js` | 浏览器内测试用例 |
| `tools/verify-live.js` | 线上 GitHub Pages 冒烟验证（19 项） |
| `tools/live-tests.js` | 线上页面内测试用例 |
| `tools/visual-check.js` | 关键元素计算样式核验 |
| `tools/export-check.js` | 导出 HTML 可滚动 / 样式核验 |
| `desktop/launcher.c` | Windows 桌面启动器源码（需本地用 MinGW 编译，仓库不托管 exe） |

> 本仓库**不含任何二进制文件**：图片、字体、压缩包、可执行程序都不入库，全部以源码 / 文本形式提供。

## 本地运行

### 方式一：直接用浏览器（推荐）

```bash
node tools/serve.js 8099
# 打开 http://127.0.0.1:8099/
```

也可以把整个目录交给任意静态服务器，无需构建。

### 方式二：双击桌面启动器（Windows，需自行编译一次）

仓库不托管 exe。先按下方「编译 Windows 启动器」一节编译出 `Mojot-Markdown.exe`，双击它即可：程序会启动内置静态服务器（仅监听 `127.0.0.1:17777`）并在默认浏览器打开编辑器，同时显示控制窗口（可「重新打开编辑器」或「退出」），关闭窗口即停止服务。

> 编译产物是零依赖的原生 Win32 启动器（约 89 KB），不打包浏览器运行时；网页文件需与 exe 位于同一目录（也兼容 `desktop/` 子目录布局）。

### 方式三：静态托管

把本仓库整个目录交给任意静态服务器 / GitHub Pages 即可，无需构建。

## 测试

```bash
node tools/test-render.js                 # 渲染引擎 + XSS 防护 + 行映射（37 项）
node tools/serve.js 8099                 # 另开一个终端
node tools/verify-browser.js             # Headless Chrome 端到端（69 项）
node tools/visual-check.js               # 关键元素计算样式核验（6 项）
node tools/export-check.js               # 导出 HTML 可滚动 / 样式核验（9 项）
node tools/verify-live.js                # 线上 GitHub Pages 冒烟验证（24 项）
```

本地全量回归共 **121 项**，线上另有 24 项冒烟验证。覆盖：预览区选渲染文本改格式
（段落 / 标题 / 列表 / 表格单元格 / 引用块）、空格自动外移、代码块语言标签、
引用块正体、双主题、预览视图铺满、版本号、导出可滚动、重复格式取消、粗斜体组合、
XSS 防护与撤销重做。

## 线上地址

GitHub Pages：**https://yx333221c.github.io/mojot-markdown/**

仓库：https://github.com/yx333221c/mojot-markdown （默认分支 `main`，Pages 从根目录部署）

## 编译 Windows 启动器（可选）

需要 MinGW-w64 gcc（本机没有时自行安装，例如 `winget install -e --id mingw-w64` 或从 [WinLibs](https://winlibs.com/) 下载解压后把 `bin` 加入 PATH）：

```bash
gcc -O2 -mwindows -Wall -Wextra -o Mojot-Markdown.exe desktop/launcher.c -lws2_32 -lshell32
```

已实测：编译产物约 89 KB，双击后自动服务 `index.html` / `css` / `js`，浏览器可直接编辑。

## 关于二进制文件

本仓库**不托管任何二进制文件**：`.gitignore` 禁止图片、字体、压缩包、可执行程序等一切二进制内容，连 Windows 启动器也只提供 `desktop/launcher.c` 源码。原因有两点：

1. 二进制文件无法 diff / review，且每改一次就新增一个几十 KB 的副本，仓库体积会成倍增长；
2. 启动器只是「唤起浏览器」的薄壳，用上面的 `gcc` 一行命令就能本地产出，不值得入库。

因此克隆仓库后得到的是**纯文本工程**，编译的 exe 留在本地、由 `.gitignore` 自动忽略。

## 设计稿

UI 原型位于 Design Studio 的 `markdown-editor` 设计系统（已冻结），本实现沿用了其视觉规范与设计令牌。

## 许可

MIT
