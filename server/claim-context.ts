import type {Express} from 'express';
import {z} from 'zod';
import {pool,tx,event,fail} from './db';

export function mountClaimContext(app:Express){
  app.get('/api/claim-context',async(req,res)=>{
    const result=await tx(async c=>{
      const u=(await c.query('SELECT u.id,u.name,u.employee_number,u.department_id,u.manager_id,u.grade,d.name department,m.name manager_name,m.active manager_active,m.roles manager_roles FROM users u LEFT JOIN departments d ON d.id=u.department_id LEFT JOIN users m ON m.id=u.manager_id WHERE u.id=$1',[req.actor.id])).rows[0];
      const company=(await c.query('SELECT id,name,policy_version,policy FROM company WHERE id=1')).rows[0];
      const finance=(await c.query("SELECT id,name FROM users WHERE active AND NOT must_change_password AND 'FINANCE'=ANY(roles) AND id<>$1 ORDER BY name",[u.id])).rows;
      const issues=[];
      if(!u.department_id)issues.push('未配置所属部门');
      if(!u.manager_id||u.manager_id===u.id||!u.manager_active||!u.manager_roles?.includes('MANAGER'))issues.push('未配置可用的直属主管，不能自我审批');
      if(!finance.length)issues.push('未配置可以处理本申请的有效财务人员');
      return {employee:u,company:{id:company.id,name:company.name},costDepartment:{id:u.department_id,name:u.department},approval:{id:'DIRECT_MANAGER_FINANCE',version:1,companyPolicyVersion:company.policy_version,manager:u.manager_name,finance:finance.map(f=>f.name),issues},accountVerification:company.policy.accountVerification||'UNCONFIGURED',withdrawAllowed:company.policy.allowManagerRecall===true};
    });res.json(result);
  });
  app.post('/api/claims/:id/withdraw',async(req,res)=>{
    const v=z.object({revision:z.number().int().positive(),reason:z.string().trim().min(1).max(500)}).strict().parse(req.body);
    await tx(async c=>{
      const claim=(await c.query('SELECT * FROM claims WHERE id=$1 AND owner_id=$2 FOR UPDATE',[z.uuid().parse(req.params.id),req.actor.id])).rows[0];
      if(!req.actor.roles.includes('EMPLOYEE')||!claim)fail(404,'本人报销单不存在');
      if(claim.status!=='MANAGER_PENDING'||claim.revision!==v.revision)fail(409,'单据已处理或版本变化，不能撤销');
      if(claim.policy_snapshot?.policy?.allowManagerRecall!==true)fail(409,'提交时公司制度未开放主管处理前撤销');
      if(claim.policy_snapshot.policy.releaseOnClose)await c.query('DELETE FROM invoice_occupancy WHERE claim_id=$1',[claim.id]);
      await c.query("UPDATE claims SET status='CANCELLED',updated_at=now() WHERE id=$1",[claim.id]);
      await event(c,req.actor,'WITHDRAW',v.reason,claim,{status:'MANAGER_PENDING'},{status:'CANCELLED'});
    });res.json({ok:true});
  });
}
