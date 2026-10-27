import {createHash,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function passwordHash(value:string){const salt=randomBytes(16).toString('hex');return `${salt}:${(await derive(value,salt,64) as Buffer).toString('hex')}`;}
export async function passwordMatches(value:string,encoded:string){
  const [salt,digest]=encoded.split(':');
  if(!/^[a-f0-9]{32}$/.test(salt??'')||!/^[a-f0-9]{128}$/.test(digest??''))return false;
  return timingSafeEqual(await derive(value,salt,64) as Buffer,Buffer.from(digest,'hex'));
}
export const newSession=()=>randomBytes(32).toString('hex');
export function sameSecret(actual:string,expected:string){const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
