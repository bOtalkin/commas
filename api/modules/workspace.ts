import { shallowReactive, markRaw, unref } from 'vue'
import {
  activateOrAddTerminalTab,
  activateTerminalTab,
  closeTerminalTab,
  createTerminalTab,
  executeTerminalTab,
  getTerminalTabsByGroup,
  getTerminalTabTitle,
  scrollToMarker,
  showTabOptions,
  useCurrentTerminal,
  usePaneTabURL,
  useTerminalTabs,
} from '../../src/renderer/compositions/terminal'
import type { TerminalTab, TerminalTabAddons, TerminalTabPane } from '../../src/typings/terminal'
import type { RendererAPIContext } from '../types'

const paneTabs = shallowReactive<Record<string, TerminalTab | undefined>>({})

function registerTabPane(this: RendererAPIContext, name: string, pane: TerminalTabPane) {
  paneTabs[name] = markRaw({
    pid: 0,
    process: name,
    title: '',
    cwd: '',
    pane,
  } as TerminalTab)
  this.$.app.onInvalidate(() => {
    delete paneTabs[name]
  })
}

function getPaneTab(name: string) {
  return paneTabs[name]
}

function openPaneTab(name: string) {
  const pane = getPaneTab(name)
  if (!pane) return
  activateOrAddTerminalTab(pane)
}

function registerXtermAddon<T extends keyof TerminalTabAddons>(
  this: RendererAPIContext,
  key: T,
  factory: (tab: TerminalTab) => TerminalTabAddons[T] | undefined,
  immediate?: boolean,
) {
  const apply = (tab: TerminalTab, active: boolean) => {
    const addon = factory(tab)
    if (addon) {
      if (active && !tab.addons[key]) {
        tab.addons[key] = addon
        tab.xterm.loadAddon(tab.addons[key]!)
      } else if (!active && tab.addons[key]) {
        tab.addons[key]!.dispose()
        delete tab.addons[key]
      }
    }
  }

  let active = false

  this.$.app.events.on('terminal-addons-loaded', tab => {
    apply(tab, active)
  })

  const toggle = (enabled: boolean) => {
    if (active === enabled) return
    active = enabled
    const tabs = unref(useTerminalTabs())
    tabs.forEach(tab => {
      if (!tab.pane) {
        apply(tab, active)
      }
    })
  }

  this.$.app.onInvalidate(() => {
    toggle(false)
  })
  if (immediate) {
    toggle(true)
  }

  return toggle
}

export * from '../shim'

export {
  registerTabPane,
  getPaneTab,
  openPaneTab,
  registerXtermAddon,
  activateOrAddTerminalTab,
  activateTerminalTab,
  closeTerminalTab,
  createTerminalTab,
  executeTerminalTab,
  getTerminalTabsByGroup,
  getTerminalTabTitle,
  scrollToMarker,
  showTabOptions,
  useCurrentTerminal,
  usePaneTabURL,
  useTerminalTabs,
}
