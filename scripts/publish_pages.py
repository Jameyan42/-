"""Publish the built standalone demo to the existing gh-pages branch.

Run npm run export:demo first. No checkout, force push, or repository settings changes.
"""
from pathlib import Path
import argparse
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def git(*args, input=None, env=None):
    return subprocess.check_output(
        ['git', '-C', str(ROOT), *args], input=input, env=env
    ).decode().strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    artifact = ROOT / 'deliverables/轻报演示.html'
    if not artifact.is_file():
        raise SystemExit('Run npm run export:demo first')
    if not args.publish:
        print('Ready to publish deliverables/轻报演示.html to origin gh-pages. Add --publish to execute.')
        return
    git('fetch', 'origin', 'refs/heads/gh-pages')
    parent = git('rev-parse', 'FETCH_HEAD')
    existing = set(git('ls-tree', '-r', '--name-only', parent).splitlines())
    if not {'.nojekyll','index.html'}.issubset(existing) or any(name not in {'.nojekyll','index.html'} and not name.startswith(('ocr/','samples/')) for name in existing):
        raise SystemExit('Unexpected files in gh-pages; inspect before replacing the site')
    fd, index = tempfile.mkstemp(prefix='qingbao-pages-index-', dir='/tmp')
    os.close(fd)
    os.unlink(index)
    env = {**os.environ, 'GIT_INDEX_FILE': index}
    try:
        git('read-tree', '--empty', env=env)
        blob = git('hash-object', '-w', str(artifact))
        empty = git('hash-object', '-w', '--stdin', input=b'')
        assets=[('index.html',blob),('.nojekyll',empty)]
        for folder in ['ocr','samples']:
            source=ROOT/'dist'/folder
            if not source.is_dir():
                raise SystemExit('Missing static assets; run npm run export:demo')
            for path in sorted(source.rglob('*')):
                if path.is_file():
                    assets.append((folder+'/'+path.relative_to(source).as_posix(),git('hash-object','-w',str(path))))
        for name, obj in assets:
            git('update-index', '--add', '--cacheinfo', f'100644,{obj},{name}', env=env)
        tree = git('write-tree', env=env)
        if tree == git('rev-parse', parent + '^{tree}'):
            print('Published site already matches this build')
            return
        commit = git('commit-tree', tree, '-p', parent, input=b'Update Qingbao online demo\n')
        subprocess.run(['git', '-C', str(ROOT), 'push', 'origin', commit + ':refs/heads/gh-pages'], check=True)
        print('Published gh-pages commit:', commit)
    finally:
        if os.path.exists(index):
            os.unlink(index)


if __name__ == '__main__':
    main()
