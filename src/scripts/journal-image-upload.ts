import { MAX_IMAGE_BYTES, IMAGE_SIZE_LABEL, STATIC_IMAGE_TARGET_BYTES } from '../constants/journal-media';
const text=(data:Uint8Array,start:number,end:number)=>String.fromCharCode(...data.slice(start,end));

async function imageInfo(file:File):Promise<{mime:string;animated:boolean}>{
  // File.type can be empty or inaccurate in Android file pickers. Inspect the bytes.
  const head=new Uint8Array(await file.slice(0,32).arrayBuffer());
  if(/^GIF8[79]a$/.test(text(head,0,6)))return {mime:'image/gif',animated:true};
  if(text(head,0,4)==='RIFF'&&text(head,8,12)==='WEBP'){
    return {mime:'image/webp',animated:text(head,12,16)==='VP8X'&&!!(head[20]&2)};
  }
  if(head[0]===137&&text(head,1,4)==='PNG'&&head[4]===13&&head[5]===10&&head[6]===26&&head[7]===10){
    // APNG's acTL precedes IDAT. Skip ancillary data instead of decoding frames.
    let offset=8;
    for(let count=0;offset+8<=file.size&&count<512;count++){
      const bytes=new Uint8Array(await file.slice(offset,offset+8).arrayBuffer());
      const kind=text(bytes,4,8);
      if(kind==='acTL')return {mime:'image/png',animated:true};
      if(kind==='IDAT'||kind==='IEND')return {mime:'image/png',animated:false};
      const length=new DataView(bytes.buffer).getUint32(0);
      if(offset+length+12>file.size)break;
      offset+=length+12;
    }
    // An unusual PNG must not silently lose possible animation during compression.
    return {mime:'image/png',animated:true};
  }
  if(head[0]===255&&head[1]===216&&head[2]===255)return {mime:'image/jpeg',animated:false};
  throw new Error('图片仅支持 PNG、JPEG、GIF 或 WebP。');
}

export async function prepareJournalImage(file:File):Promise<File>{
  const info=await imageInfo(file);
  if(info.animated&&file.size>MAX_IMAGE_BYTES){
    throw new Error(`这张动图超过 ${IMAGE_SIZE_LABEL}。为保留动画不会转成静图，请先缩小动图文件后重新上传。`);
  }
  if(file.size<=STATIC_IMAGE_TARGET_BYTES||info.animated)return new File([file],file.name,{type:info.mime});
  const bitmap=await createImageBitmap(file);
  const scale=Math.min(1,1920/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d');if(!context){bitmap.close();return file;}
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  let blob:Blob|null=null;
  for(const quality of [.82,.65,.45]){
    blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',quality));
    if(blob&&blob.size<=STATIC_IMAGE_TARGET_BYTES)break;
  }
  return blob?new File([blob],file.name+'.webp',{type:blob.type}):file;
}
