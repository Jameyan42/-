"""Run after npm run build to inline the two independent Vite entry pages."""
from pathlib import Path
import re
root = Path(__file__).resolve().parent.parent
(root / 'deliverables').mkdir(exist_ok=True)
for source, target in [('index.html', '轻报演示.html'), ('r001.html', 'r001-住宿审核.html')]:
    html = (root / 'dist' / source).read_text()
    html = re.sub(r'<script[^>]+src="([^"]+)"[^>]*></script>', lambda m: '<script type="module">' + (root / 'dist' / m[1].lstrip('/')).read_text().replace('</script', '<' + chr(92) + '/script') + '</script>', html)
    html = re.sub(r'<link[^>]+href="([^"]+\.css)"[^>]*>', lambda m: '<style>' + (root / 'dist' / m[1].lstrip('/')).read_text() + '</style>', html)
    (root / 'deliverables' / target).write_text(html)
    print('Created deliverables/' + target)
