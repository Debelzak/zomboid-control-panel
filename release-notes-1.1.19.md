## v1.1.19

### Fixed

- **Standalone update download failure.** v1.1.18 downloaded the Windows ZIP needed to refresh the dashboard but validated it as an `.exe`, producing `expected MZ header, got 0x504b`. The updater now validates ZIP/gzip archives separately from Windows/Linux executables.

This release also includes the v1.1.18 mod-update restart repair. Install the Windows ZIP once over the existing panel folder while keeping `data/`; future in-panel updates will then work normally.
