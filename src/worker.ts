import type { SSRManifest } from 'astro';
import { createExports as createAstroExports } from '@astrojs/cloudflare/entrypoints/server.js';
import { cleanupExpiredTrash } from './server/journal-trash';

export function createExports(manifest:SSRManifest){
  const astro=createAstroExports(manifest);
  return {default:{
    ...astro.default,
    async scheduled(controller:ScheduledController,env:Cloudflare.Env){
      const deleted=await cleanupExpiredTrash(env,Math.floor(controller.scheduledTime/1000));
      console.info(JSON.stringify({event:'journal-trash-cleanup',deleted}));
    },
  }};
}
