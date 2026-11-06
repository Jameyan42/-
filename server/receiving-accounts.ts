import type {Express, RequestHandler} from 'express';
import type {PoolClient} from 'pg';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import argon2 from 'argon2';
import {z} from 'zod';
import {rateLimit} from 'express-rate-limit';
import {pool,tx,event,fail} from './db';

function key():Buffer {
  const value=process.env.ACCOUNT_ENCRYPTION_KEY;
  if(!value||!(/^[a-fA-F0-9]{64}$/).test(value))fail(503,'尚未配置独立收款账户加密密钥，请联系管理员');
  return Buffer.from(value,'hex');
}
export function encryptAccount(number:string,owner:string):string {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
  cipher.setAAD(Buffer.from(owner));
  const encrypted=Buffer.concat([cipher.update(number,'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),encrypted].map(b=>b.toString('base64')).join('.');
}
export function decryptAccount(value:string,owner:string):string {
  const [iv,tag,encrypted]=value.split('.').map(x=>Buffer.from(x,'base64'));
  const cipher=createDecipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(owner));cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted),cipher.final()]).toString('utf8');
}
const safeColumns='id,owner_id,holder_name,bank_name,last_four,status,verified_at,created_at';
export async function receivingSnapshot(c:PoolClient,id:string,ownerId:string){
  const result=await c.query(`SELECT ${safeColumns} FROM employee_receiving_accounts WHERE id=$1 AND owner_id=$2 AND status='VALID' FOR SHARE`,[id,ownerId]);
  if(!result.rowCount)fail(400,'receivingAccountId：收款账户无效、待验证或不属于本人');
  return result.rows[0];
}
export function mountReceivingAccounts(app:Express,admin:RequestHandler){
  app.get('/api/receiving-accounts',async(req,res)=>{
    res.json({accounts:(await pool.query(`SELECT ${safeColumns} FROM employee_receiving_accounts WHERE owner_id=$1 ORDER BY created_at DESC,id`,[req.actor.id])).rows});
  });
  app.post('/api/receiving-accounts',rateLimit({windowMs:15*60*1000,limit:10,skipSuccessfulRequests:true,standardHeaders:'draft-7',legacyHeaders:false,handler:(_req,res)=>{res.status(429).json({error:'收款账户维护失败尝试过多，请稍后重试'});}}),async(req,res)=>{
    if(!req.actor.roles.includes('EMPLOYEE'))fail(403,'需要员工身份');
    const v=z.object({bankName:z.string().trim().min(1).max(100),number:z.string().regex(/^\d{12,24}$/),password:z.string().max(128)}).strict().parse(req.body);
    if(!await argon2.verify(req.actor.password_hash,v.password))fail(403,'请使用本人当前密码确认账户维护');
    const encrypted=encryptAccount(v.number,req.actor.id),id=randomUUID();
    await tx(async c=>{
      await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[req.actor.id]);
      const count=await c.query("SELECT count(*) FROM employee_receiving_accounts WHERE owner_id=$1 AND status<>'INACTIVE'",[req.actor.id]);
      if(Number(count.rows[0].count)>=10)fail(400,'最多保留10个未停用账户');
      await c.query('INSERT INTO employee_receiving_accounts(id,owner_id,holder_name,bank_name,encrypted_number,last_four) VALUES($1,$2,$3,$4,$5,$6)',[id,req.actor.id,req.actor.name,v.bankName,encrypted,v.number.slice(-4)]);
      await event(c,req.actor,'ACCOUNT_ADDED','本人密码确认后登记待验证收款账户',null,null,{id,bank:v.bankName,lastFour:v.number.slice(-4),status:'PENDING'});
    });res.status(201).json({id,status:'PENDING'});
  });
  app.post('/api/receiving-accounts/:id/deactivate',async(req,res)=>{
    const v=z.object({reason:z.string().trim().min(1).max(500)}).strict().parse(req.body),id=z.uuid().parse(req.params.id);
    await tx(async c=>{
      const r=await c.query('SELECT id FROM employee_receiving_accounts WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,req.actor.id]);
      if(!r.rowCount)fail(404,'本人账户不存在');
      await c.query("UPDATE employee_receiving_accounts SET status='INACTIVE' WHERE id=$1",[id]);
      await event(c,req.actor,'ACCOUNT_DEACTIVATED',v.reason,null,null,{id});
    });res.json({ok:true});
  });
  app.get('/api/finance/receiving-accounts',async(req,res)=>{
    if(!req.actor.roles.includes('FINANCE'))fail(403,'需要财务权限');
    res.json({accounts:(await pool.query(`SELECT a.id,a.owner_id,a.holder_name,a.bank_name,a.last_four,a.status,a.created_at FROM employee_receiving_accounts a JOIN users u ON u.id=a.owner_id WHERE u.active AND a.status='PENDING' AND a.owner_id<>$1 ORDER BY a.created_at`,[req.actor.id])).rows});
  });
  app.post('/api/finance/receiving-accounts/:id/verify',async(req,res)=>{
    if(!req.actor.roles.includes('FINANCE'))fail(403,'需要财务权限');
    const v=z.object({reason:z.string().trim().min(1).max(500),confirmed:z.literal(true)}).strict().parse(req.body),id=z.uuid().parse(req.params.id);
    await tx(async c=>{
      const co=await c.query('SELECT policy FROM company WHERE id=1 FOR SHARE');
      if(co.rows[0].policy.accountVerification!=='OFFLINE_FINANCE')fail(409,'公司尚未批准线下财务核对收款账户制度');
      const r=await c.query('SELECT a.*,u.active FROM employee_receiving_accounts a JOIN users u ON u.id=a.owner_id WHERE a.id=$1 FOR UPDATE OF a',[id]),a=r.rows[0];
      if(!a||a.owner_id===req.actor.id||!a.active)fail(403,'不能验证本人账户或无效员工账户');
      if(a.status!=='PENDING')fail(409,'账户已处理，请刷新');
      await c.query("UPDATE employee_receiving_accounts SET status='VALID',verified_by=$2,verification_reason=$3,verified_at=now() WHERE id=$1",[id,req.actor.id,v.reason]);
      await event(c,{...req.actor,roles:['FINANCE']},'ACCOUNT_VERIFIED',v.reason,null,null,{id,method:'OFFLINE_FINANCE',lastFour:a.last_four});
    });res.json({ok:true});
  });
  app.post('/api/claims/:id/return-for-account',async(req,res)=>{
    if(!req.actor.roles.includes('FINANCE'))fail(403,'需要财务权限');
    const v=z.object({revision:z.number().int().positive(),reason:z.string().trim().min(1).max(500),confirmedUnpaid:z.literal(true)}).strict().parse(req.body);
    await tx(async c=>{
      const claim=(await c.query('SELECT * FROM claims WHERE id=$1 FOR UPDATE',[z.uuid().parse(req.params.id)])).rows[0];
      if(!claim||claim.owner_id===req.actor.id||claim.payload.modelVersion!==2||claim.status!=='AWAITING_PAYMENT'||claim.revision!==v.revision)fail(409,'只能处理非本人、当前版本尚未付款的新版待付款单');
      if((await c.query('SELECT 1 FROM payments WHERE claim_id=$1',[claim.id])).rowCount)fail(409,'已有实际付款登记，不能退回改账号');
      await c.query("UPDATE claims SET status='RETURNED',updated_at=now() WHERE id=$1",[claim.id]);
      await event(c,{...req.actor,roles:['FINANCE']},'RETURN_FOR_ACCOUNT',v.reason,claim,{status:'AWAITING_PAYMENT',receivingAccountId:claim.payload.receivingSnapshot?.id},{status:'RETURNED',confirmedUnpaid:true,requiresFullReapproval:true});
    });res.json({ok:true});
  });
  // Explicit, audited access; no full account is returned in ordinary claim details, logs or CSV.
  app.post('/api/claims/:id/receiving-account/reveal',async(req,res)=>{
    if(!req.actor.roles.includes('FINANCE'))fail(403,'需要财务权限');
    const v=z.object({reason:z.string().trim().min(1).max(500)}).strict().parse(req.body);
    const number=await tx(async c=>{
      const r=await c.query("SELECT * FROM claims WHERE id=$1 AND status='AWAITING_PAYMENT' AND owner_id<>$2 FOR SHARE",[z.uuid().parse(req.params.id),req.actor.id]),claim=r.rows[0];
      if(!claim?.payload?.receivingSnapshot)fail(404,'无可访问的待付款收款快照');
      await receivingSnapshot(c,claim.payload.receivingSnapshot.id,claim.owner_id);
      const a=(await c.query('SELECT encrypted_number FROM employee_receiving_accounts WHERE id=$1',[claim.payload.receivingSnapshot.id])).rows[0];
      await event(c,{...req.actor,roles:['FINANCE']},'ACCOUNT_REVEALED',v.reason,claim,null,{accountId:claim.payload.receivingSnapshot.id});
      return decryptAccount(a.encrypted_number,claim.owner_id);
    });res.json({number});
  });
}
