import path from 'node:path';
export function config(){
 const production=process.env.NODE_ENV==='production',origin=process.env.PUBLIC_ORIGIN||'http://127.0.0.1:8780';
 if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required');
 if(!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<32||process.env.SESSION_SECRET.includes('REPLACE_'))throw Error('SESSION_SECRET must contain at least 32 characters');
 const u=new URL(origin);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/')throw Error('PUBLIC_ORIGIN must be a root HTTP(S) origin');const files=path.resolve(process.env.FILE_STORAGE_DIR||'.data/files');for(const publicRoot of [path.resolve('public'),path.resolve('dist')])if(files===publicRoot||files.startsWith(publicRoot+path.sep))throw Error('Private files must not be inside public or dist');const port=Number(process.env.PORT||8780);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT');if(production&&u.protocol!=='https:')throw Error('Production requires HTTPS PUBLIC_ORIGIN');
 return {production,origin:u.origin,databaseUrl:process.env.DATABASE_URL,secret:process.env.SESSION_SECRET,port,host:process.env.HOST||'127.0.0.1',files,dist:path.resolve('dist'),trustProxy:process.env.TRUST_PROXY==='1'};
}
