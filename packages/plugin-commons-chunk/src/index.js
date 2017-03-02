/* @flow */

import { createChunkTransformer } from 'pundle-api'
import type { File, Chunk, ChunkTransformerResult, FileImport } from 'pundle-api/types'

export default createChunkTransformer(function(config: Object, chunks: Array<Chunk>): ChunkTransformerResult {
  const known: Set<string> = new Set()
  const files: Map<string, File> = new Map()
  let entries: Array<FileImport> = []

  chunks.forEach(function(chunk: Chunk) {
    chunk.files.forEach(function(file) {
      if (known.has(file.filePath)) {
        files.set(file.filePath, file)
      } else {
        known.add(file.filePath)
      }
    })
  })

  files.forEach(function(file: File) {
    chunks.forEach(function(chunk) {
      chunk.deleteFile(file.filePath)
    })
  })

  if (!files.size) {
    // No common chunks found
    return
  }
  chunks.forEach(function(chunk: Chunk) {
    entries = entries.concat(chunk.entry)
    chunk.entry = []
  })

  chunks.unshift(this.getChunk({
    entry: entries,
    imports: Array.from(files.values()).map(file => {
      const request = this.getImportRequest(file.filePath)
      request.resolved = file.filePath
      return request
    }),
  }, files))
})
