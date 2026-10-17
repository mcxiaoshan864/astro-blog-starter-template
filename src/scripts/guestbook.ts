type Entry = { id: number; nickname: string; message: string; reply: string; created_at: number; replied_at: number | null };
type Turnstile = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};
const text = {
  'zh-CN': {
    loading: '正在读取留言…', empty: '这里还很安静。留下一句问候，成为第一位来客吧。', failed: '暂时没有读到留言，请重试。',
    sending: '正在送出留言…', sent: '留言已送达，审核后会出现在这里。谢谢你来过。', verification: '验证未完成或已过期，请重新验证后再试。',
    widget: '验证暂时无法加载，请检查网络后重试。', retry: '重新加载验证', rate: '留言太快啦，请等一分钟再试。',
    unavailable: '留言暂时没能送达，内容已保留，请稍后重试。', invalid: '昵称请填 1–24 个字，留言请填 1–1000 个字。',
    reserved: '这个昵称留给站长使用，请换一个称呼。', owner: '站长回复', length: '留言最多 1000 个字。',
  },
  'zh-HK': {
    loading: '讀取緊留言…', empty: '呢度仲好靜。不如留句說話，做第一位訪客？', failed: '暫時讀唔到留言，請再試吓。',
    sending: '留言送出緊…', sent: '收到你嘅留言喇，審核後就會喺呢度見到。多謝你嚟過。', verification: '驗證未完成或者過咗期，請重新驗證再試。',
    widget: '暫時載入唔到驗證，請檢查網絡再試。', retry: '重新載入驗證', rate: '留得太快喇，等一分鐘再試吓。',
    unavailable: '暫時送唔到留言，內容仲喺度，請遲啲再試。', invalid: '稱呼請填 1–24 個字，留言請填 1–1000 個字。',
    reserved: '呢個稱呼留畀站長用，請改另一個。', owner: '站長回覆', length: '留言最多 1000 個字。',
  },
  en: {
    loading: 'Loading messages…', empty: 'It is quiet here. Leave a hello and be the first visitor.', failed: 'Messages could not be loaded. Please try again.',
    sending: 'Sending your note…', sent: 'Your note has arrived and will appear after review. Thanks for stopping by.', verification: 'Verification is incomplete or expired. Please verify again.',
    widget: 'Verification could not load. Check your connection and try again.', retry: 'Reload verification', rate: 'Please wait a minute before sending another note.',
    unavailable: 'Your note could not be sent. Your text is still here; please try again later.', invalid: 'Use 1–24 characters for your name and 1–1000 for your note.',
    reserved: 'That name is reserved for the site owner. Please choose another.', owner: 'Reply from the owner', length: 'Messages can contain up to 1000 characters.',
  },
};
type TextKey = keyof typeof text.en;
const api = () => (window as Window & { turnstile?: Turnstile }).turnstile;
let loadingWidget: Promise<Turnstile> | undefined;
function loadWidget(): Promise<Turnstile> {
  if (api()) return Promise.resolve(api()!);
  if (loadingWidget) return loadingWidget;
  loadingWidget = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => api() ? resolve(api()!) : reject(new Error('Widget unavailable'));
    script.onerror = () => { script.remove(); reject(new Error('Widget unavailable')); };
    document.head.appendChild(script);
  }).catch(error => { loadingWidget = undefined; throw error; });
  return loadingWidget;
}

let installed = false;
export function installGuestbook(): void {
  if (installed) return;
  installed = true;
  let active: { root: HTMLElement; dispose(): void; translate(): void } | undefined;
  const init = () => {
    const root = document.querySelector<HTMLElement>('#guestbook');
    if (root && active?.root === root) return;
    active?.dispose();
    active = root ? mount(root) : undefined;
  };
  document.addEventListener('astro:page-load', init);
  document.addEventListener('astro:before-swap', () => { active?.dispose(); active = undefined; });
  window.addEventListener('lang-changed', () => active?.translate());
  init();
}

