import {spawnSync} from 'node:child_process';
import {copyFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const desktop = 'apps/windows/src-tauri/icons';
const cli = join(root, 'apps/windows/node_modules/@tauri-apps/cli/tauri.js');
function generate(args) {
  const result = spawnSync(process.execPath, [cli, 'icon', 'assets/irm-icon.PNG', ...args], {cwd: root, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Icon generation failed');
}
generate(['--output', desktop, '--ios-color', '#00113f']);
generate(['--output', 'assets/icons', '--png', '32', '--png', '180', '--png', '192', '--png', '512']);
await copyFile(join(root, desktop, 'ios/AppIcon-512@2x.png'), join(root, 'apps/mobile/assets/irm-app-icon.png'));
await copyFile(join(root, desktop, 'android/mipmap-xxxhdpi/ic_launcher_foreground.png'), join(root, 'apps/mobile/assets/irm-adaptive-icon.png'));
console.log('Web, desktop and mobile icons generated from assets/irm-icon.PNG');
