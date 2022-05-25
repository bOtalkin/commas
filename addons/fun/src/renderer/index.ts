import * as commas from 'commas:api/renderer'
import FunPane from './FunPane.vue'

commas.ui.addCSSFile('dist/renderer/style.css')

commas.workspace.registerTabPane('fun', {
  title: 'Battle#!fun.1',
  component: FunPane,
  icon: {
    name: 'feather-icon icon-smile',
  },
})

commas.ipcRenderer.on('start-fun', () => {
  commas.workspace.openPaneTab('fun')
})
