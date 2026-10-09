# The store page

`listing.json` is this game's page on Freedom35 Studios — https://freedom35studios.pages.dev/g/world-builder

Edit it (or ask Claude to) and push: when a push changes this folder, the workflow in
`.github/workflows/freedom35.yml` updates the page. Fields and the markdown you can use:
https://freedom35studios.pages.dev/developers/store-page.md

The page can also be edited in Creator studio or by Claude through the Freedom35 MCP server. If it
was, a push from here stops instead of overwriting it — run `node f35.mjs listing pull world-builder` first
(`curl -fsSLo f35.mjs https://freedom35studios.pages.dev/cli/f35.mjs`).
