# Security Policy

This library sits at the boundary between renderer and main process in Electron apps. It enforces `nodeIntegration: false`, `contextIsolation: true`, origin allowlists, and per-WebContents window ownership. A bypass here could mean a compromised renderer gains access it shouldn't have.

## Reporting a vulnerability

Please use [GitHub Security Advisories](https://github.com/loc/electron-window/security/advisories/new) to report privately. Do not open a public issue.

We'll acknowledge within 48 hours and aim to ship a fix within 14 days for high-severity issues.

## Supported versions

| Version | Supported |
| ------- | --------- |
| latest  | ✓         |
| < 1.0   | ✗         |

Only the latest major version receives security patches.

## Scope

In scope:

- Bypasses of `allowedOrigins` or `__ELECTRON_WINDOW_ALLOWED_ORIGINS__`
- Renderer-controllable `webPreferences` on child windows
- Cross-WebContents window control (ownership check bypass)
- IPC validation bypasses allowing disallowed props to reach `BrowserWindow`

Out of scope:

- Vulnerabilities in Electron itself
- Misuse by the consuming app (e.g., setting `allowedOrigins: ["*"]`)
- Denial of service within documented rate limits
