import type { APIRoute } from 'astro';
export const prerender = false;
export const GET: APIRoute = ({redirect}) => redirect(`/admin/journal/edit/${crypto.randomUUID()}/`,303);
