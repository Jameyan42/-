import {fileTypeFromBuffer} from 'file-type';import {XMLValidator} from 'fast-xml-parser';import yauzl from 'yauzl';
import {mkdir,writeFile,readFile} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
export const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
export async function inspectFile(data:Buffer,name:string){if(!data.length||data.length>10*1024*1024)throw Error('附件必须为1字节至10MB');const ext=path.extname(name).toLowerCase(),type=await fileTypeFromBuffer(data);
 if(ext==='.pdf'&&data.subarray(0,5).toString()==='%PDF-'&&data.subarray(-2048).includes(Buffer.from('%%EOF')))return 'application/pdf';
 if(['.jpg','.jpeg'].includes(ext)&&type?.mime==='image/jpeg')return type.mime;if(ext==='.png'&&type?.mime==='image/png')return type.mime;
 if(ext==='.xml'){const text=data.toString('utf8');if(/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(text)||XMLValidator.validate(text)!==true)throw Error('XML格式无效或含不允许的外部实体');return 'application/xml';}
 if(ext==='.ofd'&&type?.ext==='zip'){await new Promise<void>((resolve,reject)=>{yauzl.fromBuffer(data,{lazyEntries:true},(error,zip)=>{if(error||!zip)return reject(Error('OFD容器无效'));let total=0,count=0,root=false;zip.on('error',reject);zip.on('entry',e=>{count++;total+=e.uncompressedSize;if(count>500||total>40*1024*1024||e.fileName.includes('..')||e.fileName.startsWith('/')||e.generalPurposeBitFlag&1){zip.close();return reject(Error('OFD容器超限或路径无效'));}if(e.fileName==='OFD.xml')root=true;zip.readEntry();});zip.on('end',()=>root?resolve():reject(Error('OFD缺少根描述文件')));zip.readEntry();});});return 'application/ofd';}
 throw Error('文件扩展名与内容不匹配，仅支持PDF/JPG/PNG/XML/OFD');
}
export async function storeFile(dir:string,id:string,data:Buffer){await mkdir(dir,{recursive:true,mode:0o700});await writeFile(path.join(dir,id),data,{flag:'wx',mode:0o600});}
export async function verifiedFile(dir:string,id:string,hash:string){const data=await readFile(path.join(dir,id));if(sha(data)!==hash)throw Error('附件完整性检查失败');return data;}
