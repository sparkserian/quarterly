import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const buildDir = path.join(rootDir, 'build');
const publicDir = path.join(rootDir, 'public');
const iconsetDir = path.join(buildDir, 'icon.iconset');
const sourceSvg = path.join(buildDir, 'icon-source.svg');

const outputSizes = [
  [16, path.join(publicDir, 'favicon-16x16.png')],
  [32, path.join(publicDir, 'favicon-32x32.png')],
  [180, path.join(publicDir, 'apple-touch-icon.png')],
  [1024, path.join(buildDir, 'icon.png')],
];

const iconsetSizes = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
];

await mkdir(buildDir, { recursive: true });
await mkdir(publicDir, { recursive: true });
await mkdir(iconsetDir, { recursive: true });

for (const [size, outputPath] of outputSizes) {
  await sharp(sourceSvg).resize(size, size).png().toFile(outputPath);
}

for (const [size, filename] of iconsetSizes) {
  await sharp(sourceSvg).resize(size, size).png().toFile(path.join(iconsetDir, filename));
}

const iconBuffer = await pngToIco(path.join(buildDir, 'icon.png'));
await writeFile(path.join(buildDir, 'icon.ico'), iconBuffer);

execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(buildDir, 'icon.icns')], {
  stdio: 'inherit',
});
