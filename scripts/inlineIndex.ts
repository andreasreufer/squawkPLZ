import type { Plugin } from "vite";

/** Puts the built script and CSS inside index.html so opening the file directly can run it. */
export function inlineIndexPlugin(): Plugin {
  return {
    name: "inline-index",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const htmlEntry = bundle["index.html"];
      if (!htmlEntry || htmlEntry.type !== "asset") return;

      let html = htmlEntry.source.toString();
      html = html.replace(/<link rel="modulepreload"[^>]*>/g, "");

      html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (tag, href: string) => {
        const asset = bundle[href.replace(/^\.\//, "")];
        if (!asset || asset.type !== "asset") return tag;
        const css = asset.source.toString().replace(/<\/style/gi, "<\\/style");
        delete bundle[asset.fileName];
        return `<style>${css}</style>`;
      });

      html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (tag, src: string) => {
        const chunk = bundle[src.replace(/^\.\//, "")];
        if (!chunk || chunk.type !== "chunk") return tag;
        const code = chunk.code
          .replace(/<\/script/gi, "<\\/script")
          .replace(/\b__VITE_PRELOAD__\b/g, "void 0");
        delete bundle[chunk.fileName];
        return `<script type="module">${code}</script>`;
      });

      htmlEntry.source = html;
    },
  };
}
