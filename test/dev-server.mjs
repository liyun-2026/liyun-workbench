/**
 * 本地预览服务器 —— 在电脑上就能把整个工作台跑起来（含登录、分角色、同步）。
 *
 *   node test/dev-server.mjs            # 默认 http://localhost:5173
 *   node test/dev-server.mjs 8080       # 想换端口就带个数字
 *
 * 后端用的就是仓库里那份真的 edge-functions/api/sync.js，
 * 只把 Blob 存储换成内存版（test/mock-blob.mjs）—— 所以重启即清空，随便造数据。
 *
 * 第一次打开会让你「登录」：随便填个用户名（≥2 字，汉字也行）+ 密码（≥8 位），
 * 第一个账号就是「首位教务」，能看到全部功能。
 */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 5173);

/* 把真 sync.js 里的 @edgeone/pages-blob 换成内存版，动态 import */
const srcPath = path.join(dir, 'edge-functions', 'api', 'sync.js');
const genPath = path.join(dir, 'test', '.sync.gen.mjs');
await writeFile(genPath,
  (await readFile(srcPath, 'utf8')).replace("from '@edgeone/pages-blob'", "from './mock-blob.mjs'"));
const { onRequestPost } = await import('./.sync.gen.mjs');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.js': 'text/javascript; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  /* 后端接口 */
  if (url.pathname === '/api/sync') {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');
    try {
      const out = await onRequestPost({
        request: new Request('http://localhost/api/sync', {
          method: 'POST',
          headers: { 'content-type': req.headers['content-type'] || 'application/json' },
          body,
        }),
      });
      const text = await out.text();
      res.writeHead(out.status, { 'content-type': out.headers.get('content-type') || 'application/json; charset=utf-8' });
      res.end(text);
    } catch (e) {
      console.error('[dev] 接口出错：', e);
      res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e && e.message || e) }));
    }
    return;
  }

  /* 静态文件：/ → index.html */
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const file = path.join(dir, rel);
  if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }   // 别让它跳出工程目录
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('没有这个文件：' + rel);
  }
}).listen(port, () => {
  console.log(`\n砺蕴工作台 · 本地预览  →  http://127.0.0.1:${port}   （推荐用这个地址）`);
  console.log(`                        http://localhost:${port}     （有的浏览器会把它送进代理，连不上就换上面的）\n`);
  console.log('  第一次打开就填个用户名和密码，第一个账号会自动成为「首位教务」。');
  console.log('  数据存在内存里，关掉这个终端就清空，可以随便试。\n');
});
/* 不指定地址 = IPv4/IPv6 都听。之前只绑 127.0.0.1，有的浏览器把 localhost 解析成
   ::1 先试，撞上代理软件就「网络没连上」，人还以为服务挂了。 */
server.on('error', e => {
  console.error('起不来：' + (e && e.message));
  if (e && /EADDRINUSE/.test(e.code || '')) console.error('端口 ' + port + ' 被占了。换一个：node test/dev-server.mjs 8080');
  process.exit(1);
});
