import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";
import mdx from "@astrojs/mdx";

export default defineConfig({
  site: "https://loc.github.io",
  base: "/electron-window",
  integrations: [
    starlight({
      title: "@loc/electron-window",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/loc/electron-window" },
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
