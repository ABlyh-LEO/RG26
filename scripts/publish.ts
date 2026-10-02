/** JSON handoff remains available, using the same transaction engine as the workbench. */
import { resolve } from 'node:path';
import { runPublish } from './operator/cli';
import { safeMessage } from './operator/errors';

try { process.exitCode = await runPublish(resolve(import.meta.dirname, '..'), process.argv.slice(2)); }
catch (error) { console.error(safeMessage(error)); process.exitCode = 1; }
