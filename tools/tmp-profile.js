/* 测试脚本共用的临时目录清理工具：
   headless Chrome 每次都会写几十 MB 到 --user-data-dir，
   若不清掉很快会把磁盘占满。这里在进程退出时同步删除。 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function makeProfile(tag) {
  const dir = path.join(os.tmpdir(), 'mojot-' + tag + '-' + Date.now());
  const cleanup = () => {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1); });
  return dir;
}

/* 删除本次运行产生的临时导出文件 */
function cleanupFile(file) {
  try { if (file && fs.existsSync(file)) fs.rmSync(file, { force: true }); } catch (e) {}
}

module.exports = { makeProfile, cleanupFile };
