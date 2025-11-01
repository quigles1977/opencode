import { Installation } from "@/installation"
import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"

const LOGO_LEFT = [`█▀▀▄ █▀▀█ █▀▀▄`, `█▀▀▄ █░░█ █▀▀▄`, `▀▀▀  ▀▀▀▀ ▀▀▀ `]

const LOGO_RIGHT: string[] = []

export function Logo() {
  const { theme } = useTheme()
  return (
    <box>
      <For each={LOGO_LEFT}>
        {(line) => (
          <box flexDirection="row">
            <text fg={theme.text} attributes={TextAttributes.BOLD}>{line}</text>
          </box>
        )}
      </For>
      <box flexDirection="row" justifyContent="flex-end">
        <text fg={theme.textMuted}>{Installation.VERSION}</text>
      </box>
    </box>
  )
}
