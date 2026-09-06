import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

const BUDGET = 12 * 1024   // ngân sách gzip: vượt là dấu hiệu SDK đang phình

await build({ entryPoints: ['packages/sdk/src/index.ts'], outfile: 'packages/sdk/dist/arcade.mjs',
  bundle: true, format: 'esm', target: 'es2020', minify: true })
await build({ entryPoints: ['packages/sdk/src/index.ts'], outfile: 'packages/sdk/dist/arcade.global.js',
  bundle: true, format: 'iife', globalName: 'ArcadeSDK', target: 'es2020', minify: true,
  footer: { js: 'window.Arcade=ArcadeSDK.Arcade;' } })

const raw = readFileSync('packages/sdk/dist/arcade.global.js')
const gz = gzipSync(raw).length
console.log(`arcade.global.js  ${(raw.length / 1024).toFixed(1)}KB raw  ${(gz / 1024).toFixed(1)}KB gzip  (ngân sách ${BUDGET / 1024}KB)`)
if (gz > BUDGET) { console.error('✗ VƯỢT NGÂN SÁCH'); process.exit(1) }
console.log('✓ trong ngân sách')
