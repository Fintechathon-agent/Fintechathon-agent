import {randomBytes} from 'node:crypto';
import {sign,equal} from './risk.mjs';
const COOKIE='__Host-fund-session',MAX_AGE=30*86400;
export function sessionFor(request,secret,now=Date.now()){
 if(typeof secret!=='string'||secret.length<32)throw Object.assign(Error('SESSION_NOT_CONFIGURED'),{status:503});
 const token=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1),parts=token?.split('.')||[];
 let id,fresh=true;
 if(parts.length===3&&/^[a-f0-9]{64}$/.test(parts[0])&&/^\d{10}$/.test(parts[1])&&Number(parts[1])*1000>now&&Number(parts[1])*1000<=now+(MAX_AGE+60)*1000&&equal(parts[2],sign(secret,parts[0]+'.'+parts[1]))){id=parts[0];fresh=false;}
 id||=randomBytes(32).toString('hex');const value=id+'.'+(Math.floor(now/1000)+MAX_AGE);
 return {id,csrf:sign(secret,'csrf:'+id),fresh,cookie:`${COOKIE}=${value}.${sign(secret,value)}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE}`};
}
