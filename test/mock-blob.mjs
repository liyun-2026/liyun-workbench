/**
 * 内存版 Blob 存储：测试用，模拟 @edgeone/pages-blob 的 get / setJSON / delete
 *
 * 顺带给本地预览加了一层「重启不丢」：改动会落盘到 test/.preview-data.json，
 * 下次起服务自动读回来 —— 否则每次重启预览都要重新建账号、重新录数据，
 * 根本没法拿它当工作台用。想从头来就点登录页的「重置本地数据」。
 *
 * 测试进程里不落盘（只认 dev-server 启动），免得多跑几次测试就污染预览数据。
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, '.preview-data.json');
const IS_PREVIEW = /dev-server\.mjs$/.test(process.argv[1] || '');

const mem = new Map();
let restored = 0;
if (IS_PREVIEW){
  try {
    for (const [k, v] of Object.entries(JSON.parse(readFileSync(DATA, 'utf8')))) { mem.set(k, v); restored++; }
  } catch { /* 首次运行没有这个文件，正常 */ }
}

let timer = null;
function save(){
  if (!IS_PREVIEW) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { writeFileSync(DATA, JSON.stringify(Object.fromEntries(mem))); } catch { /* 写不进去也不该影响预览 */ }
  }, 300);
}

export function getStore(){
  return {
    async get(key, opts){
      const v = mem.get(key);
      if (v === undefined) return undefined;
      return (opts && opts.type === 'json') ? JSON.parse(JSON.stringify(v)) : v;
    },
    async setJSON(key, val){ mem.set(key, JSON.parse(JSON.stringify(val))); save(); },
    async delete(key){ mem.delete(key); save(); },
  };
}
export function raw(){ return mem; }

/** 上次重启前留下的键数（0 = 全新） */
export function restoredCount(){ return restored; }

/** 清空全部 —— 给本地预览的「重置」用，回到第一次使用的状态 */
export function reset(){
  mem.clear();
  restored = 0;
  if (IS_PREVIEW) { try { rmSync(DATA, { force: true }); } catch {} }
}
