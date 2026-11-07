/* 版本同步：VERSION 是唯一来源，把他处所有版本号刷新一致。
   用法: node tools/version.js            # 同步
        node tools/version.js 1.2.0      # 写入新版本并同步
   同步目标: index.html 的 #appVersion、README 版本行、desktop/launcher.c 的 APP_VER
*/
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const versionFile = path.join(root, 'VERSION');

function readVersion() {
  return fs.readFileSync(versionFile, 'utf8').trim();
}
function writeVersion(v) {
  if (!/^\d+\.\d+\.\d+$/.test(v)) {
    console.error('版本号必须是 x.y.z 形式，收到: ' + v);
    process.exit(1);
  }
  fs.writeFileSync(versionFile, v + '\n');
}

const next = process.argv[2];
if (next) writeVersion(next);

const v = readVersion();
const changes = [];

function patch(relPath, transform) {
  const file = path.join(root, relPath);
  if (!fs.existsSync(file)) return;
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    changes.push(relPath);
  }
}

// 1) 页面状态栏版本号
patch('index.html', s => s.replace(
  /(<span class="status-item status-version" id="appVersion" title="应用版本">)(.*?)(<\/span>)/,
  (_, a, __, c) => a + 'v' + v + c));

// 2) README 中的版本说明（单独捕获前后 `**`，避免重复套星号）
patch('README.md', s => s.replace(
  /(当前版本：)(\*\*)?v?\d+\.\d+\.\d+(\*\*)?/,
  (_, a, b, c) => a + (b || '') + 'v' + v + (c || '')));

// 3) Windows 启动器标题里的版本
patch('desktop/launcher.c', s => s.replace(
  /#define APP_VER    L"v?\d+\.\d+\.\d+"/,
  '#define APP_VER    L"v' + v + '"'));

console.log('VERSION = ' + v);
console.log(changes.length ? '已同步: ' + changes.join(', ') : '已是同步状态（无改动）');
