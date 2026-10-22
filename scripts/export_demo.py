"""Run after npm run build to produce a standalone HTML demonstration."""
from pathlib import Path
import re
root = Path(__file__).resolve().parent.parent
html = (root / 'dist/index.html').read_text()
html = re.sub(r'<script[^>]+src="([^"]+)"[^>]*></script>', lambda m: '<script type="module">' + (root / 'dist' / m[1].lstrip('/')).read_text().replace('</script', '<\\/script') + '</script>', html)
html = re.sub(r'<link[^>]+href="([^"]+\.css)"[^>]*>', lambda m: '<style>' + (root / 'dist' / m[1].lstrip('/')).read_text() + '</style>', html)
(root / 'deliverables').mkdir(exist_ok=True)
(root / 'deliverables/轻报演示.html').write_text(html)
print('Created deliverables/轻报演示.html')
