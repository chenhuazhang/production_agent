import http from 'node:http';

function get(url, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          length: body.length,
          elapsedMs: Date.now() - start,
          preview: body.substring(0, 300),
        });
      });
    });
    req.on('error', (e) => resolve({ error: e.message, elapsedMs: Date.now() - start }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ error: `timeout after ${timeoutMs}ms`, elapsedMs: Date.now() - start });
    });
  });
}

console.log('=== 1. http://localhost:3000/ ===');
const r1 = await get('http://localhost:3000/', 60000);
console.log(r1);

console.log('\n=== 2. http://localhost:3000/dashboard ===');
const r2 = await get('http://localhost:3000/dashboard', 120000);
console.log({ ...r2, preview: r2.preview?.substring(0, 200) });

console.log('\n=== 3. http://localhost:3000/api/dashboard ===');
const r3 = await get('http://localhost:3000/api/dashboard', 120000);
console.log({ ...r3, preview: r3.preview?.substring(0, 300) });
