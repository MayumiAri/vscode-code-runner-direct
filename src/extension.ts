import { dirname, basename, extname } from 'node:path'
import * as vscode from 'vscode'
import { getExtensionSetting, registerExtensionCommand } from 'vscode-framework'
import { parseVariables } from './utils'

export const activate = () => {
    type FsPath = string
    const activeTerminals = new Map<FsPath, vscode.Terminal>()

    const checkDisplayRunButton = (textEditor: vscode.TextEditor | undefined): void => {
        try {
            const hasExec = getHasExec(textEditor)
            void vscode.commands.executeCommand('setContext', `code-runner-direct.runButton`, hasExec)
            void vscode.commands.executeCommand('setContext', `terminal-2-code-runner.runButton`, hasExec)
            void vscode.commands.executeCommand('setContext', `terminal-code-runner.runButton`, hasExec)
            void vscode.commands.executeCommand('setContext', `code-runner.runButton`, hasExec)
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

        const hasVariable = exec.includes('$') || exec.includes('${')
        exec = parseVariables(exec, document.uri)

        if (!hasVariable) {
            const activeWorkspace = vscode.workspace.getWorkspaceFolder(document.uri)
            const relativeFilePath = activeWorkspace ? vscode.workspace.asRelativePath(document.uri, false) : fsPath
            const targetFile = relativeFilePath && !relativeFilePath.startsWith('..') ? relativeFilePath : fsPath
            const formattedFile = targetFile.includes(' ') ? `"${targetFile}"` : targetFile
            exec = `${exec} ${formattedFile}`
        }

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
        registerExtensionCommand('code-runner-direct.runFile' as any, runFileAction)
    } catch {}
    vscode.commands.registerCommand('runFile', runFileAction)
    vscode.commands.registerCommand('terminal-code-runner.runFile', runFileAction)
    vscode.commands.registerCommand('terminal-2-code-runner.runFile', runFileAction)
    vscode.commands.registerCommand('code-runner-direct.runFile', runFileAction)

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

const getExecByFileExtension = (doc: vscode.TextDocument) => {
    try {
        const filePath = doc.uri.fsPath
        const ext = extname(filePath).toLowerCase()
        if (!ext) return undefined

        let extMap: Record<string, string> | undefined
        try {
            extMap = getExtensionSetting('executorMapByFileExtension' as any)
        } catch {}

        if (!extMap || Object.keys(extMap).length === 0) {
            extMap = vscode.workspace.getConfiguration('codeRunnerDirect').get<Record<string, string>>('executorMapByFileExtension') ??
                      vscode.workspace.getConfiguration('code-runner').get<Record<string, string>>('executorMapByFileExtension') ??
                      vscode.workspace.getConfiguration('terminalCodeRunner').get<Record<string, string>>('executorMapByFileExtension') ??
                      vscode.workspace.getConfiguration('terminal2CodeRunner').get<Record<string, string>>('executorMapByFileExtension')
        }

        if (extMap && typeof extMap === 'object') {
            if (ext in extMap) return extMap[ext]
            const lowerKey = Object.keys(extMap).find(k => k.toLowerCase() === ext)
            if (lowerKey) return extMap[lowerKey]

            const extNoDot = ext.startsWith('.') ? ext.slice(1) : ext
            if (extNoDot in extMap) return extMap[extNoDot]
            const lowerNoDotKey = Object.keys(extMap).find(k => k.toLowerCase() === extNoDot)
            if (lowerNoDotKey) return extMap[lowerNoDotKey]
        }
    } catch {}
    return undefined
}

const getExecByLanguageId = (languageId: string) => {
    try {
        let execMap: Record<string, string> | undefined
        try {
            execMap = getExtensionSetting('execMap')
        } catch {}

        if (!execMap || Object.keys(execMap).length === 0) {
            execMap = vscode.workspace.getConfiguration('codeRunnerDirect').get<Record<string, string>>('execMap') ??
                      vscode.workspace.getConfiguration('code-runner').get<Record<string, string>>('executorMap') ??
                      vscode.workspace.getConfiguration('code-runner').get<Record<string, string>>('execMap') ??
                      vscode.workspace.getConfiguration('terminalCodeRunner').get<Record<string, string>>('execMap') ??
                      vscode.workspace.getConfiguration('terminal2CodeRunner').get<Record<string, string>>('execMap')
        }

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
        return Boolean(defaultExec ?? getExecByGlob(textEditor.document) ?? getExecByFileExtension(textEditor.document) ?? getExecByLanguageId(textEditor.document.languageId))
    } catch {
        return false
    }
}

const getExec = (textEditor: vscode.TextEditor) => {
    try {
        const defaultExec = getExtensionSetting('defaultExec')
        return getExecByGlob(textEditor.document) ?? getExecByFileExtension(textEditor.document) ?? getExecByLanguageId(textEditor.document.languageId) ?? defaultExec
    } catch {
        return undefined
    }
}
