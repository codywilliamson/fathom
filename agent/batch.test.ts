import { describe, expect, test } from 'bun:test'
import { chunkEvents } from './batch'

describe('chunkEvents', () => {
  test('splits into size-N groups', () => {
    const items = Array.from({ length: 10 }, (_, i) => i)
    expect(chunkEvents(items, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]])
  })

  test('exact multiple leaves no trailing empty batch', () => {
    const items = Array.from({ length: 6 }, (_, i) => i)
    expect(chunkEvents(items, 3)).toEqual([[0, 1, 2], [3, 4, 5]])
  })

  test('empty input yields no batches', () => {
    expect(chunkEvents([], 1000)).toEqual([])
  })

  test('size bigger than input yields a single batch', () => {
    expect(chunkEvents([1, 2], 1000)).toEqual([[1, 2]])
  })

  test('rejects a non-positive size', () => {
    expect(() => chunkEvents([1], 0)).toThrow()
    expect(() => chunkEvents([1], -1)).toThrow()
  })
})
