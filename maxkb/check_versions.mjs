import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function getVer(p) {
    try {
        const pkg = JSON.parse(readFileSync(join(p, 'package.json'), 'utf-8'));
        return pkg.version;
    } catch { return '(not found)'; }
}

console.log('web next:', getVer('d:\\AIAgent\\production_agent\\web\\node_modules\\next'));
console.log('root next:', getVer('d:\\AIAgent\\production_agent\\node_modules\\next'));
console.log('web @swc/helpers:', getVer('d:\\AIAgent\\production_agent\\web\\node_modules\\@swc\\helpers'));
console.log('web @swc/core:', getVer('d:\\AIAgent\\production_agent\\web\\node_modules\\@swc\\core'));

// 检查 web/node_modules 里是否有那个 hash 后缀的 helpers 目录
import { readdirSync } from 'node:fs';
const swcDir = 'd:\\AIAgent\\production_agent\\web\\node_modules\\@swc';
try {
    const entries = readdirSync(swcDir);
    console.log('\n@swc/* entries in web:', entries);
} catch (e) { console.log('Cannot read @swc dir:', e.message); }
