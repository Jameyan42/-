"""Export independent, fully bundled HTML pages using the existing Vite toolchain."""
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parent.parent
subprocess.run(['node', str(root / 'scripts/export_standalone.mjs')], cwd=root, check=True)
