# Curt C.

Aspiring security engineer working in cyber security and DevSecOps, seeking internship and entry-level roles.

<!-- Add your live site address here once it is final, for example: Live site: https://your-address -->

## What this repository is

My portfolio site. It is a static site: plain HTML, CSS and JavaScript, with no server-side code, login or database.

## Security design

- **No secrets in the files.** Nothing private is stored in this repository.
- **Content Security Policy.** The main page allows only this site's own scripts and sends nothing to other sites.
- **HTTPS enforced** with HSTS, plus headers that block content-type sniffing, embedding in other sites, referrer leakage and unneeded browser features. They are set in `_headers`.
- **A live check.** The page reads its own response headers and scans its own source files for risky patterns, then reports a pass or fail for each check. `security-check.js` does this.
- **Locked third-party code.** The one outside library, three.js, loads with an integrity hash, so the browser refuses it if it was ever altered.
- **Independent verification.** The page links to Security Headers, Mozilla Observatory and SSL Labs, so the result does not rest on my word.

### Known limits

- Styles are still inline. Moving them into their own file would let the policy drop `unsafe-inline` for styles too.
- The live check is a pattern scan, not a full code review, and it runs in the browser, so it shows configuration and code hygiene, not immunity.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page |
| `scroll-sync.js` | Moves the background as you scroll |
| `security-check.js` | The live security check |
| `background.html` | The animated space background (page) |
| `background.js` | The animated space background (code) |
| `_headers` | Security headers sent with every page |

## Planned

- CompTIA Security+ certification
- Automated dependency and code scanning with GitHub Actions
- picoCTF practice, with public write-ups

Copyright 2026 Curt C. All rights reserved.
