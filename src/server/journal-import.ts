import { Buffer } from 'node:buffer';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import TurndownService from 'turndown';
import { createDocument } from '@mixmark-io/domino';
import { unzipSync } from 'fflate';
import iconv from 'iconv-lite';
import { JournalError, storeImage, type JournalEnvironment } from './journal';

export async function boundedBytes(request: Request, maximum: number): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length')) > maximum) throw new JournalError(413,'large','上传文件过大。');
  const reader = request.body?.getReader();
  if (!reader) throw new JournalError(400,'file','没有读取到文件。');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {done,value} = await reader.read(); if (done) break;
      size += value.length;
      if (size > maximum) { await reader.cancel(); throw new JournalError(413,'large','文件过大，TXT 限 1 MB、DOC 限 2 MB、DOCX 限 8 MB。'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let position = 0;
  for (const chunk of chunks) { result.set(chunk,position); position += chunk.length; }
  return result;
}
export async function uploadedFile(request: Request) {
  const type = request.headers.get('content-type') || '';
  if (!type.startsWith('multipart/form-data;')) throw new JournalError(415,'file','请通过文件选择器上传。');
  const bytes = await boundedBytes(request, 8 * 1024 * 1024 + 32768);
  let form: FormData;
  try { form = await new Response(Uint8Array.from(bytes).buffer, {headers:{'Content-Type':type}}).formData(); }
  catch { throw new JournalError(400,'file','无法读取上传的文件。'); }
  const file = form.get('file');
  if (form.getAll('file').length !== 1 || !(file instanceof File) || !file.size) throw new JournalError(400,'file','请选择一个非空文件。');
  return { file, entryId: String(form.get('id') || '') };
}
function plainMarkdown(source: string) {
  return source.replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'')
    .split('\n').map(line => line.replace(/([\\`*_{}\[\]<>])/g,'\\$1').replace(/^(\s*)([#>+\-]|\d+[.)])(?=\s)/,'$1\\$2')).join('\n');
}
function decodeText(data: Uint8Array) {
  const buffer = Buffer.from(data);
  if (data[0]===255 && data[1]===254) return iconv.decode(buffer,'utf16-le');
  if (data[0]===254 && data[1]===255) return iconv.decode(buffer,'utf16-be');
  try { return new TextDecoder('utf-8',{fatal:true}).decode(data); }
  catch { return iconv.decode(buffer,'gb18030'); }
}
export async function importDocument(env: JournalEnvironment, entryId: string, file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const title = file.name.replace(/\.[^.]+$/,'').slice(0,120);
  const warnings: string[] = [];
  let content = '';
  if (!['txt','md','doc','docx'].includes(extension || '')) throw new JournalError(415,'file','请选择 TXT、Markdown、DOC 或 DOCX 文件。');
  const limit = extension === 'docx' ? 8*1024*1024 : extension === 'doc' ? 2*1024*1024 : 1024*1024;
  if (file.size > limit) throw new JournalError(413,'large','TXT 限 1 MB、DOC 限 2 MB、DOCX 限 8 MB。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (extension === 'txt' || extension === 'md') {
    const decoded = decodeText(bytes).replace(/^\uFEFF/,'');
    if (decoded.includes('\0')) throw new JournalError(400,'file','文件不是可识别的文本文件。');
    content = extension === 'md' ? decoded : plainMarkdown(decoded);
  } else if (extension === 'doc') {
    const buffer = Buffer.from(bytes);
    if (buffer.length < 512 || buffer.subarray(0,8).toString('hex') !== 'd0cf11e0a1b11ae1' || ![9,12].includes(buffer.readUInt16LE(30)) || buffer.readUInt16LE(32)!==6) throw new JournalError(400,'file','这不是有效的旧版 Word DOC 文件。');
    const sectors = Math.ceil(buffer.length / (1 << buffer.readUInt16LE(30)));
    if ([44,64,72].some(offset => buffer.readUInt32LE(offset)>sectors)) throw new JournalError(400,'file','DOC 文件结构无效。');
    try { const document = await new WordExtractor().extract(buffer); content = plainMarkdown(document.getBody()); }
    catch { throw new JournalError(422,'file','无法读取这个 DOC 文件，可能已损坏或加密。可以另存为 DOCX 后再试。'); }
    warnings.push('旧版 DOC 已提取正文；图片、表格和原始排版不保留，可在编辑器中补充或改用 DOCX 导入。');
  } else {
    let count = 0, total = 0, hasDocument = false;
    try {
      unzipSync(bytes,{filter: entry => {
        count++; total += entry.originalSize;
        if (entry.name === 'word/document.xml') hasDocument = true;
        if (count>500 || total>24*1024*1024 || entry.originalSize>12*1024*1024) throw new Error('Expanded size exceeded');
        return false;
      }});
    } catch { throw new JournalError(422,'file','DOCX 压缩结构无效或展开后过大。'); }
    if (!hasDocument) throw new JournalError(400,'file','这不是可识别的 DOCX 文档。');
    try {
      const result = await mammoth.convertToHtml({buffer:Buffer.from(bytes),arrayBuffer:Uint8Array.from(bytes).buffer}, {
        externalFileAccess:false, includeEmbeddedStyleMap:false,
        convertImage:mammoth.images.imgElement(async image => {
          try { return {src:await storeImage(env,entryId,new Uint8Array(await image.readAsArrayBuffer()))}; }
          catch(error) { warnings.push(error instanceof JournalError ? error.message : '有一张图片未能导入，请手动补充。'); return {src:''}; }
        }),
      });
      const converter = new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced',bulletListMarker:'-'});
      // Preserve simple tables as HTML; the renderer applies a strict allowlist.
      converter.keep(['table','thead','tbody','tr','th','td','sup','sub']);
      converter.remove(['script','style','iframe','object']);
      // Workers select Turndown's browser build, but have no browser document.
      // Pass a server-parsed DOM node instead of invoking its native DOMParser path.
      content = converter.turndown(createDocument(result.value).body);
      if (result.messages.length) warnings.push('文档中的部分特殊格式已简化，请在预览中检查。');
    } catch(error) {
      if (error instanceof JournalError) throw error;
      throw new JournalError(422,'file','DOCX 转换失败，文件可能已损坏或加密。');
    }
  }
  if (!content.trim()) throw new JournalError(422,'file','没有提取到正文，扫描图片文档暂不支持文字识别。');
  if ([...content].length>180000 || new TextEncoder().encode(content).length>650000) throw new JournalError(413,'large','转换后的正文过长，请分成几篇导入。');
  return { title, content, warnings:[...new Set(warnings)].slice(0,8) };
}
