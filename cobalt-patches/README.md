`cobalt-25.lts.stable.patch` is the Cobalt 25 / Starboard 16 baseline used by
the rooted signed-Store overlay workflow. See
[`docs/rooted-stock-overlay.md`](../docs/rooted-stock-overlay.md). It injects
the generated `adblockMain.js` and `adblockMain.css` assets while allowing the
SponsorBlock and Return YouTube Dislike API endpoints through Cobalt's CSP.

Create a new patch with:

```bash
cd cobalt
git add .
git diff --cached > ../cobalt-patches/xxx.patch
```
