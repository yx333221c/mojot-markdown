# 墨记 Mojot

> 选中文本，一键加格式；左边写 Markdown，右边实时看结果。

一个**纯前端、零依赖**的双栏 Markdown 编辑器。无构建步骤、无后端、无网络请求，直接用浏览器打开即可使用；同时提供一个 Windows 桌面启动器。

界面：深色应用框架（顶栏 / 工具栏 / 状态栏）+ 浅色纸面双栏（源码 / 预览），支持深色主题。

## 功能

- **选中即格式化**：选中文本后点工具栏或浮动气泡，一键加 **粗体**、*斜体*、~~删除线~~、`行内代码`；再次点击可取消。支持快捷键 `Ctrl+B` / `Ctrl+I` / `Ctrl+K` / `Ctrl+\`` / `Ctrl+Shift+X`。
- **双栏实时预览**：左侧源码（真实 `textarea` + 行号 + 光标定位），右侧实时渲染，滚动同步；可在「仅编辑 / 分栏 / 仅预览」间切换，分栏宽度可拖动。
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
| `js/markdown.js` | Markdown 渲染引擎（零依赖，含 XSS 防护） |
| `js/app.js` | 编辑器交互逻辑 |
| `tools/serve.js` | 本地静态预览服务器（零依赖） |
| `tools/test-render.js` | 渲染引擎单元测试 |
| `tools/verify-browser.js` | Headless Chrome 端到端交互测试 |
| `tools/browser-tests.js` | 浏览器内测试用例 |
| `desktop/launcher.c` | Windows 桌面启动器源码（MinGW 编译） |
| `Mojot-Markdown.exe` | 预编译的 Windows 启动器，双击后在默认浏览器打开编辑器 |

## 本地运行

### 方式一：双击 exe（Windows）

运行 `Mojot-Markdown.exe`，它会启动内置静态服务器（仅监听 `127.0.0.1:17777`）并在默认浏览器打开编辑器；同时显示一个控制窗口，可「重新打开编辑器」或「退出」。关闭窗口即停止服务。

> exe 是零依赖的原生 Win32 启动器（约 89 KB），不打包浏览器运行时；网页文件需与 exe 位于同一目录（也兼容 `desktop/` 子目录布局）。

### 方式二：直接用浏览器

```bash
node tools/serve.js 8099
# 打开 http://127.0.0.1:8099/
```

### 方式三：静态托管

把本仓库整个目录交给任意静态服务器 / GitHub Pages 即可，无需构建。

## 测试

```bash
node tools/test-render.js                 # 渲染引擎 + XSS 防护（18 项）
node tools/serve.js 8099                 # 另开一个终端
node tools/verify-browser.js             # Headless Chrome 端到端（24 项）
```

## 编译 Windows 启动器（可选）

需要 MinGW-w64 gcc（本机没有时自行安装，例如 `winget install -e --id mingw-w64` 或从 [WinLibs](https://winlibs.com/) 下载解压后把 `bin` 加入 PATH）：

```bash
gcc -O2 -mwindows -Wall -Wextra -o Mojot-Markdown.exe desktop/launcher.c -lws2_32 -lshell32
```

已实测：编译产物约 89 KB，双击后自动服务 `index.html` / `css` / `js`，浏览器可直接编辑。

## 关于二进制文件

仓库通过 `.gitignore` 禁止一切二进制文件入库（图片、字体、压缩包、依赖等），**唯一例外**是根目录的 `Mojot-Markdown.exe`（最终交付物）。因此整个仓库其余内容都是纯文本，可直接阅读与审阅。

## 设计稿

UI 原型位于 Design Studio 的 `markdown-editor` 设计系统（已冻结），本实现沿用了其视觉规范与设计令牌。

## 许可

MIT
