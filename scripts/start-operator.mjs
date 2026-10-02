/** Launch the same-origin local API and Vite UI without shell command interpolation. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./operator-server.ts', import.meta.url))], {
  stdio: 'inherit', shell: false, windowsHide: true,
});
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
