// Same-origin transport only. Credentials remain in the server, never in browser storage.
const messages={401:'需要身份认证，请由服务端完成登录验证。',403:'没有对应权限，操作已停止。',409:'数据或任务版本冲突，请查询原任务并核对资料。',423:'当前能力被安全策略关闭。',404:'服务或任务尚未接入。',429:'请求受到限制，请稍后查询原任务。'};
export class ServiceError extends Error {
  constructor(status,code,trace=null,unknown=false) {
    super(unknown?'请求结果未知，请只读查询原任务；不会自动重发。':messages[status] || '服务未返回可验证结果，已安全停止。');
    this.status=status;this.code=code;this.trace=trace;this.unknown=unknown;
  }
}
export function createTransport(fetcher=globalThis.fetch,timeoutMs=45000) {
  const pending=new Map();
  return function request(path,{body,timeout=timeoutMs}={}) {
    if (!path.startsWith('/api/') || path.startsWith('//') || path.includes('..')) throw new Error('只允许现有同源 API');
    const method=body===undefined?'GET':'POST', key=method+path+JSON.stringify(body??null);
    if (pending.has(key)) return pending.get(key);
    const promise=(async()=>{
      const controller=new AbortController();let timer;
      try {
        const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ServiceError(0,'TIMEOUT',null,true));},timeout);});
        const work=(async()=>{
          const response=await fetcher(path,{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,
            ...(body===undefined?{}:{headers:{'Content-Type':'application/json','X-Finance-Request':'1'},body:JSON.stringify(body)})});
          if(!response.ok) {
            // Do not display raw upstream errors, which can contain credentials or internal URLs.
            let data;try{data=await response.json();}catch{/* Keep the HTTP status. */}
            throw new ServiceError(response.status,data?.error?.code || 'HTTP_ERROR',data?.trace || null);
          }
          if(!response.headers.get('content-type')?.includes('application/json')) throw new ServiceError(502,'INVALID_RESPONSE',null,method==='POST');
          const data=await response.json();
          if(data?.error || data?.status==='error')throw new ServiceError(502,'SERVICE_ERROR',data?.trace || null);
          return data;
        })();
        return await Promise.race([work,deadline]);
      }catch(error){if(error instanceof ServiceError)throw error;throw new ServiceError(0,'NETWORK_UNKNOWN',null,method==='POST');}
      finally{clearTimeout(timer);}
    })();
    pending.set(key,promise);promise.finally(()=>pending.delete(key)).catch(()=>{});return promise;
  };
}
export const request=createTransport();
