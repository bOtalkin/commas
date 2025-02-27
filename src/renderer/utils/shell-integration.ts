import { ipcRenderer } from 'electron'
import fuzzaldrin from 'fuzzaldrin-plus'
import { isEqual } from 'lodash'
import { nextTick, toRaw } from 'vue'
import type { IDecoration, IDisposable, IMarker, ITerminalAddon, Terminal } from 'xterm'
import { toCSSHEX, toRGBA } from '../../shared/color'
import type { CommandCompletion, TerminalTab } from '../../typings/terminal'
import { useSettings } from '../compositions/settings'
import { scrollToMarker, writeTerminalTab } from '../compositions/terminal'
import { useTheme } from '../compositions/theme'

interface IntegratedShellCommandAction {
  command: string,
}

interface IntegratedShellCommand {
  command?: string,
  exitCode?: number,
  marker: IMarker,
  decoration: IDecoration,
  cursorX: number,
  actions?: IntegratedShellCommandAction[],
}

interface IntegratedShellPosition {
  x: number,
  y: number,
}

interface IntegratedShellCompletion {
  marker: IMarker,
  decoration: IDecoration,
  renderer: IDisposable,
  position: IntegratedShellPosition,
}

function updateDecorationElement(decoration: IDecoration, callback: (el: HTMLElement) => void) {
  if (decoration.element) {
    callback(decoration.element)
  } else {
    const disposable = decoration.onRender(el => {
      callback(el)
      disposable.dispose()
    })
  }
}

function filterAndSortCompletions(completions: CommandCompletion[]) {
  const duplicatedTimes: (Pick<CommandCompletion, 'value' | 'query'> & { times: number })[] = []
  const deduplicatedCompletions: CommandCompletion[] = []
  for (const completion of completions) {
    const existingIndex = deduplicatedCompletions.findIndex(item => {
      return item.value === completion.value
        && item.query === completion.query
    })
    if (existingIndex === -1) {
      deduplicatedCompletions.push(completion)
    } else {
      const duplicatedTimesItem = duplicatedTimes.find(item => {
        return item.value === completion.value
          && item.query === completion.query
      })
      if (duplicatedTimesItem) {
        duplicatedTimesItem.times += 1
      } else {
        duplicatedTimes.push({
          value: completion.value,
          query: completion.query,
          times: 2,
        })
      }
      const existingItem = deduplicatedCompletions[existingIndex]
      const replacement: CommandCompletion = {
        ...existingItem,
        type: 'default',
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        description: existingItem.description || completion.description,
      }
      deduplicatedCompletions.splice(existingIndex, 1, replacement)
    }
  }
  return deduplicatedCompletions
    .map(item => {
      const duplicatedTimesItem = duplicatedTimes.find(record => {
        return record.value === item.value
          && record.query === item.query
      })
      const scale = duplicatedTimesItem ? duplicatedTimesItem.times : 1
      let score: number
      if (item.query) {
        const baseline = fuzzaldrin.score(item.value, item.value) * item.query.length / item.value.length ** 2
        const queryScore = fuzzaldrin.score(item.value, item.query)
        score = queryScore > baseline ? queryScore : 0
      } else {
        score = 1
      }
      return [item, score * scale] as const
    })
    .filter(([item, score]) => score > 0)
    .sort(([itemA, scoreA], [itemB, scoreB]) => scoreB - scoreA)
    .map(([item]) => item)
}

export class ShellIntegrationAddon implements ITerminalAddon {

  tab: TerminalTab
  disposables: IDisposable[]
  commands: IntegratedShellCommand[]
  currentCommand?: IntegratedShellCommand
  recentMarker?: WeakRef<IMarker>
  highlightMarkers: IMarker[]
  completion?: IntegratedShellCompletion
  completionKey?: symbol
  recentCompletionAppliedPosition?: true | IntegratedShellCompletion['position']

  constructor(tab: TerminalTab) {
    this.tab = tab
    this.tab.idle = true
    this.disposables = []
    this.commands = []
    this.highlightMarkers = []
  }

