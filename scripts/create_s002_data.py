"""Fictional facts only. No gold labels and no invocation of audit functions."""
import argparse,csv,json,random
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--split',choices=['DEV','HOLDOUT'],required=True);a=p.parse_args()
path=Path('docs/s002/development-facts.json' if a.split=='DEV' else 'docs/s002/holdout-facts.json')
if path.exists():raise SystemExit('事实文件已存在，不覆盖；独立集不能用于逐条调参')
if a.split=='HOLDOUT' and (not Path('docs/s002/freeze.json').is_file() or json.loads(Path('docs/s002/freeze.json').read_text()).get('status')!='FROZEN'):raise SystemExit('必须先冻结规则与分流代码')
rng=random.Random(112205 if a.split=='DEV' else 995173);count=40 if a.split=='DEV' else 20;start=1 if a.split=='DEV' else 41
cols=['caseId','split','group','reimbursementId','employee','companyId','grade','city','checkIn','checkOut','hotelAmountYuan','amountYuan','invoiceAmounts','invoiceNumbers','description','partialReason','currency','status']
rows=[]
for i in range(count):
 n=i+start;city=['深圳','北京','上海','东莞','成都'][i%5];grade=['普通员工','部门经理','高级管理人员'][(i//5)%3];rate={'深圳':[500,700,1000],'北京':[600,800,1200],'上海':[600,800,1200],'东莞':[350,500,800],'成都':[400,600,900]}[city][['普通员工','部门经理','高级管理人员'].index(grade)]
 nights=[1,2,3,4][i%4];amount=rate*nights*100-rng.randrange(1,80)*100;invoice=amount;note='虚构客户走访住宿，测试数据';reason='';month=10;day=12
 kind=i%20 if a.split=='DEV' else (i*7+3)%20
 if kind in (1,2,3):amount=rate*nights*100+[1,100,15000][kind-1];invoice=amount
 if kind==4:amount=rate*nights*100;invoice=amount
 if kind==5:invoice=amount+20000
 if kind==6:invoice=amount+10000;reason='本次按个人承担部分扣减后报销，待财务核实'
 if kind==7:invoice=amount-10000
 if kind==8:grade=''
 if kind==9:city=''
 if kind==10:city='模拟未配置城'
 if kind==11:invoice=None
 if kind==12:day=30;nights=3
 if kind==13:note='会议变更导致住宿用途待核实；无可用例外授权制度'
 if kind==14:amount=-100;invoice=100
 if kind==15:grade='测试未知职级'
 if kind==16:invoice=amount-1;city='模拟未配置城'
 if kind==17:amount=rate*nights*100+10000;invoice=amount-100
 if kind==18:note='拆分为两张虚构发票'
 from datetime import date,timedelta
 checkin=date(2026,month,day);checkout=checkin+timedelta(days=nights)
 values={'caseId':f'S002-{n:03d}','split':a.split,'group':'A' if (i%2)^(i//20%2)==0 else 'B','reimbursementId':f'EXP-S002-{n:03d}','employee':f'模拟员工{n:03d}','companyId':['SZ','DG','SH'][i%3],'grade':grade,'city':city,'checkIn':checkin.isoformat(),'checkOut':checkout.isoformat(),'hotelAmountYuan':f'{amount/100:.2f}','amountYuan':f'{amount/100:.2f}','invoiceAmounts':'' if invoice is None else f'{invoice/100:.2f}','invoiceNumbers':f'8800000000000000{n:04d}','description':note,'partialReason':reason,'currency':'CNY','status':'测试草稿'}
 if kind==0 and i>=20:values['currency']='USD'
 if kind==13:values['checkOut']=values['checkIn']
 if kind==18:values['invoiceAmounts']=f'{invoice//2/100:.2f}|{(invoice-invoice//2)/100:.2f}';values['invoiceNumbers']+='|'+f'8900000000000000{n:04d}'
 if kind==19:values['invoiceNumbers']=f'8800000000000000{n-1:04d}'
 if a.split=='DEV' and i==33:values['checkIn']='2026-10'
 if a.split=='DEV' and i==34:values['amountYuan']='12.345';values['hotelAmountYuan']='12.345'
 rows.append(values)
path.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
allrows=json.loads(Path('docs/s002/development-facts.json').read_text())
if Path('docs/s002/holdout-facts.json').exists():allrows+=json.loads(Path('docs/s002/holdout-facts.json').read_text())
for target in [Path('S002_TEST_DATA.csv'),Path('public/samples/s002/S002_TEST_DATA.csv')]:
 with target.open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=cols);w.writeheader();w.writerows(allrows)
for target in [Path('S002_GOLD_LABEL_TEMPLATE.csv'),Path('public/samples/s002/S002_GOLD_LABEL_TEMPLATE.csv')]:
 with target.open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f);w.writerow(['caseId','reimbursementId','manualLabel','riskCategory','evidence','annotator','annotationTime','confirmed']);w.writerows([[r['caseId'],r['reimbursementId'],'','','','','','false'] for r in allrows])
print('Created fictional facts',a.split,len(rows),'Total',len(allrows),'Confirmed gold labels: 0')
