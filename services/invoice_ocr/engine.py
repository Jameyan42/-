"""Pretrained open-source engines. No training and no invoice field guessing."""
import os
from pathlib import Path

def create_engine(backend='rapidocr', model_root=None):
    if backend == 'rapidocr':
        import onnxruntime
        onnxruntime.disable_telemetry_events()
        from rapidocr_onnxruntime import RapidOCR
        engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=2)
        def predict(image):
            result, _ = engine(image)
            return [{'text': text, 'score': float(score), 'box': box} for box, text, score in (result or [])]
        return predict, 'RapidOCR 1.4.4 / PP-OCRv4 ONNX / CPU'
    if backend == 'paddle':
        root = Path(model_root or '')
        names = ['PP-OCRv5_mobile_det', 'PP-OCRv5_mobile_rec']
        if not model_root or any(not (root / name / 'inference.pdiparams').is_file() for name in names):
            raise ValueError('PaddleOCR 3.x需要先准备官方模型目录，不在识别请求期间自动联网下载')
        os.environ.setdefault('PADDLE_PDX_CACHE_HOME', str(Path(__file__).resolve().parents[2] / '.ocr-cache'))
        os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'
        from paddleocr import PaddleOCR
        engine = PaddleOCR(device='cpu', text_detection_model_name=names[0], text_recognition_model_name=names[1],
                           text_detection_model_dir=str(root/names[0]), text_recognition_model_dir=str(root/names[1]),
                           use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False,
                           cpu_threads=2, enable_mkldnn=False)
        def predict(image):
            # Paddle 3.x accepts decoded arrays, unlike RapidOCR's bytes API.
            if isinstance(image, (bytes, bytearray)):
                import cv2
                import numpy as np
                image = cv2.imdecode(np.frombuffer(image, dtype=np.uint8), cv2.IMREAD_COLOR)
                if image is None: raise ValueError('图片解码失败')
            rows=[]
            for result in engine.predict(image):
                # PaddleOCR 3.x result dictionary, not obsolete .ocr(..., cls=True).
                data = result.json.get('res', result.json)
                for text, score, box in zip(data['rec_texts'], data['rec_scores'], data['rec_polys']):
                    rows.append({'text':str(text),'score':float(score),'box':box.tolist() if hasattr(box,'tolist') else box})
            return rows
        return predict, 'PaddleOCR 3.4.0 / PP-OCRv5 mobile / CPU (optional)'
    raise ValueError('不支持的识别引擎')
