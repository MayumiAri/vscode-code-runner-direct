# Terminal 2 Code Runner

An enhanced, lightweight version of [vscode-terminal-code-runner](https://github.com/zardoy/vscode-terminal-code-runner) (originally by [zardoy](https://github.com/zardoy)), maintained by [Altias](https://github.com/MayumiAri), that executes code directly in your active terminal.

## Key Features

- **Direct Execution in Active Terminal**: Runs code directly in your currently open terminal (`opam`, `powershell`, `bash`, etc.) without opening unnecessary new terminals.
- **Multiple Terminal Modes**: Supports `active` (reuse open terminal), `shared` (extension shared terminal), or `file` (separate terminal per file).
- **Out-of-the-box OCaml Support**: Built-in default support for OCaml (`ocaml ${relativeFile}`) and JavaScript (`node ${relativeFile}`).
- **Windows Friendly**: Solved terminal clearing and focus restoration issues on Windows.

## Configuration

Set the executor by language ID or glob pattern in your VS Code `settings.json`:

```jsonc
{
    "terminalCodeRunner.executeInTerminal": "active", // "active" | "shared" | "file"

    "terminalCodeRunner.execMap": {
        "ocaml": "ocaml ${relativeFile}",
        "javascript": "node ${relativeFile}",
        "python": "python ${relativeFile}"
    }
}
```

## Credits

This project is a fork of [zardoy/vscode-terminal-code-runner](https://github.com/zardoy/vscode-terminal-code-runner) by [zardoy](https://github.com/zardoy). Licensed under the MIT License.
