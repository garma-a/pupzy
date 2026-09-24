// Launches one piece of the local e2e rig: `node run.js s3|auth|backend`.
// Everything runs on this machine; no real Firebase or Cloudflare credentials are used.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const rig = __dirname;
const backendDir = path.resolve(rig, '../../backend');
const which = process.argv[2];

const services = {
  s3: () => {
    fs.mkdirSync(path.join(rig, 's3data'), { recursive: true });
    return {
      cmd: process.execPath,
      args: [
        path.join(rig, 'node_modules/s3rver/bin/s3rver.js'),
        '--directory', path.join(rig, 's3data'),
        '--port', '4568',
        '--address', '0.0.0.0',
        '--configure-bucket', 'pupzy-e2e',
      ],
      cwd: rig,
      env: process.env,
    };
  },
  auth: () => ({
    cmd: process.execPath,
    args: [
      path.join(rig, 'node_modules/firebase-tools/lib/bin/firebase.js'),
      'emulators:start', '--only', 'auth', '--project', 'pupzy-app-5f707',
    ],
    cwd: rig,
    env: process.env,
  }),
  backend: () => {
    const e2e = JSON.parse(fs.readFileSync(path.join(rig, 'e2e.env.json'), 'utf8'));
    if (!e2e.DATABASE_URL.endsWith('/pupzy_e2e')) throw new Error('e2e backend must use pupzy_e2e');
    // Unset admin bootstrap so the real .env admin credentials never reach this DB.
    return {
      cmd: process.execPath,
      args: ['dist/main.js'],
      cwd: backendDir,
      env: { ...process.env, ...e2e, ADMIN_SEED_EMAIL: '', ADMIN_SEED_PASSWORD: '' },
    };
  },
};

if (!services[which]) {
  console.error('usage: node run.js s3|auth|backend');
  process.exit(2);
}
const { cmd, args, cwd, env } = services[which]();
const child = spawn(cmd, args, { cwd, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
