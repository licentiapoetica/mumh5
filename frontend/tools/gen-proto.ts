// Regenerates the static protobuf codecs in src/core from ../proto/*.proto.
//   bun run proto
// Uses the pinned protobufjs-cli through `bun x`; set PBJS to a local pbjs executable to work offline.
const root = Bun.fileURLToPath(new URL('../', import.meta.url));
const pbjs = Bun.env.PBJS ? [Bun.env.PBJS] : ['x', '--package', 'protobufjs-cli@2.7.1', 'pbjs'];
const flags = ['-t', 'static-module', '-w', 'es6', '--keep-case', '--no-delimited', '--no-service', '--no-comments', '--force-number'];
for (const [proto, out] of [['Mumble', 'mumble-pb'], ['MumbleUDP', 'mumble-udp-pb']]) {
 const cmd = [process.execPath, '--bun', ...pbjs, ...flags, `${root}../proto/${proto}.proto`, '-o', `${root}src/core/${out}.js`];
 const run = Bun.spawnSync(cmd, { stdout: 'inherit', stderr: 'inherit' });
 if (run.exitCode !== 0) throw new Error(`pbjs failed for ${proto}.proto`);
 console.log(`src/core/${out}.js written`);
}
