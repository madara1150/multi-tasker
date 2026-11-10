// Takes the README screenshots from the real app: creates a small demo
// repository, starts Baton in screenshot mode (see src/main/shots.ts) and lets
// Claude Code make a real change in two workspaces.
// Run with: npm run screenshots   (needs Claude Code installed and signed in)
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = mkdtempSync(path.join(os.tmpdir(), 'baton-shots-'))
const demo = path.join(tmp, 'coffee-shop')
mkdirSync(demo, { recursive: true })

writeFileSync(
  path.join(demo, 'index.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Coffee Shop</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header>
      <h1>Coffee Shop</h1>
    </header>
    <main>
      <p>Fresh beans, roasted every morning.</p>
    </main>
    <script src="app.js"></script>
  </body>
</html>
`
)
writeFileSync(
  path.join(demo, 'style.css'),
  `body {
  margin: 0;
  font-family: system-ui, sans-serif;
  background: #faf7f2;
  color: #2b2620;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
}
main {
  padding: 24px;
}
`
)
writeFileSync(path.join(demo, 'app.js'), `console.log('Coffee Shop ready')\n`)

const git = (...args) => execFileSync('git', args, { cwd: demo, stdio: 'ignore' })
git('init', '-q', '-b', 'main')
git('-c', 'user.name=Demo', '-c', 'user.email=demo@localhost', 'add', '-A')
git('-c', 'user.name=Demo', '-c', 'user.email=demo@localhost', 'commit', '-q', '-m', 'Initial commit')

const electron = createRequire(import.meta.url)('electron')
const res = spawnSync(electron, [root], {
  stdio: 'inherit',
  env: {
    ...process.env,
    BATON_SHOTS: path.join(root, 'docs', 'screenshots'),
    BATON_USER_DATA: path.join(tmp, 'user-data'),
    BATON_HOME: path.join(tmp, 'home'),
    BATON_DEMO_REPO: demo
  }
})
rmSync(tmp, { recursive: true, force: true })
process.exit(res.status ?? 1)
