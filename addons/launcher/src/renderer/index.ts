import * as commas from 'commas:api/renderer'
import { watch } from 'vue'
import LauncherLink from './LauncherLink.vue'
import LauncherList from './LauncherList.vue'
import { startLauncher, runLauncherScript, useLauncherGroups, useLaunchers, openLauncher, getLauncherByTerminalTabGroup } from './launcher'
import { clearLauncherSessions, LauncherSessionAddon } from './session'

declare module '../../../../src/typings/terminal' {
  export interface TerminalTabAddons {
    launcherSession: LauncherSessionAddon,
  }
}

export default () => {

  commas.ui.addCSSFile('dist/renderer/style.css')

  commas.ipcRenderer.on('open-launcher-group', (event, group) => {
    const launcher = getLauncherByTerminalTabGroup(group)
    if (launcher) {
      openLauncher(launcher)
    }
  })
  commas.ipcRenderer.on('start-launcher', (event, launcher) => {
    startLauncher(launcher)
  })
  commas.ipcRenderer.on('run-script', (event, launcher, index) => {
    runLauncherScript(launcher, index)
  })

  const groups = $(useLauncherGroups())

  commas.app.effect(() => {
    commas.context.provide('terminal.category', {
      title: 'Launcher#!launcher.2',
      groups,
      command: 'open-launcher-group',
    })
  })

  watch(useLaunchers(), () => {
    clearLauncherSessions()
  })

  commas.workspace.registerXtermAddon('launcherSession', tab => {
    const settings = commas.remote.useSettings()
    if (tab.group?.type === 'launcher' && settings['launcher.session.persist']) {
      return new LauncherSessionAddon(tab.group.id)
    }
  }, true)

  commas.context.provide('terminal.ui-side-list', LauncherList)

  commas.context.provide('preference.item', {
    component: LauncherLink,
    group: 'feature',
    priority: 1,
  })

}