  activate(xterm: Terminal) {
    const settings = useSettings()
    this.disposables.push(
      xterm.parser.registerOscHandler(633, data => {
        const [command, ...args] = data.split(';')
        switch (command) {
          case 'A':
            // PromptStart
            return true
          case 'B': {
            // PromptEnd
            ipcRenderer.send('terminal-prompt-end')
            const marker = xterm.registerMarker()!
            const actions = this.currentCommand
              ? this.currentCommand.actions
              : this._generateQuickFixActions(marker)
            const theme = useTheme()
            const decoration = this._createCommandDecoration(
              xterm,
              marker,
              actions ? theme.yellow : theme.foreground,
              Boolean(actions),
            )
            if (this.currentCommand) {
              this.currentCommand.marker.dispose()
              this.currentCommand.marker = marker
              this.currentCommand.decoration = decoration
            } else {
              this.currentCommand = {
                marker,
                decoration,
                cursorX: xterm.buffer.active.cursorX,
                actions,
              }
              this.commands.push(this.currentCommand)
              this.recentMarker = undefined
            }
            return true
          }
          case 'C':
            // OutputStart
            this.tab.idle = false
            return true
          case 'D':
            // CommandComplete
            this.tab.idle = true
            if (this.currentCommand) {
              const exitCode = args[0] ? Number(args[0]) : undefined
              if (typeof exitCode === 'number' && exitCode < 128) {
                this.currentCommand.exitCode = exitCode
                if (!this.currentCommand.marker.isDisposed) {
                  const theme = useTheme()
                  this.currentCommand.decoration.dispose()
                  if (exitCode && settings['terminal.shell.highlightErrors']) {
                    this._createHighlightDecoration(
                      xterm,
                      this.currentCommand.marker.line,
                      xterm.buffer.active.baseY + xterm.buffer.active.cursorY - 1,
                      theme.red,
                    )
                  } else {
                    this.currentCommand.decoration = this._createCommandDecoration(
                      xterm,
                      this.currentCommand.marker,
                      exitCode ? theme.red : theme.green,
                      true,
                    )
                  }
                }
              }
              this.currentCommand = undefined
            }
            return true
          case 'E':
            // CommandLine
            if (this.currentCommand) {
              const executedCommand = args[0]
              this.currentCommand.command = executedCommand
              if (!this.currentCommand.marker.isDisposed) {
                updateDecorationElement(this.currentCommand.decoration, el => {
                  el.dataset.command = executedCommand
                })
              }
            }
            return true
          case 'F':
            // ContinuationStart
            return true
          case 'G':
            // ContinuationEnd
            return true
          case 'H':
            // RightPromptStart
            return true
          case 'I':
            // RightPromptEnd
            return true
          case 'P':
            // Property
            for (const arg of args) {
              const [key, value] = arg.split('=')
              switch (key) {
                case 'Cwd':
                  this.tab.cwd = value
                  break
              }
            }
            return true
          default:
            return false
        }
      }),
      xterm.onCursorMove(() => {
        if (settings['terminal.shell.autoCompletion']) {
          this.triggerCompletion()
        } else {
          this.clearCompletion()
        }
      }),
    )
  }

  dispose() {
    delete this.tab.idle
    const disposables = [
      ...this.disposables,
      ...this.commands.map(command => command.marker),
      ...this.highlightMarkers,
    ]
    disposables.forEach(disposable => {
      disposable.dispose()
    })
    this.disposables = []
    this.commands = []
    this.recentMarker = undefined
    this.clearCompletion()
    this.recentCompletionAppliedPosition = undefined
  }

  _createCommandDecoration(
    xterm: Terminal,
    marker: IMarker,
    color: string,
    strong?: boolean,
  ) {
    const rgba = toRGBA(color)
    const decoration = xterm.registerDecoration({
      marker,
      overviewRulerOptions: strong ? {
        color: toCSSHEX({ ...rgba, a: 0.5 }),
        position: 'right',
      } : undefined,
    })!
    updateDecorationElement(decoration, el => {
      el.style.setProperty('--color', `${rgba.r} ${rgba.g} ${rgba.b}`)
      el.style.setProperty('--opacity', strong ? '1' : '0.25')
      el.classList.add('terminal-command-mark')
    })
    return decoration
  }

