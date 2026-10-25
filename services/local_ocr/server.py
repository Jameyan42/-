"""Loopback-only optional RapidOCR service. Serves the built app; no data persistence."""
import argparse
import base64
import io
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

MAX_BODY = 8 * 1024 * 1024


def recognize(engine, image_bytes):
    from PIL import Image
    with Image.open(io.BytesIO(image_bytes)) as im:
        if im.width * im.height > 10_000_000:
            raise ValueError('图片像素过大')
        im.verify()
    result, elapsed = engine(image_bytes)
    rows = [{'box': box, 'text': text, 'confidence': float(score)}
            for box, text, score in (result or [])]
    return {'text': '\n'.join(r['text'] for r in rows), 'lines': rows,
            'confidence': sum(r['confidence'] for r in rows) / max(1, len(rows)) * 100,
            'engine': 'RapidOCR ONNX 1.4.4', 'elapsed': elapsed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2] / 'dist')
    args = parser.parse_args()
    if not (args.root / 'index.html').is_file():
        raise SystemExit('请先在项目根目录执行 npm run build')
    import onnxruntime
    onnxruntime.disable_telemetry_events()
    from rapidocr_onnxruntime import RapidOCR
    engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=2)
    lock = threading.Lock()

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(args.root.resolve()), **kw)

        def log_message(self, *_):
            pass  # Do not log filenames, invoice text, or request bodies.

        def valid_host(self):
            return self.headers.get('Host') in (f'127.0.0.1:{args.port}', f'localhost:{args.port}')

        def send_json(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if not self.valid_host():
                return self.send_json(403, {'error': '仅允许本机访问'})
            path = urlsplit(self.path).path
            if path == '/api/ocr/health':
                return self.send_json(200, {'engine': 'RapidOCR ONNX 1.4.4', 'localOnly': True})
            if path in ('/', '/index.html'):
                text = (args.root / 'index.html').read_text()
                text = text.replace('<head>', '<head><script>window.QINGBAO_LOCAL_OCR=true;</script>', 1)
                body = text.encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                return self.wfile.write(body)
            super().do_GET()

        def do_POST(self):
            origin = self.headers.get('Origin')
            expected = f'http://{self.headers.get("Host")}'
            if not self.valid_host() or origin != expected or self.path != '/api/ocr':
                return self.send_json(403, {'error': '仅接受本机同源识别请求'})
            if self.headers.get_content_type() != 'application/json':
                return self.send_json(415, {'error': '请求格式错误'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if size <= 0 or size > MAX_BODY:
                    return self.send_json(413, {'error': '图片过大'})
                payload = json.loads(self.rfile.read(size))
                image_bytes = base64.b64decode(payload['image'], validate=True)
                if not lock.acquire(blocking=False):
                    return self.send_json(429, {'error': '正在识别另一张发票，请稍后重试'})
                try:
                    output = recognize(engine, image_bytes)
                finally:
                    lock.release()
                self.send_json(200, output)
            except (ValueError, KeyError, TypeError, OSError):
                self.send_json(400, {'error': '无法读取图片，请检查文件后重试'})
            except Exception:
                self.send_json(500, {'error': '本地OCR执行失败，可手工填写或重启服务'})

    print(f'本机RapidOCR已就绪：http://127.0.0.1:{args.port} （Ctrl+C停止）', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
