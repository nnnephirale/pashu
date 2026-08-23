#!/usr/bin/env python3
"""Inline src/ + assets/ into a single self-contained index.html.

The app ships as one file that opens straight from the filesystem — no server,
no build step for the user. Assets go in as data URIs, which also keeps the
canvas untainted so getImageData (the paper sampler) and Save PNG both work
from file://.

    python3 build.py
"""
import base64, mimetypes, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))

# The session API always lives on the Worker; the app itself may be served from
# GitHub Pages, so both are absolute.
API_BASE = os.environ.get('PASHU_API_BASE', 'https://paper-image-shuffle.nnnephirale.workers.dev')
APP_BASE = os.environ.get('PASHU_APP_BASE', 'https://nnnephirale.github.io/pashu/')
SRC = os.path.join(ROOT, 'src')

MODULES = ['rng', 'controls', 'paper', 'folds', 'imperfections', 'session', 'app']
NS = {m: '__m_' + m for m in MODULES}

IMPORT_NAMED = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'\./(\w+)\.js';?\s*$", re.M)
IMPORT_STAR  = re.compile(r"^import\s*\*\s*as\s*(\w+)\s*from\s*'\./(\w+)\.js';?\s*$", re.M)
EXPORT_DECL  = re.compile(r"^export\s+(?:async\s+)?(?:function|const|let|var)\s+(\w+)", re.M)


def data_uri(path):
    mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    with open(path, 'rb') as f:
        return 'data:%s;base64,%s' % (mime, base64.b64encode(f.read()).decode())


def collect(dirname, pattern):
    files = sorted(
        (f for f in os.listdir(dirname) if pattern.match(f)),
        key=lambda f: int(pattern.match(f).group(1)))
    return [data_uri(os.path.join(dirname, f)) for f in files]


def bundle():
    """Concatenate the ES modules into one classic script.

    Each module becomes an IIFE returning its exports; importers destructure
    from that. Only the two import forms the source actually uses are handled —
    named and namespace — deliberately, so an unhandled form fails loudly
    rather than silently producing a broken bundle.
    """
    out = []
    for name in MODULES:
        body = open(os.path.join(SRC, name + '.js')).read()
        prelude = []

        for names, mod in IMPORT_NAMED.findall(body):
            names = ', '.join(n.strip() for n in names.split(',') if n.strip())
            prelude.append('const { %s } = %s;' % (names, NS[mod]))
        for alias, mod in IMPORT_STAR.findall(body):
            prelude.append('const %s = %s;' % (alias, NS[mod]))

        leftover = [l for l in body.splitlines()
                    if l.startswith('import ') and not (
                        IMPORT_NAMED.match(l) or IMPORT_STAR.match(l))]
        if leftover:
            sys.exit('build: unhandled import form in %s.js:\n  %s'
                     % (name, '\n  '.join(leftover)))

        exports = EXPORT_DECL.findall(body)
        body = IMPORT_NAMED.sub('', body)
        body = IMPORT_STAR.sub('', body)
        body = re.sub(r'^export\s+', '', body, flags=re.M)

        ret = '\nreturn { %s };' % ', '.join(exports) if exports else ''
        out.append('const %s = (function(){\n%s\n%s%s\n})();'
                   % (NS[name], '\n'.join(prelude), body, ret))
    return '\n\n'.join(out)


def main():
    js = bundle()

    demo = collect(os.path.join(ROOT, 'assets/demo'), re.compile(r'demo_(\d+)\.jpg$'))
    paper = collect(os.path.join(ROOT, 'assets/paper/web'), re.compile(r'paper_(\d+)\.jpg$'))
    if not demo or not paper:
        sys.exit('build: no assets found — run from the project root')

    def as_array(items):
        return '[\n' + ',\n'.join("'%s'" % s for s in items) + '\n]'

    js, n1 = re.subn(r'const DEMO = [^;]+;', 'const DEMO = %s;' % as_array(demo), js, count=1)
    js, n2 = re.subn(r'const PAPERS = [^;]+;', 'const PAPERS = %s;' % as_array(paper), js, count=1)
    if not (n1 and n2):
        sys.exit('build: could not find DEMO/PAPERS declarations to inline')

    import datetime
    stamp = datetime.datetime.now().strftime('%m%d-%H%M')
    js = js.replace('__BUILD__', stamp)
    js = js.replace('__API_BASE__', API_BASE).replace('__APP_BASE__', APP_BASE)

    css = open(os.path.join(SRC, 'app.css')).read()
    html = open(os.path.join(SRC, 'template.html')).read()
    html = html.replace('<link rel="stylesheet" href="css/app.css">',
                        '<style>\n%s\n</style>' % css)
    html = html.replace('<script type="module" src="js/app.js"></script>',
                        '<script>\n%s\n</script>' % js)
    if '<style>' not in html or '<script>' not in html:
        sys.exit('build: template markers not found')

    dest = os.path.join(ROOT, 'index.html')
    with open(dest, 'w') as f:
        f.write(html)

    # the Worker serves ./public as its static assets
    pub = os.path.join(ROOT, 'public')
    os.makedirs(pub, exist_ok=True)
    with open(os.path.join(pub, 'index.html'), 'w') as f:
        f.write(html)
    print('index.html  %.1f MB  (%d demo images, %d paper scans)'
          % (os.path.getsize(dest) / 1e6, len(demo), len(paper)))


if __name__ == '__main__':
    main()
