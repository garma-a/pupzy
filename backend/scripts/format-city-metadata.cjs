const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const data = path.join(root, 'src/cities/data/neighbourhoods');
const manifest = JSON.parse(fs.readFileSync(path.join(data, 'source-manifest.json')));
const raw = new Set(manifest.snapshots.map((entry) => path.resolve(root, entry.path)));
const files = [];
const excluded = [];
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.name.endsWith('.json')) {
      if (raw.has(file)) excluded.push(path.relative(root, file));
      else files.push(file);
    }
  }
}
visit(data);
execFileSync(process.execPath, [require.resolve('prettier/bin/prettier.cjs'), '--write', ...files], {
  cwd: root,
  stdio: 'inherit',
});
// Derived metadata hashes describe the final formatted bytes. Never rewrite a raw-response hash.
const manifestPath = path.join(data, 'source-manifest.json');
const formattedManifest = JSON.parse(fs.readFileSync(manifestPath));
const updatedDerivedHashes = [];
for (const [name, entry] of Object.entries(formattedManifest.derivedArtifacts ?? {})) {
  const file = path.resolve(root, entry.path);
  if (file === manifestPath || raw.has(file)) throw new Error(`Not a derived artifact: ${entry.path}`);
  const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (entry.sha256 !== sha256) updatedDerivedHashes.push(name);
  entry.sha256 = sha256;
}
const content = execFileSync(process.execPath, [require.resolve('prettier/bin/prettier.cjs'), '--parser', 'json'], {
  cwd: root,
  input: JSON.stringify(formattedManifest),
  encoding: 'utf8',
});
fs.writeFileSync(manifestPath, content);
console.log(JSON.stringify({ formattedMetadata: files.length, untouchedRawResponses: excluded, updatedDerivedHashes }));
