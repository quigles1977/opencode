import type { Argv } from "yargs"
import { Instance } from "../../project/instance"
import { Config } from "../../config/config"
import { DEFAULT_RAG_CONFIG } from "../../rag/config"
import { cleanupRag, initializeRag } from "../../rag/init/init"
import { UI } from "../ui"
import { cmd } from "./cmd"

export const KbCommand = cmd({
  command: "kb <command>",
  describe: "manage RAG knowledge base",
  builder: (yargs: Argv) => {
    return yargs
      .command(
        "init",
        "initialize RAG knowledge base",
        (yargs) => {
          return yargs.option("force", {
            describe: "force reinitialization (deletes existing database)",
            type: "boolean",
            default: false,
          })
        },
        async (argv) => {
          await Instance.provide({
            directory: process.cwd(),
            async fn() {
              const { config } = await Config.state()
              const ragConfig = config.rag || DEFAULT_RAG_CONFIG

              const result = await initializeRag({
                config: ragConfig,
                force: argv.force,
              })

              if (result.success) {
                UI.println(UI.Style.TEXT_SUCCESS_BOLD + result.message + UI.Style.TEXT_NORMAL)
                if (result.knowledgePath) {
                  UI.println(UI.Style.TEXT_INFO + `Knowledge base location: ${result.knowledgePath}` + UI.Style.TEXT_NORMAL)
                }
                UI.println(UI.Style.TEXT_INFO + "\nYou can now use the knowledge base search tool in your sessions." + UI.Style.TEXT_NORMAL)
              } else {
                UI.error(result.message)
                process.exit(1)
              }
            },
          })
        },
      )
      .command(
        "cleanup",
        "delete RAG database",
        () => {},
        async () => {
          await Instance.provide({
            directory: process.cwd(),
            async fn() {
              const { config } = await Config.state()
              const ragConfig = config.rag || DEFAULT_RAG_CONFIG

              const result = await cleanupRag(ragConfig)

              if (result.success) {
                UI.println(UI.Style.TEXT_SUCCESS_BOLD + result.message + UI.Style.TEXT_NORMAL)
              } else {
                UI.error(result.message)
                process.exit(1)
              }
            },
          })
        },
      )
      .demandCommand(1, "You must specify a subcommand (init, cleanup)")
  },
  handler: () => {
    // Handler is not needed as we use subcommands
  },
})
