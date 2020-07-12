const { app } = require('electron')
const { handleMessages } = require('./lib/message')
const { loadTranslation, handleI18NMessages } = require('./lib/i18n')
const { createApplicationMenu, createDockMenu, handleMenuMessages } = require('./lib/menu')
const { checkForUpdates } = require('./lib/updater')
const { createWindow, handleWindowMessages } = require('./lib/window')
const { hasWindow, getLastWindow } = require('./lib/frame')
const { handleSettingsMessages } = require('./lib/settings')
const { handleThemeMessages } = require('./lib/theme')
const { handleTerminalMessages } = require('./lib/terminal')
const { handleLauncherMessages } = require('./lib/launcher')
const { loadAddons, loadCustomJS } = require('./lib/addon')
const commas = require('../api/main')

handleMessages()
handleI18NMessages()
handleMenuMessages()
handleWindowMessages()
handleSettingsMessages()
handleThemeMessages()
handleTerminalMessages()
handleLauncherMessages()

let cwd
async function initialize() {
  await loadAddons()
  loadCustomJS()
  await app.whenReady()
  commas.app.events.emit('ready')
  loadTranslation(app.getLocale())
  if (process.platform === 'darwin') {
    createApplicationMenu()
    createDockMenu()
  }
  checkForUpdates()
  createWindow(cwd)
}

initialize()

app.on('activate', () => {
  if (!hasWindow() && app.isReady()) {
    createWindow()
  }
})

app.on('will-finish-launching', () => {
  // handle opening outside
  app.on('open-file', (event, file) => {
    event.preventDefault()
    // for Windows
    if (!file) {
      file = process.argv[process.argv.length - 1]
    }
    if (!app.isReady()) {
      cwd = file
    } else if (hasWindow()) {
      const frame = getLastWindow()
      frame.webContents.send('open-tab', { cwd: file })
    } else {
      createWindow(file)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
