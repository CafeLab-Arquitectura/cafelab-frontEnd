const fs = require('fs');
const path = require('path');

// ─── Leer .env manualmente (sin dependencias externas) ───────────
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .forEach((line) => {
      const [key, ...rest] = line.split('=');
      process.env[key.trim()] = rest.join('=').trim();
    });
}

// ─── Inyectar en los archivos de environment de Angular ──────────
const apiUrl = process.env.API_URL || 'https://includes-glasses-instruments-antonio.trycloudflare.com';

const targetPaths = [
  './src/environments/environment.ts',
  './src/environments/environment.local.ts',
  './src/environments/environment.development.ts',
  './src/environments/environment.remote.ts',
];

targetPaths.forEach((targetPath) => {
  if (fs.existsSync(targetPath)) {
    let content = fs.readFileSync(targetPath, 'utf8');
    content = content.replace(/serverBaseUrl:\s*'.*?'/, `serverBaseUrl: '${apiUrl}'`);
    fs.writeFileSync(targetPath, content);
    console.log(`[set-env] ${targetPath} → serverBaseUrl: '${apiUrl}'`);
  }
});
