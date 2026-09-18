/**
 * 内存版 Blob 存储：测试用，模拟 @edgeone/pages-blob 的 get / setJSON / delete
 */
const mem = new Map();
export function getStore(){
  return {
    async get(key, opts){
      const v = mem.get(key);
      if (v === undefined) return undefined;
      return (opts && opts.type === 'json') ? JSON.parse(JSON.stringify(v)) : v;
    },
    async setJSON(key, val){ mem.set(key, JSON.parse(JSON.stringify(val))); },
    async delete(key){ mem.delete(key); },
  };
}
export function raw(){ return mem; }

/** 清空全部 —— 给本地预览的「重置」用，回到第一次使用的状态 */
export function reset(){ mem.clear(); }
