import type { Ref } from '@vue/reactivity'
import { customRef, effect, shallowReactive, stop, toRaw, unref } from '@vue/reactivity'
import { difference, intersection, isEqual } from 'lodash'

export function useAsyncComputed<T>(factory: () => Promise<T>): Ref<T | undefined>
export function useAsyncComputed<T>(factory: () => Promise<T>, defaultValue: T): Ref<T>

export function useAsyncComputed<T>(factory: () => Promise<T>, defaultValue?: T) {
  return customRef<T | undefined>((track, trigger) => {
    let currentValue = defaultValue
    let initialized = false
    const update = effect(async () => {
      initialized = true
      try {
        currentValue = await factory()
      } catch {
        currentValue = defaultValue
      }
      trigger()
    }, { lazy: true })
    return {
      get() {
        track()
        if (!initialized) {
          update()
        }
        return currentValue
      },
      set() {
        // ignore
      },
    }
  })
}


function initializeSurface<T>(valueRef: Ref<T>, reactiveObject: T) {
  let running = 0
  const markRunning = async (value: number) => {
    running = value
    await 'next tick'
    running = 0
  }
  effect(() => {
    const latest = unref(valueRef)
    if (running) return
    markRunning(1)
    const rawObject = toRaw(reactiveObject)
    const latestKeys = Object.keys(latest)
    const currentKeys = Object.keys(rawObject)
    difference(latestKeys, currentKeys).forEach(key => {
      reactiveObject[key] = latest[key]
    })
    intersection(currentKeys, latestKeys).forEach(key => {
      if (!isEqual(rawObject[key], latest[key])) {
        reactiveObject[key] = latest[key]
      }
    })
    difference(currentKeys, latestKeys).forEach(key => {
      delete reactiveObject[key]
    })
  })
  effect(() => {
    const value = { ...reactiveObject }
    if (running) return
    markRunning(2)
    valueRef.value = value
  })
}

export function surface<T extends object>(valueRef: Ref<T>, lazy?: boolean) {
  const reactiveObject = shallowReactive({} as T) as T
  if (lazy) {
    let initialized = false
    const lockEffect = effect(() => {
      const value = unref(valueRef)
      if (!initialized) {
        initialized = true
        Object.assign(reactiveObject, value)
        return
      }
      stop(lockEffect)
      initializeSurface(valueRef, reactiveObject)
    })
  } else {
    initializeSurface(valueRef, reactiveObject)
  }
  return reactiveObject
}
