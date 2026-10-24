"""Generate fictional OCR PDFs; requires reportlab and pypdf, not a runtime dependency."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader, PdfWriter

root = Path(__file__).resolve().parent.parent
fixtures = root / 'e2e/fixtures'
fixtures.mkdir(exist_ok=True)
sample = root / 'public/samples/demo-invoice.pdf'
c = canvas.Canvas(str(sample), pagesize=(800, 600), invariant=1)
c.setFont('Helvetica', 24)
c.drawString(60, 480, 'QINGBAO / FICTIONAL PDF SAMPLE')
c.setFont('Helvetica', 18)
c.drawString(60, 420, 'Page 1: cover only. Invoice is on page 2.')
c.drawString(60, 380, 'No real invoice, transaction or tax verification.')
c.showPage()
image = ImageReader(root / 'public/samples/structured-invoice.png')
w, h = image.getSize()
c.setPageSize((w / 2, h / 2))
c.drawImage(image, 0, 0, width=w / 2, height=h / 2)
c.showPage()
c.save()

text_pdf = fixtures / 'electronic-invoice.pdf'
c = canvas.Canvas(str(text_pdf), pagesize=(800, 600), invariant=1)
for i, text in enumerate([
    'DEMO ONLY - FICTIONAL ELECTRONIC INVOICE',
    'Invoice No: 32345678901234567890',
    'Invoice Date: 2026-10-24',
    'Buyer Name: DEMOBUYER',
    'Seller Name: DEMOSELLER',
    'Net Amount: 100.00',
    'Tax Amount: 6.00',
    'TOTAL: 106.00',
]):
    c.setFont('Helvetica', 24)
    c.drawString(40, 550 - i * 60, text)
c.showPage()
c.save()
writer = PdfWriter()
writer.add_page(PdfReader(text_pdf).pages[0])
writer.encrypt('qingbao-fictional-password')
writer.write(fixtures / 'encrypted-invoice.pdf')
writer = PdfWriter()
for _ in range(21): writer.add_blank_page(width=800, height=600)
writer.write(fixtures / 'over-page-limit.pdf')
print('Created fictional scanned/text/encrypted/21-page PDF fixtures')
