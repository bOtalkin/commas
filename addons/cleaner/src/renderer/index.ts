import * as commas from 'commas:api/renderer'
import CleanerLink from './CleanerLink.vue'

commas.ui.addCSSFile('dist/renderer/style.css')

commas.context.provide('preference', {
  component: CleanerLink,
  group: 'about',
})
