// Hợp đồng của một game với platform: arcade.toml (manifest) + spec.json (GameSpec).
export { parseToml, TomlError, type TomlTable, type TomlValue } from './toml.ts'
export { parseManifest, SCHEMA, MODES, ID_RE, type Manifest, type Mode, type Problem } from './manifest.ts'
export { parseSpec, GENRES, TEMPLATES, FILL, type GameSpec, type BalanceRule } from './spec.ts'
export { validateGame, formatCheck, type GameCheck } from './validate.ts'