  _createHighlightDecoration(
    xterm: Terminal,
    from: number,
    to: number,
    color: string,
  ) {
    const line = xterm.buffer.active.baseY + xterm.buffer.active.cursorY
    const rgba = toRGBA(color)
    for (let offset = from - line; offset <= to - line; offset += 1) {
      const highlightMarker = xterm.registerMarker(offset)!
      const decoration = xterm.registerDecoration({
        marker: highlightMarker,
        width: xterm.cols,
        height: 1,
        layer: 'bottom',
      })!
      decoration.onRender(el => {
        el.style.setProperty('--color', `${rgba.r} ${rgba.g} ${rgba.b}`)
        el.classList.add('terminal-highlight-block')
      })
      this.highlightMarkers.push(highlightMarker)
    }
  }

  scrollToCommand(offset: number) {
    const markers = this.commands
      .map(item => item.marker)
      .filter(marker => !marker.isDisposed)
      .sort((a, b) => a.line - b.line)
    if (!markers.length) return
    const index = this.recentMarker
      // @ts-expect-error also find undefined
      ? markers.indexOf(this.recentMarker.deref())
      : markers.length
    let targetIndex = index + offset
    if (targetIndex < 0) {
      targetIndex = markers.length - 1
    }
    if (targetIndex > markers.length - 1) {
      targetIndex = 0
    }
    const targetMarker = markers[targetIndex]
    this.recentMarker = new WeakRef(targetMarker)
    scrollToMarker(this.tab.xterm, targetMarker)
  }

