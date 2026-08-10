# Project Tree

```text
.
|-- .github/workflows/       # CI and container publishing
|-- bridge/                  # Optional LG cloud bridge
|-- cloud/                   # ThinQ endpoints and MQTT discovery
|-- html/                    # Management interface assets
|   `-- i18n.js              # Browser-language management UI translations
|-- management/              # Management web server
|-- rethink-addon/           # Home Assistant add-on wrapper
|   |-- translations/        # Add-on UI translations
|   |-- config.yaml          # Add-on manifest and options
|   |-- Dockerfile           # Add-on container wrapper
|   |-- run.sh               # Runtime configuration generator
|   |-- README.md            # Store summary
|   |-- DOCS.md              # User documentation
|   `-- CHANGELOG.md         # Add-on release notes
|-- tests/                   # Automated tests
|-- tools/                   # Reverse-engineering utilities
|-- util/                    # Shared TypeScript utilities
|-- Dockerfile               # Upstream application image
|-- repository.yaml          # Home Assistant repository metadata
`-- rethink-cloud.ts         # Main service entry point
```
