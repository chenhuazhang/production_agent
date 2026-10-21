import { readFileSync } from 'node:fs';

const buf = readFileSync('d:\\AIAgent\\production_agent\\web\\.env');
console.log('Size:', buf.length, 'bytes');
console.log('First 3 bytes (BOM check):', buf[0], buf[1], buf[2]);
console.log('Has UTF-8 BOM:', buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF);
console.log('Has UTF-16 LE BOM:', buf[0] === 0xFF && buf[1] === 0xFE);
console.log('Has UTF-16 BE BOM:', buf[0] === 0xFE && buf[1] === 0xFF);

// 按 BOM 情况解码
let text;
if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    text = buf.slice(3).toString('utf-8');
    console.log('Decoded as UTF-8 (BOM stripped)');
} else if (buf[0] === 0xFF && buf[1] === 0xFE) {
    text = buf.slice(2).toString('utf-16le');
    console.log('Decoded as UTF-16 LE (BOM stripped)');
} else if (buf[0] === 0xFE && buf[1] === 0xFF) {
    text = buf.swap16().slice(2).toString('utf-16le');
    console.log('Decoded as UTF-16 BE (BOM stripped)');
} else {
    text = buf.toString('utf-8');
    console.log('Decoded as plain UTF-8 (no BOM)');
}

console.log('\n--- Full content ---');
const lines = text.split(/\r?\n/);
lines.forEach((line, i) => {
    if (line.includes('SQL_PASSWORD') || line.includes('SQL_HOST') || line.includes('DATABASE_URL')) {
        // 显示每个字符的 charCode，找乱码
        const codes = [];
        for (let j = 0; j < line.length; j++) {
            const c = line.charCodeAt(j);
            if (c > 127) {
                codes.push(`[${j}]=U+${c.toString(16).padStart(4,'0')} '${line[j]}'`);
            }
        }
        console.log(`Line ${i+1}: ${line}`);
        if (codes.length > 0) {
            console.log(`  Non-ASCII chars: ${codes.join(', ')}`);
        }
    }
});
