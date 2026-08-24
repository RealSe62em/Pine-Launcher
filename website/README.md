# Pine Launcher website

This dependency-free static website can be previewed by serving the project root and opening `/website/`.

Download links target the latest GitHub Release. At runtime, `script.js` reads the latest release version, exact Windows x64, Windows ARM64, Debian amd64, Debian ARM64, and Arch Linux x64 asset URLs and sizes, plus the GitHub-provided Windows x64 SHA-256 digest from the Releases API. The values in `index.html` are 1.2.3 fallbacks for browsers or networks that block that API.

Do not hard-code a checksum from a previous release or link a VirusTotal result for different installer bytes.
