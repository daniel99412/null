import { Command } from "commander";
import { runTUI } from "../tui/App.js";

function clearScreen() {
    process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
}

export function runCLI() {
    clearScreen();
    
    const program = new Command();

    program
        .name("null")
        .description("AI CLI Tool")
        .version("0.1.0");


    program
        .argument("[prompt...]", "prompt to execute")
        .option("--dev", "enable debug mode")
        .action((promptParts: string[], options) => {
            if (!promptParts || promptParts.length === 0) {
                runTUI();
                return;
            }

            const prompt = promptParts.join(" ");
            console.log("Prompt:", prompt);

            // todo: call to ollama
        })

    program.parse();
}