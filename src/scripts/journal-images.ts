import { Compartment, EditorState, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, placeholder, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { parser } from '@lezer/markdown';

class ImageWidget extends WidgetType {
  constructor(readonly src:string, readonly alt:string) { super(); }
  eq(other:ImageWidget) { return this.src===other.src && this.alt===other.alt; }
  toDOM(view:EditorView) {
    const figure=document.createElement('figure');
    figure.className='journal-inline-image';
    const image=document.createElement('img');
    image.src=this.src;image.alt=this.alt;image.loading='lazy';image.decoding='async';
    const caption=document.createElement('figcaption');
    caption.textContent=this.alt || '正文图片';
    image.addEventListener('load',()=>view.requestMeasure());
    image.addEventListener('error',()=>{
      image.hidden=true;
      caption.textContent='图片暂时无法显示，可切换 Markdown 检查链接。';
      figure.classList.add('image-unavailable');view.requestMeasure();
    });
    figure.appendChild(image);figure.appendChild(caption);return figure;
  }
  ignoreEvent() { return true; }
}

// Parse Markdown so examples inside code blocks and escaped image syntax stay text.
function imageDecorations(state:EditorState):DecorationSet {
  const source=state.doc.toString(),ranges:ReturnType<Decoration['range']>[]=[];
  parser.parse(source).iterate({enter(node){
    if(node.name!=='Image')return;
    const urlNode=node.node.getChild('URL');
    if(!urlNode)return;
    const src=source.slice(urlNode.from,urlNode.to).replace(/^<|>$/g,'');
    // Match the public renderer: only uploaded journal images, never external URLs/HTML.
    if(!/^\/media\/journal\/[0-9a-f-]{36}$/.test(src))return;
    const raw=source.slice(node.from,node.to),alt=raw.slice(2,raw.indexOf(']')).replace(/\\([\[\]\\])/g,'$1');
    const line=state.doc.lineAt(node.from),endLine=state.doc.lineAt(node.to);
    const standalone=line.from===endLine.from && line.text.trim()===raw;
    const widget=new ImageWidget(src,alt);
    if(standalone)ranges.push(Decoration.replace({widget,block:true}).range(line.from,line.to));
    else ranges.push(Decoration.widget({widget,block:true,side:1}).range(endLine.to));
  }});
  return Decoration.set(ranges,true);
}

const images=StateField.define<DecorationSet>({
  create:imageDecorations,
  update(value,transaction){return transaction.docChanged?imageDecorations(transaction.state):value;},
  provide:field=>[
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of(view=>view.state.field(field)),
  ],
});

export function mountImageEditor(textarea:HTMLTextAreaElement,host:HTMLElement,mode:HTMLElement){
  const pictureMode=new Compartment(),editable=new Compartment();
  let visual=true;
  const view=new EditorView({
    parent:host,
    state:EditorState.create({doc:textarea.value,extensions:[
      history(),keymap.of([...defaultKeymap,...historyKeymap]),EditorView.lineWrapping,
      placeholder('写下今天想记住的事……'),
      EditorView.contentAttributes.of({'aria-label':'文章正文','aria-multiline':'true',spellcheck:'true',autocapitalize:'sentences'}),
      pictureMode.of(images),editable.of([]),
      EditorState.changeFilter.of(transaction=>!transaction.docChanged || textarea.maxLength<0 || transaction.newDoc.length<=textarea.maxLength),
      EditorView.updateListener.of(update=>{
        if(update.docChanged){
          textarea.value=update.state.doc.toString();
          textarea.dispatchEvent(new Event('input',{bubbles:true}));
        }
        if(update.selectionSet || update.docChanged){
          const selection=update.state.selection.main;
          textarea.setSelectionRange(selection.from,selection.to);
        }
      }),
    ]}),
  });
  textarea.hidden=true;host.hidden=false;mode.hidden=false;
  textarea.labels?.forEach(label=>label.addEventListener('click',event=>{event.preventDefault();view.focus();}));
  const buttons=mode.querySelectorAll<HTMLButtonElement>('[data-editor-mode]');
  buttons.forEach(button=>button.addEventListener('click',()=>{
    visual=button.dataset.editorMode==='images';
    view.dispatch({effects:pictureMode.reconfigure(visual?images:[])});
    buttons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    view.focus();
  }));
  // Keep the existing textarea as the canonical save/export value, including imports/recovery.
  return {
    sync(){
      if(textarea.value!==view.state.doc.toString())view.dispatch({changes:{from:0,to:view.state.doc.length,insert:textarea.value},selection:{anchor:0}});
    },
    insert(before:string,after:string,placeholderText:string){
      const selection=view.state.selection.main;
      const selected=view.state.sliceDoc(selection.from,selection.to)||placeholderText;
      const text=before+selected+after;
      view.dispatch({changes:{from:selection.from,to:selection.to,insert:text},selection:{anchor:selection.from+text.length},scrollIntoView:true,userEvent:'input'});
      view.focus();
    },
    setDisabled(disabled:boolean){
      view.dispatch({effects:editable.reconfigure([EditorState.readOnly.of(disabled),EditorView.editable.of(!disabled)])});
      host.setAttribute('aria-disabled',String(disabled));
    },
    destroy(){view.destroy();},
  };
}
