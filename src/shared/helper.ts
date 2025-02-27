type IDIterator = (id: number) => number

export function createIDGenerator(iterator?: IDIterator) {
  if (!iterator) {
    iterator = id => id + 1
  }
  let id = 0
  return () => {
    id = iterator!(id)
    return id
  }
}

export function reuse<T>(fn: () => T) {
  const value = fn()
  return () => value
}

export interface Deferred {
  resolved: boolean,
  promise: Promise<void>,
  resolve: () => void,
}

export function createDeferred() {
  const deferred = {
    resolved: false,
  } as Deferred
  deferred.promise = new Promise<void>(resolve => {
    deferred.resolve = () => {
      deferred.resolved = true
      resolve()
    }
  })
  return deferred
}


export type Generable<T, U> = U | Promise<U> | Generator<T, U, never> | AsyncGenerator<T, U, never>

export function isIterator(value: any): value is Iterator<unknown> | AsyncIterator<unknown> {
  return Boolean(value) && typeof value.next === 'function'
}

export async function *iterate<T, U>(iteratee: Generable<T, U>): AsyncGenerator<T, U, never> {
  if (!isIterator(iteratee)) {
    return iteratee as Awaited<U>
  }
  let done: boolean | undefined
  while (!done) {
    const result = await iteratee.next()
    if (result.done) {
      return result.value as Awaited<U>
    } else {
      yield result.value
    }
    done = result.done
  }
  return undefined as never
}
