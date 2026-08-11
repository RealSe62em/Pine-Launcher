# Pine Launcher website

This dependency-free static website can be previewed by serving the project root and opening `/website/`.

Download links target the latest GitHub Release. At runtime, `script.js` reads the latest release version, exact asset URLs, universal-installer size, and GitHub-provided SHA-256 digest from the Releases API. The values in `index.html` are fallbacks for browsers or networks that block that API.

Do not hard-code a checksum from a previous release or link a VirusTotal result for different installer bytes.