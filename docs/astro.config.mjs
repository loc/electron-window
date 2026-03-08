import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";
import mdx from "@astrojs/mdx";

// DOCS_CHANNEL=next builds for /electron-window/next/ — the main-branch
// docs preview. Unset (or any other value) builds for the release docs
// at /electron-window/.
const isNext = process.env.DOCS_CHANNEL === "next";
const base = isNext ? "/electron-window/next" : "/electron-window";

export default defineConfig({
  site: "https://loc.github.io",
  base,
  integrations: [
    starlight({
      title: isNext ? "@loc/electron-window (next)" : "@loc/electron-window",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/loc/electron-window",
        },
      ],
      sidebar: [
        {
          label: "Guides",
          items: [
            "guides/getting-started",
            "guides/props",
            "guides/hooks",
            "guides/pooling",
            "guides/persistence",
            "guides/testing",
            "guides/security",
            "guides/patterns",
          ],
        },
        typeDocSidebarGroup,
      ],
      plugins: [
        starlightTypeDoc({
          entryPoints: [
            "../src/index.ts",
            "../src/main/index.ts",
            "../src/preload/index.ts",
            "../src/testing/index.ts",
          ],
          tsconfig: "../tsconfig.json",
          output: "api",
        }),
      ],
    }),
    mdx(),
  ],
});
