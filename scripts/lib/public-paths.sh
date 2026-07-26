#!/usr/bin/env bash
# Single definition of the public/private boundary.
#
# Sourced by devhub-backport.sh (which ports a named ref) and
# devhub-backport-status.sh (which tells you what still needs porting). These
# two must agree about what "public" means, and they only will if there is one
# copy of the list.
#
# See CONTRIBUTING.md → "Personal-data boundary".

# Catalog-owned assets that belong in public core. Note in particular that
# skills outside skills/shared are local tool installs and must never hitch a
# ride — that's what the two ':!' pathspecs at the end are for.
PUBLIC_PATHS=(.gitattributes .githooks .github .gitignore .nvmrc AGENTS.md
              CONTRIBUTING.md LICENSE PLAN.md README.md ROADMAP.md package.json
              agents/shared dashboard desktop docs mcp/shared mcp-servers
              opencode/shared persona/deep-preferences.md persona/modes
              persona/shared-persona.md scripts shared skills/shared
              ':!dashboard/.env.local' ':!scripts/make-public-seed.sh')

# Personal data that lives happily in this mirror and must never be pushed to
# public core.
PERSONAL_PATHS=(notes tasks collections upstarts
                dashboard/.env.local persona/identity.txt
                TEMPLATE_AND_PLUGIN_PLAN.md scripts/make-public-seed.sh)
