module.exports = function (commas) {
  if (commas.app.isMainProcess()) {

    const { ipcMain } = require('electron')

    commas.i18n.addTranslation(['zh', 'zh-CN'], require('./locales/zh-CN.json'))

    ipcMain.removeHandler('open-settings')

    commas.ipcMain.handle('open-settings', () => {
      const frame = commas.frame.getFocusedWindow()
      frame.webContents.send('open-settings-pane')
    })

    commas.app.onCleanup(() => {
      ipcMain.handle('open-settings', () => {
        return commas.settings.openFile()
      })
    })

  } else {

    commas.workspace.registerTabPane('settings', {
      title: 'Settings#!settings.1',
      component: commas.bundler.extract('settings/settings-pane.vue').default,
      icon: {
        name: 'feather-icon icon-settings',
      },
    })

    commas.ipcRenderer.on('open-settings-pane', () => {
      const { activateOrAddTerminalTab } = commas.bundler.extract('settings/hooks.ts')
      const settingsTab = commas.workspace.getPaneTab('settings')
      activateOrAddTerminalTab(settingsTab)
    })

  }
}
