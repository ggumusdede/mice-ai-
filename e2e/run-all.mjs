// Runs every browser e2e script sequentially against ALREADY RUNNING servers (api :3001 AI_PROVIDER=mock, web :5173) and prints a
// summary table (pass / fail / skip, duration). Non-zero exit when any script fails.
//
//   node e2e/run-all.mjs                    # all: steps0-5, steps6-8, scenarios/*.mjs
//   node e2e/run-all.mjs 03 delegation      # only scripts whose file name contains one of the arguments
//   E2E_TIMEOUT_S=600 VERBOSE=1 …           # per-script timeout (default 600 s); VERBOSE=1 streams each script's output
//
// Env is passed through (BASE_URL, SHOTS, HEADED, INBOUND_EMAIL_SECRET for scenario 14, API_LOG for scenario 15,
// MIGRATION_DATABASE_URL for the psql time travel in scenario 9). A script exiting with 3 is reported as SKIP.
import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const filters = process.argv.slice(2);
const timeoutS = Number(process.env.E2E_TIMEOUT_S ?? 600);
const scripts = [
  join(here, 'steps0-5.mjs'),
  join(here, 'steps6-8.mjs'),
  ...readdirSync(join(here, 'scenarios')).filter((f) => f.endsWith('.mjs')).sort().map((f) => join(here, 'scenarios', f)),
].filter((s) => !filters.length || filters.some((f) => s.includes(f)));

const logDir = resolve(process.env.E2E_LOG_DIR ?? join(here, 'shots', 'logs'));
mkdirSync(logDir, { recursive: true });

function run(script) {
  return new Promise((done) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [script], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (d) => {
      out += d;
      if (process.env.VERBOSE) process.stdout.write(d);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => {
      out += `\nTIMEOUT after ${timeoutS}s`;
      child.kill('SIGKILL');
    }, timeoutS * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, out, seconds: (Date.now() - t0) / 1000 });
    });
  });
}

const results = [];
for (const script of scripts) {
  const name = script.slice(here.length + 1);
  process.stdout.write(`▶ ${name} … `);
  const r = await run(script);
  const status = r.code === 0 ? 'PASS' : r.code === 3 ? 'SKIP' : 'FAIL';
  const log = join(logDir, `${name.replace(/[/\\]/g, '_')}.log`);
  writeFileSync(log, r.out);
  const detail = status === 'FAIL'
    ? (r.out.match(/PROBLEMS[\s\S]*$/)?.[0] ?? r.out.slice(-600)).split('\n').slice(0, 6).join(' | ')
    : status === 'SKIP' ? (r.out.match(/SKIPPED: (.*)/)?.[1] ?? '') : '';
  results.push({ name, status, seconds: r.seconds, detail, log });
  console.log(`${status} (${r.seconds.toFixed(1)}s)`);
}

const w = Math.max(...results.map((r) => r.name.length), 6);
console.log(`\n${'Script'.padEnd(w)}  Result  Duration`);
console.log(`${'-'.repeat(w)}  ------  --------`);
for (const r of results) console.log(`${r.name.padEnd(w)}  ${r.status.padEnd(6)}  ${`${r.seconds.toFixed(1)}s`.padStart(8)}`);
const failed = results.filter((r) => r.status === 'FAIL');
const total = results.reduce((s, r) => s + r.seconds, 0);
console.log(`\n${results.length} scripts · ${results.filter((r) => r.status === 'PASS').length} pass · ${failed.length} fail · ${results.filter((r) => r.status === 'SKIP').length} skip · ${total.toFixed(0)}s · logs: ${logDir}`);
for (const r of results.filter((x) => x.status !== 'PASS')) console.log(`\n${r.status} ${r.name}: ${r.detail}\n  log: ${r.log}`);
process.exit(failed.length ? 1 : 0);
