"""Transport/security tests. Recognition accuracy is measured separately with real models."""
import base64,io,json,threading,unittest,urllib.request,urllib.error
from pathlib import Path
from http.server import ThreadingHTTPServer
from PIL import Image
from server import handler_class,recognize
class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.calls=0
        def predict(data):cls.calls+=1;return [] # Transport fixture, never an accuracy result.
        cls.http=ThreadingHTTPServer(('127.0.0.1',0),handler_class(Path('dist'),predict,'TEST-ONLY',0))
        port=cls.http.server_port;cls.http.RequestHandlerClass=handler_class(Path('dist'),predict,'TEST-ONLY',port)
        cls.url=f'http://127.0.0.1:{port}';cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):cls.http.shutdown();cls.http.server_close()
    def post(self,value,origin=True,host=None):
        headers={'Content-Type':'application/json'}
        if origin:headers['Origin']=self.url
        if host:headers['Host']=host
        req=urllib.request.Request(self.url+'/api/r010/ocr',json.dumps(value).encode(),headers)
        try:
            with urllib.request.urlopen(req) as r:return r.status,json.load(r)
        except urllib.error.HTTPError as e:return e.code,json.load(e)
    def test_origin_required(self):self.assertEqual(self.post({'image':''},False)[0],403)
    def test_dns_rebinding_host_blocked(self):self.assertEqual(self.post({'image':''},host='evil.example')[0],403)
    def test_bad_base64(self):self.assertEqual(self.post({'image':'%%%bad'})[0],400)
    def test_file_is_not_image(self):self.assertEqual(self.post({'image':base64.b64encode(b'%PDF-bad').decode()})[0],400)
    def test_unknown_parameters(self):self.assertEqual(self.post({'image':'','url':'https://example.com'})[0],400)
    def test_valid_transport(self):
        b=io.BytesIO();Image.new('RGB',(10,10),'white').save(b,'PNG');status,r=self.post({'image':base64.b64encode(b.getvalue()).decode()});self.assertEqual(status,200);self.assertEqual(r['verification'],'NOT_TAX_VERIFIED');self.assertEqual(r['engine'],'TEST-ONLY')
    def test_source_not_exposed(self):
        with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(self.url+'/services/invoice_ocr/server.py')
        self.assertEqual(e.exception.code,404)
    def test_traversal_blocked(self):
        with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(self.url+'/%2e%2e/package.json')
        self.assertEqual(e.exception.code,403)
if __name__=='__main__':unittest.main()