function mount(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>('[data-guestbook-form]')!;
  const name = form.elements.namedItem('nickname') as HTMLInputElement;
  const message = form.elements.namedItem('message') as HTMLTextAreaElement;
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const status = root.querySelector<HTMLElement>('[data-form-status]')!;
  const listStatus = root.querySelector<HTMLElement>('[data-list-status]')!;
  // These nodes use dynamic translations instead of the site's static text translator.
  listStatus.removeAttribute('data-en'); listStatus.removeAttribute('data-tw');
  const list = root.querySelector<HTMLElement>('[data-message-list]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-load-more]')!;
  const retry = root.querySelector<HTMLButtonElement>('[data-retry]')!;
  const verification = root.querySelector<HTMLElement>('[data-verification]')!;
  const count = root.querySelector<HTMLElement>('#guest-count')!;
  const requests = new AbortController();
  let disposed = false, busy = false, listing = false, token = '', widgetId: string | undefined;
  let cursor: string | null = null;
  let entries: Entry[] = [];
  let statusKey: TextKey | undefined;
  let listKey: TextKey | undefined = 'loading';
  let widgetFailed = false;
  const words = () => text[document.documentElement.lang as keyof typeof text] || text['zh-CN'];
  const counter = () => {
    const length = [...message.value.normalize('NFC').trim()].length;
    count.textContent = `${length} / 1000`;
    count.classList.toggle('over', length > 1000);
    message.setCustomValidity(length > 1000 ? words().length : '');
    submit.disabled = busy || !token;
  };
  const tell = (key: TextKey, error = false) => {
    statusKey = key; status.textContent = words()[key]; status.dataset.error = String(error);
  };
  const element = (tag: string, className: string, value?: string) => {
    const node = document.createElement(tag); node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  };
  const render = () => {
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const article = element('article', 'visitor-note');
      const header = element('div', 'note-header');
      header.appendChild(element('span', 'note-name', entry.nickname));
      const time = document.createElement('time');
      time.dateTime = new Date(entry.created_at * 1000).toISOString();
      time.textContent = new Intl.DateTimeFormat(document.documentElement.lang, { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'short', day: 'numeric' }).format(entry.created_at * 1000);
      header.appendChild(time); article.appendChild(header); article.appendChild(element('p', 'note-content', entry.message));
      if (entry.reply) {
        const reply = element('div', 'owner-reply');
        reply.appendChild(element('span', 'reply-label', words().owner)); reply.appendChild(element('p', 'note-content', entry.reply));
        article.appendChild(reply);
      }
      fragment.append(article);
    }
    list.replaceChildren(fragment);
    listStatus.textContent = listKey ? words()[listKey] : '';
  };
  const load = async () => {
    if (listing || disposed) return;
    listing = true; more.disabled = true; retry.hidden = true; list.setAttribute('aria-busy', 'true');
    listKey = 'loading'; render();
    try {
      const result = await fetch(`/api/guestbook${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal: requests.signal, headers: { Accept: 'application/json' } });
      if (!result.ok) throw new Error('List unavailable');
      const data = await result.json() as { messages: Entry[]; nextCursor: string | null };
      if (disposed) return;
      const known = new Set(entries.map(entry => entry.id));
      entries.push(...data.messages.filter(entry => !known.has(entry.id)));
      cursor = data.nextCursor;
      more.hidden = !cursor;
      listKey = entries.length ? undefined : 'empty'; render();
    } catch {
      if (!disposed) { listKey = 'failed'; render(); retry.hidden = false; more.hidden = true; }
    } finally { listing = false; more.disabled = false; list.setAttribute('aria-busy', 'false'); }
  };
  const widgetError = () => {
    if (disposed) return;
    token = ''; counter(); widgetFailed = true; tell('widget', true);
    // A visible retry also covers third-party script/network failures.
    if (!verification.querySelector('button')) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button glass-control';
      button.textContent = words().retry; button.addEventListener('click', () => { void startWidget(); }, { once: true }); verification.appendChild(button);
    }
  };
  let widgetGeneration = 0;
  const startWidget = async () => {
    const generation = ++widgetGeneration;
    widgetFailed = false;
    token = ''; counter();
    if (widgetId !== undefined) { try { api()?.remove(widgetId); } catch {} widgetId = undefined; }
    verification.replaceChildren();
    try {
      const turnstile = await loadWidget();
      if (disposed || generation !== widgetGeneration) return;
      widgetId = turnstile.render(verification, {
        sitekey: root.dataset.sitekey, action: 'guestbook', theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        size: 'flexible',
        callback: (value: string) => { token = value; widgetFailed = false; counter(); if (statusKey === 'widget' || statusKey === 'verification') { statusKey = undefined; status.textContent = ''; } },
        'expired-callback': () => { token = ''; counter(); },
        'error-callback': () => { widgetError(); },
      });
    } catch { if (generation === widgetGeneration) widgetError(); }
  };
  let dark = document.documentElement.classList.contains('dark');
  const observer = new MutationObserver(() => {
    const next = document.documentElement.classList.contains('dark');
    if (dark !== next) { dark = next; if (!busy) void startWidget(); }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  message.addEventListener('input', counter);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || disposed) return;
    counter(); if (!form.reportValidity()) return;
    if (!token) { tell('verification', true); return; }
    if ([...name.value.normalize('NFC').trim()].length > 24) { tell('invalid', true); name.focus(); return; }
    busy = true; counter(); form.setAttribute('aria-busy', 'true'); tell('sending');
    try {
      const result = await fetch('/api/guestbook', { method: 'POST', signal: requests.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: name.value, message: message.value, token }) });
      if (disposed) return;
      const data = await result.json() as { error?: string };
      if (result.ok) { message.value = ''; tell('sent'); }
      else {
        const key: TextKey = ['verification','reserved','rate','invalid'].includes(data.error || '') ? data.error as TextKey : 'unavailable';
        tell(key, true);
      }
    } catch { if (!disposed) tell('unavailable', true); }
    finally {
      busy = false; token = ''; form.setAttribute('aria-busy', 'false'); counter();
      if (!disposed && widgetId !== undefined) { try { api()?.reset(widgetId); } catch { widgetError(); } }
    }
  });
  more.addEventListener('click', () => { void load(); });
  retry.addEventListener('click', () => { void load(); });
  void load(); void startWidget();
  return {
    root,
    translate() { counter(); if (statusKey) status.textContent = words()[statusKey]; if (widgetFailed) { const button = verification.querySelector('button'); if (button) button.textContent = words().retry; } render(); },
    dispose() { disposed = true; requests.abort(); observer.disconnect(); if (widgetId !== undefined) { try { api()?.remove(widgetId); } catch {} } },
  };
}
