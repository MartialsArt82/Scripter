const fs = require('node:fs/promises');
const path = require('node:path');
const { createPackageWithOptions } = require('@electron/asar');
const { execFileSync } = require('node:child_process');

async function pack() {
  if (!process.argv[2]) throw new Error('Ein Build-Ordner ist erforderlich.');
  const build = path.resolve(process.argv[2]);
  const root = path.resolve(__dirname, '..');
  const staging = path.join(build, 'app-files');
  const files = ['app.js','core.cjs','main.cjs','speech.cjs','speech-ui.js','storyboard.js','preload.cjs','preview-preload.cjs','pdf-preview','index.html','style.css','hilfe.html','transcribe.py','package.json','data','fonts','icons'];
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  for (const name of files) await fs.cp(path.join(root, name), path.join(staging, name), { recursive: true });
  const dependencies = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath, 'ls', '--omit=dev', '--all', '--parseable', '--json'], { cwd: root, encoding: 'utf8' }));
  const names = new Set();
  function collect(tree) {
    for (const [name, details] of Object.entries(tree.dependencies || {})) {
      names.add(name);
      collect(details);
    }
  }
  collect(dependencies);
  for (const name of names) await fs.cp(path.join(root, 'node_modules', name), path.join(staging, 'node_modules', name), { recursive: true });
  await createPackageWithOptions(staging, path.join(build, 'app.asar'), { unpack: '**/thesauri.sqlite' });
}

pack().catch(error => { console.error(error); process.exitCode = 1; });
