<script lang="ts" setup>
import { ipcRenderer } from 'electron'
import type { KeepAlive } from 'vue'
import { onMounted } from 'vue'
import * as commas from '../../../api/core-renderer'
import type { TerminalTab } from '../../typings/terminal'
import { loadAddons, loadCustomJS } from '../compositions/addon'
import {
  useFullscreen,
  handleFrameMessages,
} from '../compositions/frame'
import { handleI18NMessages } from '../compositions/i18n'
import { injectSettingsStyle, useSettings } from '../compositions/settings'
import {
  useIsTabListEnabled,
  useWillQuit,
  confirmClosing,
  handleShellMessages,
} from '../compositions/shell'
import {
  useCurrentTerminal,
  useTerminalTabs,
  handleTerminalMessages,
  createTerminalTab,
} from '../compositions/terminal'
import { injectThemeStyle, useTheme } from '../compositions/theme'
import { unmountKeptAlive } from '../utils/helper'
import { getTerminalTabID } from '../utils/terminal'
import ActionBar from './ActionBar.vue'
import FindBox from './FindBox.vue'
import TabList from './TabList.vue'
import TerminalGroup from './TerminalGroup.vue'
import TitleBar from './TitleBar.vue'
import '@phosphor-icons/web/bold'
import 'devicon'

const settings = useSettings()
const theme = useTheme()
const isFullscreen = $(useFullscreen())
const isTabListEnabled = $(useIsTabListEnabled())
const terminal = $(useCurrentTerminal())
const tabs = $(useTerminalTabs())
const willQuit: boolean = $(useWillQuit())

let keepAlive = $ref<InstanceType<typeof KeepAlive>>()

const hasHorizontalTabList = $computed(() => {
  const position = settings['terminal.view.tabListPosition']
  return position === 'top' || position === 'bottom'
})

const TerminalComponent = $computed(() => {
  if (!terminal) return undefined
  if (terminal.pane) {
    return terminal.pane.component
  } else {
    return TerminalGroup
  }
})

const tabId = $computed(() => {
  if (!terminal) return ''
  if (terminal.group) {
    return terminal.group.id
  }
  return getTerminalTabID(terminal)
})

const slots = commas.proxy.context.getCollection('terminal.ui-slot')

loadAddons()
loadCustomJS()
injectSettingsStyle()
injectThemeStyle()
handleFrameMessages()
handleI18NMessages()
handleShellMessages()
handleTerminalMessages()

const startIndex = process.argv.indexOf('--') + 1
const args = startIndex ? process.argv.slice(startIndex) : []
const initialPath = args[0]
createTerminalTab({ cwd: initialPath })

window.addEventListener('beforeunload', async event => {
  if (!willQuit && tabs.length > 1) {
    event.returnValue = false
    const confirmed = await confirmClosing()
    if (confirmed) {
      commas.addon.unloadAddons()
      commas.proxy.app.events.emit('unload')
      ipcRenderer.invoke('destroy')
    }
  } else {
    commas.addon.unloadAddons()
    commas.proxy.app.events.emit('unload')
  }
})

// Revalidate KeepAlive manually
commas.proxy.app.events.on('terminal-unmounted', (tab: TerminalTab) => {
  const id = getTerminalTabID(tab)
  unmountKeptAlive(keepAlive!, id)
})

onMounted(() => {
  commas.proxy.app.events.emit('ready')
})
</script>

<template>
  <div :class="['app', { 'is-opaque': isFullscreen, 'is-vibrant': theme.vibrancy }]">
    <TitleBar />
    <div class="content">
      <TabList v-if="!hasHorizontalTabList" v-show="isTabListEnabled" />
      <main class="interface">
        <FindBox />
        <template v-if="terminal">
          <!-- eslint-disable-next-line vue/component-name-in-template-casing -->
          <keep-alive ref="keepAlive">
            <TerminalComponent
              :key="tabId"
              :tab="terminal"
            />
          </keep-alive>
        </template>
      </main>
    </div>
    <ActionBar />
    <component
      :is="slot"
      v-for="(slot, index) in slots"
      :key="index"
      class="slot"
    />
  </div>
</template>

<style lang="scss" scoped>
@use '../assets/_partials';

@property --scrollbar-opacity {
  syntax: '<number>';
  inherits: true;
  initial-value: 0;
}

// https://developer.apple.com/design/human-interface-guidelines/macos/visual-design/color#system-colors
:global(:root) {
  --system-red: 255 69 58;
  --system-yellow: 255 214 10;
  --system-green: 50 215 75;
  --system-cyan: 102 212 207;
  --system-blue: 10 132 255;
  --system-magenta: 255 55 95;
  --system-accent: var(--system-blue);
  --design-card-background: rgb(var(--theme-foreground) / 0.15);
  --design-input-background: rgb(127 127 127 / 0.2);
  --design-separator: rgb(127 127 127 / 0.2);
}
:global(::selection) {
  background: rgb(var(--theme-selectionbackground));
}
:global(body) {
  margin: 0;
  cursor: default;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
:global(.ph-bold) {
  line-height: inherit;
}
.app {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  color: rgb(var(--theme-foreground));
  /* Default line height of xterm.js */
  line-height: 1.2;
  overflow: hidden;
  transition: color 0.2s;
  &.is-vibrant {
    --vibrancy-filter: drop-shadow(0 0 0.5em rgb(var(--theme-background))) blur(2px);
  }
}
.content {
  z-index: 1;
  display: flex;
  flex: auto;
  width: 100vw;
  overflow: hidden;
}
.interface {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  background: rgb(var(--theme-background) / var(--theme-opacity));
  box-shadow: 0 0 4px 0px rgb(0 0 0 / 5%);
  transition: background 0.2s;
  .app.is-opaque & {
    background: rgb(var(--theme-background));
  }
}
</style>
