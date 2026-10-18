import { database, JournalError, validId, type JournalEnvironment } from './journal';
import { TRASH_RETENTION_SECONDS } from '../constants/journal-trash';

export type TrashTarget={id:string;revision:number};

export async function purgeTrashEntries(env:JournalEnvironment,value:unknown){
  if(!Array.isArray(value)||!value.length||value.length>10000)throw new JournalError(400,'invalid','请重新选择要删除的日志。');
  const ids=new Set<string>(),targets:TrashTarget[]=[];
  for(const item of value){
    if(!item||typeof item!=='object')throw new JournalError(400,'invalid','删除列表无效，请重新确认。');
    const target=item as Record<string,unknown>;
    if(typeof target.id!=='string'||!validId(target.id)||typeof target.revision!=='number'||!Number.isSafeInteger(target.revision)||target.revision<1||ids.has(target.id))throw new JournalError(400,'invalid','删除列表无效，请重新确认。');
    ids.add(target.id);targets.push({id:target.id,revision:target.revision});
  }
  // One atomic statement. Only the reviewed IDs and revisions still in trash
  // can be removed; restored/edited/newly trashed articles are excluded.
  const result=await database(env).prepare(`DELETE FROM journal_entries WHERE status = 'trash' AND EXISTS (
    SELECT 1 FROM json_each(?) AS target
    WHERE json_extract(target.value,'$.id') = journal_entries.id
      AND json_extract(target.value,'$.revision') = journal_entries.revision
  ) RETURNING id`).bind(JSON.stringify(targets)).all<{id:string}>();
  // meta.changes also counts cascading asset deletions, so count returned articles.
  return {deleted:result.results.length,changed:targets.length-result.results.length};
}

export async function cleanupExpiredTrash(env:JournalEnvironment,nowSeconds=Math.floor(Date.now()/1000)){
  const db=database(env);
  const [,result]=await db.batch([
    // Covers an old Worker request finishing between schema migration and deployment.
    // A missing timestamp always gets a fresh retention period, never immediate deletion.
    db.prepare("UPDATE journal_entries SET trashed_at = ? WHERE status = 'trash' AND trashed_at IS NULL").bind(nowSeconds),
    db.prepare("DELETE FROM journal_entries WHERE status = 'trash' AND trashed_at IS NOT NULL AND trashed_at <= ? RETURNING id").bind(nowSeconds-TRASH_RETENTION_SECONDS),
  ]);
  // journal_assets is removed by its ON DELETE CASCADE foreign key in this statement.
  return result.results.length;
}
