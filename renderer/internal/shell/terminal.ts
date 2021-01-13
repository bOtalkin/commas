import { ipcRenderer } from 'electron'
import { unref, watch } from 'vue'
import { Terminal } from 'xterm'
import type { TerminalTab } from '../../../typings/terminal'
import { loadTerminalAddons, useTerminalOptions } from '../../hooks/terminal'
import { LocalEchoAddon } from './local-echo'

async function listenLocalEcho(xterm: Terminal, localEcho: LocalEchoAddon) {
  for await (const line of localEcho.listen('> ', '· ')) {
    const output = await ipcRenderer.invoke('execute-shell-command', line.trim())
    if (output.code) {
      xterm.writeln(output.stderr)
    } else if (output.stdout) {
      xterm.writeln(output.stdout)
    }
  }
}

export function initializeShellTerminal(tab: TerminalTab) {
  const terminalOptionsRef = useTerminalOptions()
  const xterm = new Terminal(unref(terminalOptionsRef))
  const localEcho = new LocalEchoAddon()
  xterm.loadAddon(localEcho)
  xterm.onTitleChange(title => {
    tab.title = title
  })
  watch(terminalOptionsRef, (terminalOptions) => {
    const latestXterm = tab.xterm
    for (const [key, value] of Object.entries(terminalOptions)) {
      latestXterm.setOption(key, value)
    }
    loadTerminalAddons(tab)
  })
  listenLocalEcho(xterm, localEcho)
  tab.addons = { localEcho }
  tab.xterm = xterm
}
