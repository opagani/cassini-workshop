# Security

## Supported versions

| Version | Supported |
|---------|-----------|
| latest (`main`) | ✅ |

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security bugs.

Instead, report via [GitHub Security Advisories](https://github.com/opagani/cassini-workshop/security/advisories/new) or email **oscargustavo8@gmail.com**.

Include:
- A description of the vulnerability and its potential impact.
- Steps to reproduce or proof-of-concept.
- Any suggested mitigation.

I'll acknowledge within **5 business days** and aim to ship a fix or mitigation within 30 days of confirmation.

## Scope

This is a **read-only public MCP server** over an open NASA dataset. There is no authentication, no user data, and no write path. The primary security surface is SQL injection via tool arguments (all values are bound via prepared statements / column whitelists — see `src/db/queries.ts`).
