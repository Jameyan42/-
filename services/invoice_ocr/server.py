"""R010 loopback-only CPU OCR; in-memory image bytes, no invoice logs or persistence."""
import argparse
import base64
import io
import json
import math
import threading
import time
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote,urlsplit
from PIL import Image,UnidentifiedImageError
from engine import create_engine
MAX_BODY=9*1024*1024
MAX_IMAGE=6*1024*1024

def recognize(predict,data):
    if not data or len(data)>MAX_IMAGE: raise ValueError('图片大小无效')
    with Image.open(io.BytesIO(data)) as image:
        if image.format not in ('PNG','JPEG','WEBP') or image.width*image.height>10_000_000:raise ValueError('图片类型或像素超限')
        image.verify()
    started=time.perf_counter();rows=predict(data)
    if len(rows)>1000:raise ValueError('文字条目过多')
    for row in rows:
        if not isinstance(row.get('text'),str) or len(row['text'])>3000 or not math.isfinite(row['score']) or not 0<=row['score']<=1:raise ValueError('引擎返回无效')
    return {'schema':1,'lines':rows,'elapsedMs':round((time.perf_counter()-started)*1000),'verification':'NOT_TAX_VERIFIED'}

def handler_class(root,predict,engine_name,port):
    lock=threading.Lock();root=root.resolve()
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self,*a,**kw):super().__init__(*a,directory=str(root),**kw)
        def log_message(self,*_):pass
        def valid_host(self):return self.headers.get('Host') in (f'127.0.0.1:{port}',f'localhost:{port}')
        def send_json(self,code,value):
            body=json.dumps(value,ensure_ascii=False).encode();self.send_response(code);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.wfile.write(body)
        def do_GET(self):
            if not self.valid_host():return self.send_json(403,{'error':'仅允许本机访问'})
            path=urlsplit(self.path).path
            if path=='/api/r010/health':return self.send_json(200,{'schema':1,'engine':engine_name,'localOnly':True,'taxVerified':False})
            # Do not expose source, virtualenvs, caches, paths outside the built static app, or directory listings.
            target=(root/unquote(path).lstrip('/')).resolve()
            if not target.is_relative_to(root):return self.send_json(403,{'error':'路径无效'})
            if path in ('/','/index.html'):
                body=(root/'index.html').read_text().replace('<head>','<head><script>window.QINGBAO_R010_LOCAL=true;</script>',1).encode()
                self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();return self.wfile.write(body)
            if not target.is_file():return self.send_json(404,{'error':'文件不存在'})
            return super().do_GET()
        def do_POST(self):
            if not self.valid_host() or self.headers.get('Origin')!=f'http://{self.headers.get("Host")}' or self.path!='/api/r010/ocr':return self.send_json(403,{'error':'仅接受本机同源识别请求'})
            if self.headers.get_content_type()!='application/json':return self.send_json(415,{'error':'格式错误'})
            acquired=False
            try:
                size=int(self.headers.get('Content-Length','0'))
                if size<=0 or size>MAX_BODY:return self.send_json(413,{'error':'请求过大'})
                self.connection.settimeout(15)
                payload=json.loads(self.rfile.read(size))
                if not isinstance(payload,dict) or set(payload)!={'image'}:raise ValueError('格式无效')
                data=base64.b64decode(payload['image'],validate=True)
                acquired=lock.acquire(blocking=False)
                if not acquired:return self.send_json(429,{'error':'本机正在识别，请稍后重试'})
                result=recognize(predict,data);result['engine']=engine_name;return self.send_json(200,result)
            except (ValueError,KeyError,TypeError,OSError,UnidentifiedImageError):return self.send_json(400,{'error':'无法读取图片，请检查文件、格式或大小'})
            except Exception:return self.send_json(500,{'error':'本地OCR执行失败，可重试或手工填写'})
            finally:
                if acquired:lock.release()
    return Handler

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--port',type=int,default=8766);parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[2]/'dist');parser.add_argument('--engine',choices=['rapidocr','paddle'],default='rapidocr');parser.add_argument('--model-root',type=Path);args=parser.parse_args()
    if not (args.root/'index.html').is_file():raise SystemExit('请先在项目根目录执行 npm run build')
    predict,name=create_engine(args.engine,args.model_root)
    server=ThreadingHTTPServer(('127.0.0.1',args.port),handler_class(args.root,predict,name,args.port));server.daemon_threads=True
    print(f'R010本机CPU OCR就绪 http://127.0.0.1:{args.port} / {name}',flush=True);server.serve_forever()
if __name__=='__main__':main()
