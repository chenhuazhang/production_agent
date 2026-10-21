import http from 'node:http';

function get(url, timeoutMs = 300000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          length: body.length,
          preview: body.substring(0, 300),
          elapsedMs: Date.now() - start,
        });
      });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ error: `timeout after ${timeoutMs}ms` });
    });
  });
}

console.log('--- server /health ---');
const h = await get('http://localhost:8000/health', 10000);
console.log(h);

console.log('\n--- web / (首页) ---');
const r = await get('http://localhost:3000/', 300000);
console.log({
  status: r.status,
  length: r.length,
  elapsedMs: r.elapsedMs,
  preview: r.preview?.substring(0, 200),
  error: r.error,
});

console.log('\n--- web /api/dashboard ---');
const d = await get('http://localhost:3000/api/dashboard', 300000);
console.log({
  status: d.status,
  length: d.length,
  elapsedMs: d.elapsedMs,
  preview: d.preview?.substring(0, 300),
  error: d.error,
});
