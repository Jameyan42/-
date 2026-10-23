"""Reproduce the fictitious OCR fixture, never a tax invoice.
Requires Pillow and NotoSansCJK; the checked-in PNG is used by the site/tests.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parent.parent
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
image = Image.new('RGB', (1800, 1500), 'white')
draw = ImageDraw.Draw(image)
body, heading = ImageFont.truetype(FONT, 40), ImageFont.truetype(FONT, 55)
draw.text((80, 50), '结构化虚构样票 / DEMO ONLY', font=heading, fill='black')
lines = [
    '发票号码: 22345678901234567890', '发票代码: 123456789012',
    '开票日期: 2026-10-24', '购买方名称: 星河科技',
    '购买方税号: DEMO-BUYER-001', '销售方名称: 远帆服务有限公司',
    '销售方税号: DEMO-SELLER-001', '不含税金额: 250.00',
    '税额: 15.00', '价税合计: 265.00',
]
for index, line in enumerate(lines):
    draw.text((80, 160 + index * 105), line, font=body, fill='black')
image.save(ROOT / 'public/samples/structured-invoice.png')
