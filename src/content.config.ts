import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";

const blogFiles = glob({
  base: "./src/content/blog",
  pattern: "**/*.{md,mdx}",
});

const blog = defineCollection({
  // Load Markdown and MDX files in the `src/content/blog/` directory.
  loader: {
    ...blogFiles,
    async load(context) {
      // Astro 5's glob loader returns early for an empty folder. Clear cached
      // entries so deleting the final post also removes its route and RSS item.
      context.store.clear();
      await blogFiles.load(context);
    },
  },
  // Type-check frontmatter using a schema
  schema: z.object({
    title: z.string(),
    description: z.string(),
    author: z.string().optional(),
    // Transform string to Date object
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    heroImage: z.string().optional(),
  }),
});

export const collections = { blog };
