# Windows publisher verification

Pine 1.2.4's Windows release workflow did not supply a signing certificate. A checksum proves that a download matches a release, but does not authenticate a Windows publisher.

The updated Windows release job reads `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` from GitHub Actions secrets. With a valid, trusted Authenticode certificate supported by electron-builder, it signs the application and NSIS installers with SHA-256 and an RFC 3161 timestamp. Tagged builds require signing and verify both architecture installers and application executables before publication. Manual verification builds can remain unsigned.

## Before the next Windows release

1. Configure an appropriate code-signing identity. For a provider that permits PFX signing, save the certificate's base64 representation as the `WIN_CSC_LINK` repository secret and its password as `WIN_CSC_KEY_PASSWORD`. Never commit either value or paste them into a task. Hardware or cloud signing providers require their supported signing integration instead of exporting the private key; electron-builder supports Azure signing and custom signing hooks.
2. Run the Windows workflow and confirm signature verification passes for x64 and ARM64. Test install, launch, update, and uninstall on Windows with its normal protections enabled.
3. Publish a new version only after validation. Existing installed unsigned executables are not changed by editing this repository.

A trusted signature identifies the publisher; it does not guarantee immediate SmartScreen reputation. An unsigned-app block may also come from Smart App Control. Obtain the exact warning before diagnosing a particular PC. Do not disable Windows protections as a workaround.

Sources: [Microsoft SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), [Smart App Control](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview), [electron-builder Windows signing](https://www.electron.build/docs/features/code-signing/code-signing-win/).
