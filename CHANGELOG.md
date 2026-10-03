# Changelog


## [0.9.0] - 2026-10-03
Community modernization fork of karlcswanson/micboard. See README "What changed in this fork".
### Changed
- Frontend toolchain: webpack 5, Dart Sass, Babel 7 latest; Node 18+ supported.
- Dockerfile: multi-stage Node 20 / Python 3.12 build; compose uses host networking.
- Docs updated for current Debian/Ubuntu/Raspberry Pi OS and macOS.
### Fixed
- Server shutdown, port-in-use handling, LAN IP detection for QR code.
- Discovery on Windows / busy multicast port.
- Several crashes in receiver socket handling, channel-name parsing and WebSocket broadcast.


## [0.8.5] - 2019-10-10
### Added
- Device configuration page.
- Estimated battery times for devices using Shure rechargeable batteries.
- Offline device type for devices like PSM900s.
- Added color guide to help HUD.
- Custom QR code support using `local_url` config key.
- docker-compose for simplified docker deployment.

### Changed
- Migrated CSS display from flex to grid based system.
- Cleaned up node dependencies.
- Updated DCID map with additional devices.

### Fixed
- Disable caching for background images.
- Updated Dockerfile to Node 10.
- Invalid 'p10t' device type in configuration documentation.
- Resolved issue with PyInstaller that required the Mac app to be occasionally restarted.
- Cleaned up device discovery code.


## [0.8.0] - 2019-8-29
Initial public beta

[0.8.5]: https://github.com/karlcswanson/micboard/compare/v0.8.0...v0.8.5
[0.8.0]: https://github.com/karlcswanson/micboard/releases/tag/v0.8.0
