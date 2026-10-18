import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { boundedText } from './guestbook';
import { sameOrigin } from './admin-auth';

export type JournalEnvironment = Partial<Pick<Cloudflare.Env, 'GUESTBOOK_DB'>>;
export interface Draft { title: string; description: string; author: string; date: string; content: string }
export interface Entry {
  id: string; slug: string; draft: string; published: string | null;
  status: 'draft' | 'published' | 'trash'; revision: number;
  created_at: number; saved_at: number; first_published_at: number | null; published_at: number | null;
}
export interface PublicEntry { id: string; data: { title: string; description: string; author: string; pubDate: Date; updatedDate?: Date }; content: string }
export class JournalError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export function database(env: JournalEnvironment) {
  if (!env.GUESTBOOK_DB) throw new JournalError(503, 'unavailable', '文章存储暂时不可用，请稍后重试。');
  return env.GUESTBOOK_DB;
}
export function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()); }
export function emptyDraft(): Draft { return { title: '', description: '', author: 'mcxiaoshan', date: today(), content: '' }; }
export async function getEntry(env: JournalEnvironment, id: string): Promise<Entry | null> {
  if (!validId(id)) return null;
  return database(env).prepare('SELECT * FROM journal_entries WHERE id = ?').bind(id).first<Entry>();
}
export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false, gfm: true }) as string;
  return sanitizeHtml(html, {
    allowedTags: ['p','br','h1','h2','h3','h4','h5','h6','strong','em','del','s','blockquote','ul','ol','li','a','img','pre','code','hr','table','thead','tbody','tr','th','td','sup','sub'],
    allowedAttributes: { a: ['href','title','rel'], img: ['src','alt','title','loading'], code: ['class'], ol:['start'], th:['colspan','rowspan'], td:['colspan','rowspan'] },
    allowedSchemes: ['http','https','mailto'], allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attributes) => ({ tagName: 'a', attribs: { ...attributes, rel: 'noopener noreferrer' } }),
      img: (_tag, attributes) => ({ tagName: 'img', attribs: { ...attributes, src: /^\/media\/journal\/[0-9a-f-]{36}$/.test(attributes.src || '') ? attributes.src : '', loading: 'lazy' } }),
    },
    exclusiveFilter: frame => frame.tag === 'img' && !frame.attribs.src,
  });
}
function validateDraft(value: unknown): Draft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new JournalError(400, 'invalid', '无法读取草稿。');
  const data = value as Record<string, unknown>;
  const limits = { title: 120, description: 300, author: 80, date: 10, content: 180000 };
  const result = {} as Draft;
  for (const key of Object.keys(limits) as (keyof Draft)[]) {
    const raw = data[key];
    if (typeof raw !== 'string' || [...raw].length > limits[key] || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) throw new JournalError(400, 'invalid', '内容格式不正确或超出长度限制。');
    result[key] = key === 'content' ? raw.replace(/\r\n?/g, '\n') : raw.trim();
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.date) || !Number.isFinite(Date.parse(result.date)) || new Date(result.date).toISOString().slice(0,10) !== result.date) throw new JournalError(400, 'invalid', '请选择有效的文章日期。');
  if (new TextEncoder().encode(JSON.stringify(result)).length > 700000) throw new JournalError(413, 'large', '文章过长，请分成几篇保存。');
  return result;
}
export async function readJournalJSON(request: Request): Promise<Record<string, unknown>> {
  if (!sameOrigin(request)) throw new JournalError(403, 'origin', '请求来源无效，请刷新页面后重试。');
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new JournalError(415, 'invalid', '请求格式无效。');
  try { const data = JSON.parse(await boundedText(request, 750000)); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
  catch { throw new JournalError(400, 'invalid', '无法读取文章内容，可能超出大小限制。'); }
}
export async function mutateEntry(env: JournalEnvironment, body: Record<string, unknown>) {
  const id = String(body.id || '');
  const revision = body.revision;
  if (!validId(id) || !Number.isSafeInteger(revision) || Number(revision) < 0) throw new JournalError(400, 'invalid', '文章标识或版本无效。');
  const db = database(env);
  const current = await getEntry(env, id);
  if (current ? current.revision !== revision : revision !== 0) throw new JournalError(409, 'conflict', '文章已在其他页面更新。本页内容已保留，请先导出草稿，再刷新核对。');
  const operation = body.operation;
  if (operation === 'save') {
    const draft = validateDraft(body.draft);
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) throw new JournalError(400, 'slug', '文章地址请使用小写字母、数字和单个连字符，最多 100 字符。');
    if (current?.status === 'trash') throw new JournalError(409, 'trash', '请先恢复这篇文章。');
    if (current?.first_published_at && current.slug !== slug) throw new JournalError(400, 'slug', '发布过的文章地址已固定，避免旧链接失效。');
    try {
      if (current) {
        const result = await db.prepare('UPDATE journal_entries SET slug = ?, draft = ?, revision = revision + 1, saved_at = unixepoch() WHERE id = ? AND revision = ?').bind(slug, JSON.stringify(draft), id, Number(revision)).run();
        if (!result.meta.changes) throw new JournalError(409, 'conflict', '文章已在其他页面更新，请先导出本页草稿。');
      } else {
        await db.prepare('INSERT INTO journal_entries (id, slug, draft) VALUES (?, ?, ?)').bind(id, slug, JSON.stringify(draft)).run();
      }
    } catch (error) {
      if (error instanceof JournalError) throw error;
      if (/UNIQUE|constraint/i.test(String(error))) throw new JournalError(409, 'slug', '这个文章地址已被使用，请换一个。');
      throw error;
    }
  } else {
    if (!current) throw new JournalError(404, 'missing', '文章不存在，请先保存草稿。');
    let sql: string;
    if (operation === 'publish') {
      const draft = validateDraft(JSON.parse(current.draft));
      if (!draft.title || !draft.content.trim()) throw new JournalError(400, 'empty', '发布前请填写标题和正文。');
      if (current.status === 'trash') throw new JournalError(409, 'trash', '请先恢复文章。');
      draft.description ||= sanitizeHtml(renderMarkdown(draft.content), {allowedTags:[],allowedAttributes:{}}).replace(/\s+/g,' ').trim().slice(0,160);
      draft.author ||= 'mcxiaoshan';
      const result = await db.prepare("UPDATE journal_entries SET published = ?, draft = ?, status = 'published', first_published_at = COALESCE(first_published_at,unixepoch()), published_at = unixepoch(), revision = revision + 1 WHERE id = ? AND revision = ?")
        .bind(JSON.stringify(draft), JSON.stringify(draft), id, Number(revision)).run();
      if (!result.meta.changes) throw new JournalError(409, 'conflict', '文章版本已改变，请刷新核对。');
      return getEntry(env, id);
    } else if (operation === 'unpublish' && current.status === 'published') sql = "UPDATE journal_entries SET status = 'draft', revision = revision + 1 WHERE id = ? AND revision = ?";
    else if (operation === 'trash') sql = "UPDATE journal_entries SET status = 'trash', revision = revision + 1 WHERE id = ? AND revision = ?";
    else if (operation === 'restore' && current.status === 'trash') sql = "UPDATE journal_entries SET status = 'draft', revision = revision + 1 WHERE id = ? AND revision = ?";
    else throw new JournalError(400, 'invalid', '未知操作。');
    const result = await db.prepare(sql).bind(id, Number(revision)).run();
    if (!result.meta.changes) throw new JournalError(409, 'conflict', '文章版本已改变，请刷新核对。');
  }
  return getEntry(env, id);
}
function toPublic(row: Entry): PublicEntry {
  const data = JSON.parse(row.published!) as Draft;
  return { id: row.slug, data: { title: data.title, description: data.description, author: data.author, pubDate: new Date(data.date + 'T00:00:00+08:00'), ...(row.published_at !== row.first_published_at ? {updatedDate:new Date(row.published_at! * 1000)} : {}) }, content: data.content };
}
export async function listPublicEntries(env: JournalEnvironment, page = 1) {
  const db = database(env);
  const count = await db.prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE status = 'published' AND published IS NOT NULL").first<{count:number}>();
  const rows = await db.prepare("SELECT * FROM journal_entries WHERE status = 'published' AND published IS NOT NULL ORDER BY json_extract(published,'$.date') DESC, published_at DESC, id DESC LIMIT 20 OFFSET ?").bind((page-1)*20).all<Entry>();
  return { posts: rows.results.map(toPublic), count: count?.count || 0 };
}
export async function publicEntry(env: JournalEnvironment, slug: string) {
  const row = await database(env).prepare("SELECT * FROM journal_entries WHERE slug = ? AND status = 'published' AND published IS NOT NULL").bind(slug).first<Entry>();
  return row ? toPublic(row) : null;
}
export function imageMime(data: Uint8Array): string | null {
  if (data[0]===137 && data[1]===80 && data[2]===78 && data[3]===71 && data[4]===13 && data[5]===10 && data[6]===26 && data[7]===10) return 'image/png';
  if (data[0]===255 && data[1]===216 && data[2]===255) return 'image/jpeg';
  if (String.fromCharCode(...data.slice(0,6)).match(/^GIF8[79]a$/)) return 'image/gif';
  if (String.fromCharCode(...data.slice(0,4))==='RIFF' && String.fromCharCode(...data.slice(8,12))==='WEBP') return 'image/webp';
  return null;
}
export async function storeImage(env: JournalEnvironment, entryId: string, data: Uint8Array) {
  const mime = imageMime(data);
  if (!mime) throw new JournalError(415, 'image', '图片仅支持 PNG、JPEG、GIF 或 WebP。');
  if (data.length > 750000) throw new JournalError(413, 'image', '单张图片请小于 750 KB，可先压缩后上传。');
  const entry = await getEntry(env, entryId);
  if (!entry || entry.status === 'trash') throw new JournalError(404, 'missing', '请先保存草稿，再上传图片。');
  const count = await database(env).prepare('SELECT COUNT(*) AS count FROM journal_assets WHERE entry_id = ?').bind(entryId).first<{count:number}>();
  if ((count?.count || 0) >= 100) throw new JournalError(400, 'image', '这篇文章的图片已达到上限（100 张）。');
  const id = crypto.randomUUID();
  await database(env).prepare('INSERT INTO journal_assets (id,entry_id,mime,bytes) VALUES (?,?,?,?)').bind(id,entryId,mime,Array.from(data)).run();
  return `/media/journal/${id}`;
}
