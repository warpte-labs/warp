# Changelog

All notable changes to **Warp** are documented in this file.

## [0.8.1] — 2026-07-22

### Public release packaging
- Marketplace-ready metadata, MIT license, README, and clean VSIX contents
- Safer default: `warp.alwaysApprove` is **off** (ask mode); enable YOLO in settings or `/always-approve`
- Improved Grok binary discovery on Windows, macOS, and Linux (PATH + common install locations)
- Clearer errors when the agent binary is missing
- 128×128 extension icon

### Features (0.8.0)
- Slash command palette from ACP `available_commands` + Warp host commands
- Host intercepts: compact, new, export, copy, model/effort, always-approve, rename, login/logout, multiline
- Permission chip (yolo / ask) in the footer
- Prompt history with ↑/↓

## [0.7.x]

- Context usage bar, compact bar, model + effort picker
- Session history, attachments, @ file mentions, prompt queue
- OAuth sign-in via Grok CLI
