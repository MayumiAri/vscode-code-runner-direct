import { dirname, basename } from 'node:path'
import * as vscode from 'vscode'
import { getExtensionSetting, registerExtensionCommand } from 'vscode-framework'
import { parseVariables } from './utils'

export const activate = () => {
    type FsPath = string
    const activeTerminals = new Map<FsPath, vscode.Terminal>()

    const checkDisplayRunButton = (textEditor: vscode.TextEditor | undefined): void => {
        try {
            void vscode.commands.executeCommand('setContext', `terminal-code-runner.runButton`, getHasExec(textEditor))
        } catch {
            // safely ignore context errors
        }
    }

    vscode.window.onDidChangeActiveTextEditor(checkDisplayRunButton)
    checkDisplayRunButton(vscode.window.activeTextEditor)

    const runFileAction = async () => {
        const activeEditor = vscode.window.activeTextEditor
        if (!activeEditor || activeEditor.viewColumn === undefined) return

        let exec = getExec(activeEditor)
        if (!exec) {
            void vscode.window.showWarningMessage(`No matched exec command for language ${activeEditor.document.languageId}!`)
            return
        }

        const { document } = activeEditor
        const { fsPath } = document.uri
        const fileDir = dirname(fsPath)
        const fileName = basename(fsPath)
        exec = parseVariables(exec, document.uri)

        // Terminal selection strategy
        const executeInTerminal = getExtensionSetting('executeInTerminal')
        const terminalKey = executeInTerminal === 'file' ? fsPath : executeInTerminal === 'shared' ? '--Reused Terminal--' : undefined
        let terminal: vscode.Terminal | undefined

        if (executeInTerminal === 'active') {
            terminal = vscode.window.activeTerminal ?? (vscode.window.terminals.length > 0 ? vscode.window.terminals[vscode.window.terminals.length - 1] : undefined)
        } else if (terminalKey) {
            terminal = activeTerminals.get(terminalKey)
        }

        // Reuse any currently open terminal to prevent opening a new one
        if (!terminal) {
            terminal = vscode.window.activeTerminal ?? (vscode.window.terminals.length > 0 ? vscode.window.terminals[vscode.window.terminals.length - 1] : undefined)
        }

        // Create a new terminal ONLY when there are no terminals open at all
        if (!terminal) {
            const terminalName = executeInTerminal === 'file' ? `Runner: ${fileName}` : `Shared Runner`
            terminal = vscode.window.createTerminal({
                name: terminalName,
                cwd: getExtensionSetting('terminalCwd') === 'file' ? fileDir : undefined,
            })
        }
        terminal.show()

        // https://github.com/formulahendry/vscode-code-runner/issues/715
        if (getExtensionSetting('focusOnEditor'))
            setTimeout(() => {
                void vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
            }, 150)

        // save file
        const saveFileSetting = getExtensionSetting('saveFile')
        if (saveFileSetting === 'all') await vscode.commands.executeCommand('workbench.action.files.saveAll')
        if (saveFileSetting === 'onlyActive') await vscode.commands.executeCommand('workbench.action.files.save')

        // clear terminal
        if (getExtensionSetting('clearTerminal')) {
            // eslint-disable-next-line unicorn/prefer-ternary
            if (process.platform === 'win32') {
                // fix for https://github.com/formulahendry/vscode-code-runner/issues/704 and https://github.com/formulahendry/vscode-code-runner/issues/506
                // from https://github.com/microsoft/vscode/issues/75141#issuecomment-1367586528
                await vscode.commands.executeCommand('workbench.action.terminal.sendSequence', { text: 'cls \u000D' })
            } else {
                await vscode.commands.executeCommand('workbench.action.terminal.clear')
            }
        }

        // run
        terminal.sendText(exec)

        if (terminalKey) {
            activeTerminals.set(terminalKey, terminal)
        }
    }

    try {
        registerExtensionCommand('terminal-code-runner.runFile' as any, runFileAction)
    } catch {}
    vscode.commands.registerCommand('runFile', runFileAction)
    vscode.commands.registerCommand('terminal-code-runner.runFile', runFileAction)

    vscode.window.onDidCloseTerminal(hiddenTerminal => {
        for (const [fsPath, terminal] of activeTerminals.entries()) {
            if (hiddenTerminal === terminal) {
                activeTerminals.delete(fsPath)
                break
            }
        }
    })
}

const getExecByGlob = (doc: vscode.TextDocument) => {
    try {
        const globMap = getExtensionSetting('executorMapByGlob') ?? {}
        if (!globMap || typeof globMap !== 'object') return undefined
        for (const pattern of Object.keys(globMap)) {
            if (vscode.languages.match({ pattern }, doc)) {
                return globMap[pattern]
            }
        }
    } catch {
        return undefined
    }

    return undefined
}

const getExecByLanguageId = (languageId: string) => {
    try {
        const execMap = getExtensionSetting('execMap') ?? {}
        if (execMap && typeof execMap === 'object' && languageId in execMap) {
            return execMap[languageId]
        }
    } catch {}
    return undefined
}

const getHasExec = (textEditor: vscode.TextEditor | undefined) => {
    if (!textEditor || textEditor.viewColumn === undefined) return false
    try {
        const defaultExec = getExtensionSetting('defaultExec')
        return Boolean(defaultExec ?? getExecByGlob(textEditor.document) ?? getExecByLanguageId(textEditor.document.languageId))
    } catch {
        return false
    }
}

const getExec = (textEditor: vscode.TextEditor) => {
    try {
        const defaultExec = getExtensionSetting('defaultExec')
        return getExecByGlob(textEditor.document) ?? getExecByLanguageId(textEditor.document.languageId) ?? defaultExec
    } catch {
        return undefined
    }
}
