/// <reference types="vue/macros-global" />

interface Element {
  scrollIntoViewIfNeeded(centerIfNeeded?: boolean): void,
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module 'commas:api/main' {
  export * from '@commas/api/main'
}

declare module 'commas:api/renderer' {
  export * from '@commas/api/renderer'
}
