// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
	site: "https://mcxiaoshan.ccwu.cc",
	integrations: [mdx(), sitemap({
		customSitemaps: ['https://mcxiaoshan.ccwu.cc/sitemap-journal.xml'],
		filter: (page) => !/^\/(?:admin|api|media)(?:\/|$)/.test(new URL(page).pathname),
	})],
	adapter: cloudflare({
		workerEntryPoint: { path: './src/worker.ts' },
		platformProxy: {
			enabled: true,
		},
	}),
});
