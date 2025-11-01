import { $ } from "bun"

if (process.versions.bun !== "1.3.0") {
  throw new Error("This script requires bun@1.3.0")
}

const CHANNEL =
  process.env["OPENCODE_CHANNEL"] ??
  (await $`git branch --show-current`.text().then((x) => x.trim()))
const IS_PREVIEW = CHANNEL !== "latest"
const VERSION = "BOBv1.0"

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
}
console.log(`opencode script`, JSON.stringify(Script, null, 2))