  _getQuickFixActionsByOutput(command: string, output: string) {
    // Git push for upstream
    const gitUpstreamMatches = output.match(/git push --set-upstream origin (\S+)/)
    if (gitUpstreamMatches && /\bgit\b/.test(command)) {
      return [{ command: gitUpstreamMatches[0] }]
    }
    // Free port
    const portMatches = output.match(/address already in use (?:0\.0\.0\.0|127\.0\.0\.1|localhost|::):(\d{4,5})|Unable to bind \S*:(\d{4,5})|can't listen on port (\d{4,5})|listen EADDRINUSE \S*:(\d{4,5})/)
    if (portMatches) {
      return [{ command: `commas free ${portMatches[1]}` }]
    }
    // Git style recommendations
    const gitMessages = [
      'most similar command is',
      'most similar commands are',
      '最相似的命令是',
    ]
    const gitMatches = output.match(new RegExp(`(?:${gitMessages.join('|')})((?:\\n\\s*\\S+)+)`))
    if (gitMatches) {
      const name = output.match(/^[^\s:]+(?=:|\uff1a)/)?.[0] ?? 'git'
      const subcommands = gitMatches[1].split('\n').map(line => line.trim()).filter(Boolean)
      const actions = subcommands.map(subcommand => {
        return { command: `${name} ${subcommand}` }
      })
      return actions
    }
    // NPM style recommendations
    const npmMatches = output.match(/Did you mean (?:this|one of these)\?((?:\n\s*.+)+)(?=\n+[A-Z])/)
    if (npmMatches) {
      const commands = npmMatches[1].split('\n').map(line => {
        const subcommand = line.trim()
        const index = subcommand.indexOf(' # ')
        return index === -1 ? subcommand : subcommand.slice(0, index)
      }).filter(Boolean)
      const actions = commands.map(subcommand => {
        return { command: `${subcommand}` }
      })
      return actions
    }
  }

  _generateQuickFixActions(marker: IMarker) {
    const { xterm } = this.tab
    const lastCommand = this.commands.length
      ? this.commands[this.commands.length - 1]
      : undefined
    if (lastCommand?.command && lastCommand.exitCode) {
      const lastCommandLine = lastCommand.marker.line
      let lastOutput = ''
      // TODO: use actual command start
      for (let line = lastCommandLine + 1; line < marker.line; line += 1) {
        const bufferLine = xterm.buffer.active.getLine(line)
        if (bufferLine) {
          lastOutput += (bufferLine.isWrapped || !lastOutput ? '' : '\n')
            + bufferLine.translateToString(true)
        }
      }
      return this._getQuickFixActionsByOutput(lastCommand.command, lastOutput)
    }
  }

  _createCompletionDecoration(
    height: number,
    reusingCompletion?: IntegratedShellCompletion,
  ): IntegratedShellCompletion {
    const { xterm } = this.tab
    let marker: IMarker
    let decoration: IDecoration
    if (reusingCompletion) {
      marker = reusingCompletion.marker
      decoration = reusingCompletion.decoration
    } else {
      marker = xterm.registerMarker()!
      decoration = xterm.registerDecoration({
        marker,
        width: Math.floor(xterm.cols / 2),
        height: Math.floor(xterm.rows / 2),
      })!
    }
    if (reusingCompletion) {
      reusingCompletion.renderer.dispose()
    }
    let renderedCompletions: CommandCompletion[] | undefined
    const renderer = decoration.onRender(el => {
      const renderingCompletions = toRaw(this.tab.completions)
      if (renderingCompletions === renderedCompletions) return
      renderedCompletions = renderingCompletions
      el.classList.add('terminal-completion')
      el.classList.add(xterm.buffer.active.cursorY < xterm.rows / 2 ? 'is-bottom' : 'is-top')
      el.classList.add(xterm.buffer.active.cursorX < xterm.cols / 2 ? 'is-left' : 'is-right')
      el.style.setProperty('--column', `${xterm.buffer.active.cursorX}`)
      el.style.setProperty('--row-span', `${height}`)
      const source = xterm.element?.closest('[data-shell-integration="container"]')
        ?.querySelector('[data-shell-integration="completion-source"]')
      if (source) {
        el.replaceChildren(...[...source.children].map(node => node.cloneNode(true)))
      }
    })
    return Object.assign(reusingCompletion ?? {}, {
      marker,
      decoration,
      renderer,
      position: this._getCurrentPosition(),
    })
  }

  _getCurrentPosition(): IntegratedShellPosition {
    const { xterm } = this.tab
    return {
      x: xterm.buffer.active.cursorX,
      y: xterm.buffer.active.baseY + xterm.buffer.active.cursorY,
    }
  }

  _getCurrentCommandInput(position: IntegratedShellPosition) {
    const { xterm } = this.tab
    if (!this.currentCommand || this.currentCommand.command) return ''
    const cursorX = this.currentCommand.cursorX
    const promptLine = Math.max(this.currentCommand.marker.line, 0)
    if (
      position.y >= promptLine
      && position.x >= cursorX
    ) {
      const rowspan = position.y - promptLine + 1
      return Array.from(
        { length: rowspan },
        (_, index) => {
          const trimRight = rowspan <= 1 || index !== rowspan - 1
          const startColumn = index === 0 ? cursorX : 0
          const endColumn = index === rowspan - 1 ? position.x : undefined
          return xterm.buffer.active.getLine(promptLine + index)
            ?.translateToString(trimRight, startColumn, endColumn)
            ?? ''
        },
      ).join('')
    }
    return ''
  }

  async _getRealtimeCompletions(input: string) {
    if (!input) return []
    return ipcRenderer.invoke('get-completions', input, this.tab.cwd) as Promise<CommandCompletion[]>
  }

  async _getCompletions(input: string) {
    let completions: CommandCompletion[] = []
    if (this.currentCommand?.actions) {
      const actionCompletions: CommandCompletion[] = this.currentCommand.actions.map(action => ({
        type: 'recommendation',
        query: input,
        value: action.command,
      }))
      completions = completions.concat(actionCompletions)
    }
    const realtimeCompletions = await this._getRealtimeCompletions(input)
    completions = completions.concat(realtimeCompletions)
    return filterAndSortCompletions(completions)
  }

  async triggerCompletion() {
    const currentPosition = this._getCurrentPosition()
    const input = this._getCurrentCommandInput(currentPosition)
    let shouldReuseDecoration = false
    if (this.completion) {
      if (isEqual(this.completion.position, currentPosition)) {
        return
      } else if (this.completion.marker.line === currentPosition.y) {
        shouldReuseDecoration = true
      } else {
        this.clearCompletion()
      }
    }
    const key = Symbol('COMPLETION_SESSION')
    this.completionKey = key
    const completions = await this._getCompletions(input)
    if (!completions.length) {
      if (shouldReuseDecoration) {
        this.clearCompletion()
      }
      return
    }
    if (
      this.recentCompletionAppliedPosition === true || (
        isEqual(this.recentCompletionAppliedPosition, currentPosition)
        && completions.some(item => item.query && item.value === item.query)
      )
    ) {
      this.recentCompletionAppliedPosition = undefined
      if (shouldReuseDecoration) {
        this.clearCompletion()
      }
      return
    }
    if (this.completionKey === key) {
      const result = this._createCompletionDecoration(
        completions.length,
        shouldReuseDecoration ? this.completion : undefined,
      )
      this.completion = result
      this.tab.completions = completions
      // Refresh immediately
      if (shouldReuseDecoration && result.decoration.element) {
        await nextTick()
        result.decoration['onRenderEmitter'].fire(result.decoration.element)
      }
    }
  }

  clearCompletion() {
    this.completionKey = undefined
    const completion = this.completion
    if (completion) {
      completion.marker.dispose()
      // FIXME: I don't know why
      if (!completion.decoration.isDisposed) {
        completion.decoration.dispose()
        this.tab.xterm['_core']._decorationService._onDecorationRemoved.fire(completion.decoration)
      }
      this.completion = undefined
    }
  }

  skipCompletion(position?: IntegratedShellCompletion['position']) {
    this.recentCompletionAppliedPosition = position ?? true
  }

  applyCompletion(value: string, back = 0) {
    const { xterm } = this.tab
    const position = this._getCurrentPosition()
    const input = this._getCurrentCommandInput(position)
    position.x += value.length - back
    while (position.x > xterm.cols) {
      position.x -= xterm.cols
    }
    this.skipCompletion(position)
    writeTerminalTab(this.tab, '\x7F'.repeat(back) + value)
    // Preload completions
    this._getRealtimeCompletions(input.slice(0, -back) + value + ' ')
  }

  setCompletionDescription(content: string | undefined) {
    if (this.completion?.decoration.element) {
      const el = this.completion.decoration.element.querySelector<HTMLDivElement>('.terminal-completion-desc')
      if (el) {
        el.textContent = content ?? ''
      }
    }
  }

  getCompletionElement(target: EventTarget | null) {
    return target instanceof HTMLElement
      ? target.closest<HTMLElement>('.terminal-completion-item')
      : null
  }

  applyCompletionElement(item: HTMLElement, isEnterPressing?: boolean) {
    let value = item.dataset.value
    if (value) {
      const back = Number(item.dataset.back ?? 0)
      if (isEnterPressing && value.length === back) return false
      this.applyCompletion(value, back)
      return true
    }
    return false
  }

  selectCompletionElement(item: HTMLElement) {
    const parent = item.parentElement
    if (parent) {
      for (const el of parent.children) {
        el.classList.remove('is-active')
      }
    }
    this.setCompletionDescription(item.dataset.desc)
    item.classList.add('is-active')
    item.scrollIntoViewIfNeeded()
  }

  getSelectedCompletionElement() {
    return this.completion?.decoration.element
      ? this.completion.decoration.element.querySelector<HTMLDivElement>(
        '.terminal-completion-item.is-active',
      )
      : null
  }

  applySelectedCompletionElement(isEnterPressing?: boolean) {
    const item = this.getSelectedCompletionElement()
    if (item) {
      return this.applyCompletionElement(item, isEnterPressing)
    }
    return false
  }

  selectPreviousCompletionElement() {
    const item = this.getSelectedCompletionElement()
    if (item) {
      const previousSibling = item.previousElementSibling
      if (previousSibling) {
        this.selectCompletionElement(previousSibling as HTMLElement)
      } else {
        const parent = item.parentElement!
        this.selectCompletionElement(parent.children[parent.childElementCount - 1] as HTMLElement)
      }
    }
  }

  selectNextCompletionElement() {
    const item = this.getSelectedCompletionElement()
    if (item) {
      const nextSibling = item.nextElementSibling
      if (nextSibling) {
        this.selectCompletionElement(nextSibling as HTMLElement)
      } else {
        const parent = item.parentElement!
        this.selectCompletionElement(parent.children[0] as HTMLElement)
      }
    }
  }

}
