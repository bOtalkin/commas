import * as fs from 'node:fs'
import * as os from 'node:os'
import type { WebContents } from 'electron'
import { app, ipcMain } from 'electron'
import type { IPty, IPtyForkOptions } from 'node-pty'
import * as pty from 'node-pty'
import type { TerminalContext, TerminalInfo } from '../../typings/terminal'
import { getCompletions, refreshCompletions } from '../utils/completion'
import { execa } from '../utils/helper'
import { integrateShell, getDefaultEnv, getDefaultShell } from '../utils/shell'
import { useSettings, whenSettingsReady } from './settings'

const ptyProcessMap = new Map<number, IPty>()

async function createTerminal(
  webContents: WebContents,
  { shell, args, env, cwd }: Partial<TerminalContext>,
): Promise<TerminalInfo> {
  await Promise.all([
    whenSettingsReady(),
    app.whenReady(),
  ])
  if (cwd) {
    try {
      await fs.promises.access(cwd)
    } catch {
      cwd = undefined
    }
  }
  if (!cwd) {
    cwd = os.homedir()
  }
  const settings = useSettings()
  if (!shell) {
    shell = settings['terminal.shell.path'] || getDefaultShell()
  }
  if (!args) {
    args = process.platform === 'win32'
      ? settings['terminal.shell.windowsArgs']
      : settings['terminal.shell.args']
  }
  if (!env) {
    env = settings['terminal.shell.env']
  }
  let runtimeEnv = {
    ...getDefaultEnv(),
    ...env,
    COMMAS_SENDER_ID: String(webContents.id),
  } as Record<string, string>
  let runtimeArgs = args
  if (settings['terminal.shell.integration']) {
    const result = integrateShell({ shell: shell!, args: runtimeArgs, env: runtimeEnv })
    runtimeArgs = result.args
    runtimeEnv = result.env
  }
  const options: IPtyForkOptions = {
    name: 'xterm-256color',
    cwd,
    env: runtimeEnv,
  }
  if (process.platform !== 'win32') {
    options.encoding = 'utf8'
  }
  const ptyProcess = pty.spawn(shell!, runtimeArgs, options)
  ptyProcess.onData(data => {
    webContents.send('input-terminal', {
      pid: ptyProcess.pid,
      process: ptyProcess.process,
      data,
    })
  })
  ptyProcess.onExit(data => {
    ptyProcessMap.delete(ptyProcess.pid)
    if (!webContents.isDestroyed()) {
      webContents.send('exit-terminal', { pid: ptyProcess.pid, data })
    }
  })
  webContents.once('destroyed', () => {
    ptyProcess.kill()
  })
  ptyProcessMap.set(ptyProcess.pid, ptyProcess)
  return {
    pid: ptyProcess.pid,
    process: ptyProcess.process,
    cwd,
    shell: shell!,
    args,
    env,
  }
}

function handleTerminalMessages() {
  ipcMain.handle('create-terminal', (event, data: Partial<TerminalContext>) => {
    return createTerminal(event.sender, data)
  })
  ipcMain.handle('write-terminal', (event, pid: number, data: string) => {
    const ptyProcess = ptyProcessMap.get(pid)
    ptyProcess?.write(data)
  })
  ipcMain.handle('resize-terminal', (event, pid: number, data: { cols: number, rows: number }) => {
    const ptyProcess = ptyProcessMap.get(pid)
    ptyProcess?.resize(data.cols, data.rows)
  })
  ipcMain.handle('close-terminal', (event, pid: number) => {
    const ptyProcess = ptyProcessMap.get(pid)
    ptyProcess?.kill()
  })
  ipcMain.handle('get-terminal-cwd', async (event, pid: number) => {
    try {
      if (process.platform === 'darwin') {
        const { stdout } = await execa(`lsof -p ${pid} | grep cwd`)
        return stdout.slice(stdout.indexOf('/'), -1)
      } else if (process.platform === 'linux') {
        return await fs.promises.readlink(`/proc/${pid}/cwd`)
      } else {
        // TODO: no command supported on Windows
        throw new Error('Cannot get working directory on Windows')
      }
    } catch {
      return ''
    }
  })
  ipcMain.handle('get-shells', async () => {
    if (process.platform === 'win32') {
      return [
        'powershell.exe',
        'cmd.exe',
        'wsl.exe',
        // 'bash.exe',
        // 'git-cmd.exe',
      ]
    }
    try {
      const { stdout } = await execa('grep "^/" /etc/shells')
      return stdout.trim().split('\n')
    } catch {
      return []
    }
  })
  ipcMain.handle('get-completions', (event, input: string, cwd: string) => {
    return getCompletions(input, cwd)
  })
  ipcMain.on('terminal-prompt-end', () => {
    refreshCompletions()
  })
}

export {
  handleTerminalMessages,
}
