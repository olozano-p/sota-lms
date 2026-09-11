---
allowed-tools: Bash(git add:*), Bash(git reset:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*)
description: Group the working tree into atomic commits, stage them and propose gitmoji messages (never commits)
model: haiku
disable-model-invocation: true
---

# I'll group the current changes into atomic commits, stage the first group and propose a gitmoji message for each — without running `git commit` (CLAUDE.md § Hard rules: the coder commits).

**Format:** `🌐 Support Japanese language` (One line, capitalized, in English, no additional text)

**Gitmoji Reference:**
🎨 - :art: - Improve structure / format of the code
⚡️ - :zap: - Improve performance
🔥 - :fire: - Remove code or files
🐛 - :bug: - Fix a bug
🚑️ - :ambulance: - Critical hotfix
✨ - :sparkles: - Introduce new features
📝 - :memo: - Add or update documentation
🚀 - :rocket: - Deploy stuff
💄 - :lipstick: - Add or update the UI and style files
🎉 - :tada: - Begin a project
✅ - :white_check_mark: - Add, update, or pass tests
🔒️ - :lock: - Fix security or privacy issues
🔐 - :closed_lock_with_key: - Add or update secrets
🔖 - :bookmark: - Release / Version tags
🚨 - :rotating_light: - Fix compiler / linter warnings
🚧 - :construction: - Work in progress
💚 - :green_heart: - Fix CI Build
⬇️ - :arrow_down: - Downgrade dependencies
⬆️ - :arrow_up: - Upgrade dependencies
📌 - :pushpin: - Pin dependencies to specific versions
👷 - :construction_worker: - Add or update CI build system
📈 - :chart_with_upwards_trend: - Add or update analytics or track code
♻️ - :recycle: - Refactor code
➕ - :heavy_plus_sign: - Add a dependency
➖ - :heavy_minus_sign: - Remove a dependency
🔧 - :wrench: - Add or update configuration files
🔨 - :hammer: - Add or update development scripts
🌐 - :globe_with_meridians: - Internationalization and localization
✏️ - :pencil2: - Fix typos
💩 - :poop: - Write bad code that needs to be improved
⏪️ - :rewind: - Revert changes
🔀 - :twisted_rightwards_arrows: - Merge branches
📦️ - :package: - Add or update compiled files or packages
👽️ - :alien: - Update code due to external API changes
🚚 - :truck: - Move or rename resources (e.g.: files, paths, routes)
📄 - :page_facing_up: - Add or update license
💥 - :boom: - Introduce breaking changes
🍱 - :bento: - Add or update assets
♿️ - :wheelchair: - Improve accessibility
💡 - :bulb: - Add or update comments in source code
🍻 - :beers: - Write code drunkenly
💬 - :speech_balloon: - Add or update text and literals
🗃️ - :card_file_box: - Perform database related changes
🔊 - :loud_sound: - Add or update logs
🔇 - :mute: - Remove logs
👥 - :busts_in_silhouette: - Add or update contributor(s)
🚸 - :children_crossing: - Improve user experience / usability
🏗️ - :building_construction: - Make architectural changes
📱 - :iphone: - Work on responsive design
🤡 - :clown_face: - Mock things
🥚 - :egg: - Add or update an easter egg
🙈 - :see_no_evil: - Add or update a .gitignore file
📸 - :camera_flash: - Add or update snapshots
⚗️ - :alembic: - Perform experiments
🔍️ - :mag: - Improve SEO
🏷️ - :label: - Add or update types
🌱 - :seedling: - Add or update seed files
🚩 - :triangular_flag_on_post: - Add, update, or remove feature flags
🥅 - :goal_net: - Catch errors
💫 - :dizzy: - Add or update animations and transitions
🗑️ - :wastebasket: - Deprecate code that needs to be cleaned up
🛂 - :passport_control: - Work on code related to authorization, roles and permissions
🩹 - :adhesive_bandage: - Simple fix for a non-critical issue
🧐 - :monocle_face: - Data exploration/inspection
⚰️ - :coffin: - Remove dead code
🧪 - :test_tube: - Add a failing test
👔 - :necktie: - Add or update business logic
🩺 - :stethoscope: - Add or update healthcheck
🧱 - :bricks: - Infrastructure related changes
🧑‍💻 - :technologist: - Improve developer experience
💸 - :money_with_wings: - Add sponsorships or money related infrastructure
🧵 - :thread: - Add or update code related to multithreading or concurrency
🦺 - :safety_vest: - Add or update code related to validation
✈️ - :airplane: - Improve offline support

**Rules:**

- One line per commit; two or three lines only when the why genuinely needs stating; five maximum.
- Match the gitmoji to the dominant nature of the change — `✨` only for genuinely new features.
- Never add "🤖 Generated with Claude Code" or "Co-Authored-By" trailers.

**Strategy:**

- Examine actual code changes within files using diffs
- Group by logical functionality, not just file location; use `git add -p` for hunks when needed
- Stage the first group, print its proposed message, then list the remaining groups with theirs
  and the `git commit` / `git add` sequence to land them one by one
- Show grouping rationale; stop without committing

Let me analyze your changes and prepare the commits.
