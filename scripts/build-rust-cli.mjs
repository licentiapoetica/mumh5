import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
export async function buildRustCli() {
  const { stdout: version } = await run('rustc', ['-vV']);
  const host = /^host: (.+)$/m.exec(version)?.[1];
  if (!host) throw new Error('Could not determine Rust host target');
  const { stdout } = await run('cargo', ['metadata', '--locked', '--manifest-path', 'rust-cli/Cargo.toml', '--format-version', '1', '--filter-platform', host], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  const metadata = JSON.parse(stdout);
  await run('cargo', ['build', '--locked', '--release', '--manifest-path', 'rust-cli/Cargo.toml'], { cwd: root, maxBuffer: 8 * 1024 * 1024 }).then(({ stderr }) => process.stderr.write(stderr));
  const directory = path.join(root, 'dist-cli-rust');
  await mkdir(directory, { recursive: true });
  const binary = process.platform === 'win32' ? 'mumh5-cli.exe' : 'mumh5-cli';
  const temporary = path.join(directory, `.${binary}-${process.pid}.tmp`);
  try {
    await copyFile(path.join(metadata.target_directory, 'release', binary), temporary);
    await rename(temporary, path.join(directory, binary));
  } finally { await rm(temporary, { force: true }); }
  for (const name of ['README.md', 'BOTS.md']) await copyFile(path.join(root, 'rust-cli', name), path.join(directory, name));
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await copyFile(path.join(root, name), path.join(directory, name));
  const licenses = path.join(directory, 'licenses');
  await mkdir(licenses, { recursive: true });
  const index = [];
  for (const pkg of metadata.packages.filter(pkg => pkg.source)) {
    const source = path.dirname(pkg.manifest_path);
    const files = (await readdir(source, { withFileTypes: true })).filter(entry => entry.isFile() && /^(licen[cs]e|copying|notice)([._-]|$)/i.test(entry.name)).map(entry => path.join(source, entry.name));
    if (pkg.license_file) files.push(path.resolve(source, pkg.license_file));
    const destination = path.join(licenses, `${pkg.name}-${pkg.version}`);
    await mkdir(destination, { recursive: true });
    for (const file of new Set(files)) await copyFile(file, path.join(destination, path.basename(file)));
    index.push({ name: pkg.name, version: pkg.version, license: pkg.license, repository: pkg.repository, files: [...new Set(files.map(file => path.basename(file)))] });
  }
  await writeFile(path.join(licenses, 'INDEX.json'), JSON.stringify(index, null, 2) + '\n');
  process.stdout.write(`Native CLI packaged in ${directory}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildRustCli();
