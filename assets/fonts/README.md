# Embedded document font

Noto Sans Regular is bundled unmodified under the SIL Open Font License in OFL.txt.
Source: https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf
License: https://github.com/notofonts/noto-fonts/blob/main/LICENSE

noto-sans.js contains the same font bytes encoded as base64 so both Node tests and the Cloudflare Worker can import the asset without runtime network access or a custom binary loader. The PDF renderer subsets the embedded font. Latin, Greek and Cyrillic fixtures are tested. This is not universal script coverage: unsupported code points fail explicitly and UTF-8 HTML/CSV remain available. Complex-script shaping, RTL and CJK fallback fonts remain a separate task.
