import { open } from 'node:fs/promises';
import { join } from 'node:path';

const dir = 'C:\\Users\\K027932\\.pi\\agent\\sessions\\--D--AIAgent-production_agent--';
const f = join(dir, `test-${Date.now()}.txt`);
try {
  const fh = await open(f, 'wx');  // O_EXCL 模式
  await fh.write('test content');
  await fh.close();
  console.log('NODE WRITE OK:', f);
  const { unlink } = await import('node:fs/promises');
  await unlink(f);
  console.log('CLEANED UP');
} catch (e) {
  console.log('NODE WRITE FAIL:', e.code, e.message);
}
