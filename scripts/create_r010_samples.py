"""Generate ONLY fictional non-tax documents, with independently stored ground truth."""
import json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageFilter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
OUT=Path('public/samples/r010');OUT.mkdir(parents=True,exist_ok=True)
FONT='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
font=ImageFont.truetype(FONT,30)
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
cases=[]
for n in range(1,13):
    paper=n in (3,6,9);special=n in (2,5,8,11)
    title='增值税专用发票' if paper else '电子发票（专用发票）' if special else '电子发票（普通发票）'
    expected={'type':'纸质发票' if paper else '数电发票','number':f'{n:08d}' if paper else f'00000000000000000{n:03d}','code':'044001900111' if paper else '', 'date':f'2026-10-{n+1:02d}','buyerName':'模拟星河科技有限公司','buyerTaxId':'DEMO-BUYER-001','sellerName':'模拟远帆酒店有限公司','sellerTaxId':'DEMO-SELLER-001','netAmount':'1000.00','taxAmount':'60.00','amount':'1060.00','itemName':'住宿服务 酒店住宿'}
    if n==10:expected['buyerTaxId']=''
    if n==11:expected['netAmount']='';expected['taxAmount']=''
    lines=[(50,45,title),(50,105,'发票号码：'+expected['number']),(50,155,'开票日期：'+expected['date'])]
    if paper:lines.append((720,105,'发票代码：'+expected['code']))
    if n in (5,6):
        # realistic side-by-side party blocks, using coordinate evidence
        lines += [(50,230,'购买方'),(770,230,'销售方'),(50,285,'名称：'+expected['buyerName']),(770,285,'名称：'+expected['sellerName']),(50,340,'税号：'+expected['buyerTaxId']),(770,340,'税号：'+expected['sellerTaxId'])]
    elif n==7:
        lines += [(50,230,'购买方'),(50,285,'名称：'+expected['buyerName']),(50,340,'税号：'+expected['buyerTaxId']),(50,405,'销售方'),(50,460,'名称：'+expected['sellerName']),(50,515,'税号：'+expected['sellerTaxId'])]
    else:
        lines += [(50,235,'购买方名称：'+expected['buyerName']),(50,285,'购买方税号：'+expected['buyerTaxId']),(50,365,'销售方名称：'+expected['sellerName']),(50,415,'销售方税号：'+expected['sellerTaxId'])]
    lines += [(50,590,'项目名称：*住宿服务*酒店住宿')]
    if expected['netAmount']:lines.append((50,655,'不含税金额：'+expected['netAmount']))
    if expected['taxAmount']:lines.append((800,655,'税额：'+expected['taxAmount']))
    lines += [(50,725,'价税合计（小写）：'+expected['amount']),(50,840,'虚构样票 / DEMO ONLY / 非税务票据'),(50,900,'仅用于软件测试，不可报销，不含真实企业或个人数据')]
    img=Image.new('RGB',(1520,980),'white');draw=ImageDraw.Draw(img)
    for x,y,text in lines:draw.text((x,y),text,font=font,fill='#172b4d')
    fmt='png';mode='清晰图片'
    if n in (2,3):
        fmt='pdf';mode='PDF文字层'
        c=canvas.Canvas(str(OUT/f'{n:02d}.pdf'),pagesize=(1520,980));c.setFont('STSong-Light',30)
        for x,y,text in lines:c.drawString(x,980-y-32,text)
        c.save()
    elif n in (8,9):
        fmt='pdf';mode='扫描PDF';img.save(OUT/f'{n:02d}.pdf','PDF',resolution=100)
    else:
        if n in (4,6,12):fmt='jpg'
        if n==12:
            mode='模糊低分辨率照片';img=img.resize((760,490)).filter(ImageFilter.GaussianBlur(1.2)).resize((1520,980))
        img.save(OUT/f'{n:02d}.{fmt}',quality=85)
    cases.append({'id':f'R010-{n:02d}','file':f'samples/r010/{n:02d}.{fmt}','mode':mode,'expected':expected,'notes':'买方税号故意缺失' if n==10 else '不含税金额、税额故意缺失，禁止倒推' if n==11 else '模糊样票，允许明确识别失败，禁止虚构' if n==12 else '全部文字均为虚构，不代表合法税务票据'})
Path('docs/r010/samples.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2)+'\n')
