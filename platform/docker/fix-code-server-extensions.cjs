const fs = require('node:fs');
const path = require('node:path');

// The server distribution ships Node bundles for these built-ins, but retains
// browser entry points whose bundles are absent. Do not alias Node code into a
// browser worker: remove only the invalid entry so VS Code selects the remote host.
function fixExtensions(root) {
  const repaired = [];
  for (const name of ['git-base', 'merge-conflict']) {
    const directory = path.join(root, name);
    const manifestPath = path.join(directory, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const exists = entry => typeof entry === 'string' && [entry, `${entry}.js`].some(file => fs.existsSync(path.resolve(directory, file)));
    if (!manifest.browser || exists(manifest.browser)) continue;
    if (!exists(manifest.main)) throw new Error(`code-server ${name}: neither browser nor server entry exists`);
    delete manifest.browser;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    repaired.push(name);
  }
  return repaired;
}
module.exports = { fixExtensions };
if (require.main === module) {
  const repaired = fixExtensions(process.argv[2] || '/usr/lib/code-server/lib/vscode/extensions');
  console.log(`code-server extension entries checked; repaired: ${repaired.join(', ') || 'none'}`);
}
