import type { APIRoute } from 'astro';
import { database } from '../server/journal';
export const prerender=false;
export const GET:APIRoute=async({locals})=>{
  try{
    const rows=await database(locals.runtime.env).prepare("SELECT slug,published_at FROM journal_entries WHERE status = 'published' AND published IS NOT NULL ORDER BY published_at DESC LIMIT 10000").all<{slug:string;published_at:number}>();
    const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    const urls=rows.results.map(row=>`<url><loc>${escape(`https://mcxiaoshan.ccwu.cc/blog/${row.slug}/`)}</loc><lastmod>${new Date(row.published_at*1000).toISOString()}</lastmod></url>`).join('');
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store'}});
  }catch{return new Response('Unavailable',{status:503,headers:{'Cache-Control':'no-store'}});}
};
