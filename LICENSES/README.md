# License scope and redistribution notices

This repository is a **multi-license** project. A license declaration for one component does not replace or relicense the terms of other components.

| Component | License | Scope |
| --- | --- | --- |
| Project webapp (`webapp/`) | GPL-3.0-only | The web application and its own changes; see `webapp/package.json` and `LICENSES/GPL-3.0.txt`. Existing third-party packages retain their own licenses. |
| Project-maintained native webOS Starboard overlay (`cobalt-platform/webos/arm/`), native build and integration glue (`cobalt-platform/`, `scripts/`, `starterless-cobalt/`) | BSD-3-Clause for original project contributions | See `LICENSES/BSD-3-Clause.txt`. Portions derived from upstream Cobalt retain their original notices/terms; this declaration applies only to code the project has the rights to license. |
| Upstream Cobalt | BSD-3-Clause and bundled third-party licenses | See `LICENSES/BSD-3-Clause-Cobalt.txt` and the notices provided by the exact Cobalt build. |
| SDL-webOS / SDL2 (statically linked into the native runtime) | Zlib | See `LICENSES/Zlib-SDL.txt`, including the original copyright notice. |
| Bundled GCC runtime (`libstdc++.so.6`, `libgcc_s.so.1`, optional `libatomic.so.1`) | GPL-3.0-with-GCC-exception | See `LICENSES/GPL-3.0.txt` and `LICENSES/GCC-exception-3.1.txt`; check the actual SDK release/source for any additional or different notices. |
| Bundled FDK-AAC (when present) | Upstream FDK-AAC terms | Preserve the build-generated `content/licenses/fdk-aac.txt`; licensing is determined by the precise FDK-AAC source/build. |

These files are documentation of the intended scope, **not** a blanket relicensing of imported materials, device firmware, original YouTube content, other binary dependencies, fonts, or npm packages.

For IPK releases the packaging script includes the license directory at `content/licenses/` and preserves any notices from the Cobalt build. The authoritative terms for components imported from upstream are those of their respective source versions. Before distributing a release, review the included binaries and their complete third-party notice inventory.

Sources: https://github.com/youtube/cobalt ; https://github.com/webosbrew/SDL-webOS ; https://gcc.gnu.org/onlinedocs/libstdc++/manual/license.html .
