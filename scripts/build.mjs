import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('src', 'dist', { recursive: true });
await cp('LICENSE', 'dist/LICENSE');
await cp('THIRD_PARTY_NOTICES.txt', 'dist/THIRD_PARTY_NOTICES.txt');
await cp('assets/Shirakawa-logo_simple.png', 'dist/icons/Shirakawa-logo_simple.png');
for (const file of ['GitHub_Lockup_Black_Clearspace.svg', 'ic_fluent_arrow_reset_24_regular.svg', 'ic_fluent_delete_24_regular.svg', 'ic_fluent_edit_24_regular.svg', 'ic_fluent_game_controller_button_x_20_regular.svg', 'ic_fluent_save_24_regular.svg', 'sparkle-16.svg']) await cp(`assets/icons/${file}`, `dist/icons/${file}`);
await build({ entryPoints: ['src/content.js'], bundle: true, format: 'iife', outfile: 'dist/content.js', platform: 'browser' });
