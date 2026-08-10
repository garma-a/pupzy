import { execSync } from 'child_process';
import fs from 'fs';

const pidArg = process.argv[2];
if (!pidArg) {
  console.error('Usage: node memory-monitor.mjs <PID>');
  process.exit(1);
}

const pid = parseInt(pidArg, 10);
const logFile = './memory-log.csv';
fs.writeFileSync(logFile, 'timestamp,rss_mb,vsz_mb,cpu_pct\n');

console.log(`📊 Monitoring PID ${pid}... Logging to ${logFile}`);

let maxRss = 0;
let minRss = Infinity;
let count = 0;
let totalRss = 0;

const interval = setInterval(() => {
  try {
    const out = execSync(`ps -p ${pid} -o %cpu,rss,vsz --no-headers`, { encoding: 'utf-8' }).trim();
    if (!out) {
      clearInterval(interval);
      console.log('Process exited.');
      return;
    }
    const [cpuStr, rssStr, vszStr] = out.split(/\s+/);
    const cpu = parseFloat(cpuStr);
    const rssMb = parseFloat((parseInt(rssStr, 10) / 1024).toFixed(2));
    const vszMb = parseFloat((parseInt(vszStr, 10) / 1024).toFixed(2));

    maxRss = Math.max(maxRss, rssMb);
    minRss = Math.min(minRss, rssMb);
    totalRss += rssMb;
    count++;

    const timestamp = new Date().toISOString().substring(11, 19);
    fs.appendFileSync(logFile, `${timestamp},${rssMb},${vszMb},${cpu}\n`);

    const avgRss = (totalRss / count).toFixed(2);
    process.stdout.write(`\r⏱️ [${timestamp}] Current RAM (RSS): ${rssMb} MB | Avg: ${avgRss} MB | Peak RAM: ${maxRss} MB | CPU: ${cpu}%   `);
  } catch (err) {
    clearInterval(interval);
    console.log('\nProcess monitoring stopped.');
  }
}, 1000);
