# Third-party software

The WebAssembly application is built from these upstream projects:

| Project | Version | License | Source |
| --- | --- | --- | --- |
| libqalculate / qalc | 5.12.0 | GPL-2.0 | `libqalculate/` submodule |
| GMP | 6.3.0 | LGPL-3.0-or-later or GPL-2.0-or-later | <https://gmplib.org/> |
| MPFR | 4.2.2 | LGPL-3.0-or-later | <https://www.mpfr.org/> |
| libxml2 | 2.12.10 | MIT | <https://gitlab.gnome.org/GNOME/libxml2> |
| Emscripten | 6.0.3 | MIT and other permissive licenses | <https://emscripten.org/> |

KaTeX 0.16.11 and its fonts are distributed as static files under
`web/vendor/katex/`. KaTeX is licensed under the MIT license; its license text is
included at [`web/vendor/katex/LICENSE`](../web/vendor/katex/LICENSE).

The dependency build script downloads the corresponding GMP, MPFR, and libxml2
source archives. Their complete license texts are included in those source
distributions. libqalculate's license is available both in the submodule and as
the root [`LICENSE`](../LICENSE).
