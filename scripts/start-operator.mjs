/**
 * 启动本地维护工具，并把**正确的入口 URL** 明确打印出来。
 *
 * 为什么需要这个包装脚本：
 * Vite 只会把**根 URL** 当成 "Local" 打印。而维护模式的根 URL 是
 * 只读的观众站（index.html），真正的录入页在独立的 `operator.html`
 * 入口里。直接 `vite --mode operator` 时，终端只显示
 * `http://127.0.0.1:5199/`，照着打开看到的是一个没有任何录入表单的
 * 公开页面 —— 使用者会以为维护工具坏了。
 *
 * 这里转发 Vite 的全部输出，并在启动后补一段醒目的入口提示。
 * （vite.config.ts 里另设了 server.open 直接打开正确页面，但
 * 无头环境 / 远程终端打不开浏览器，所以终端提示不能省。）
 */
import { spawn } from 'node:child_process';

const PORT = 5199;
const ENTRY = `http://127.0.0.1:${PORT}/operator.html`;

// stdio inherit：子进程直接继承终端，不经管道。
// （沙箱下带管道的 stdio 会 EPERM，且这里本来也不需要捕获输出。）
//
// Windows 上必须经 shell —— Node 24 直接 spawn `npx.cmd`
// 会抛 `EINVAL`（.cmd 不是可执行映像，需要 shell 解析）。
// 命令整串作为一个字符串传入（而不是 `shell: true` + 参数数组），
// 以免触发 DEP0190「参数未转义」警告。
const child = spawn('npx vite --mode operator', {
  stdio: 'inherit',
  shell: true,
});

console.log('');
console.log('  维护工具入口（请打开这个，不是根地址）：');
console.log(`    ${ENTRY}`);
console.log(`  根地址 http://127.0.0.1:${PORT}/ 是只读的观众站，没有录入表单。`);
console.log('');

child.on('exit', (code) => process.exit(code ?? 0));
