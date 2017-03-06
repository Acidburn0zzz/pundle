/* @flow */

import Path from 'path'
import invariant from 'assert'
import sourceMapToComment from 'source-map-to-comment'
import { createGenerator } from 'pundle-api'
import { SourceMapGenerator } from 'source-map'
import type { Chunk, GeneratorResult } from 'pundle-api/types'
import * as Helpers from './helpers'

// Spec:
// - Merge both plugin config and runtime config into one
// - Normalize and resolve all given entries
// - Get contents of wrappers
// - Create an chunks contents array
// - Create an source map generator
// - On each file:
//   - Get public path of each file
//   - Generate wrapped contents
//   - Update lines count based on newly generated contnets
//   - Include source map (if exists) into the chunks source map
// - Push map of registered mappings into chunks
// - Push all requires into chunks
// - Push sourceMap stringified or it's path (depending on config) (if enabled)
// - Return all chunks joined, and sourceMap (if enabled)

export default createGenerator(async function(config: Object, chunk: Chunk): Promise<GeneratorResult> {
  const entries = chunk.getEntry()
  const wrapperContents = await Helpers.getWrapperContents(this, config)

  const chunks = [';(function() {', wrapperContents]
  const outputName = Helpers.getOutputName(chunk.id)
  const chunksMap = new SourceMapGenerator({
    skipValidation: true,
  })
  // NOTE: I don't know why we need a +1, but adding it makes things work
  let linesCount = Helpers.getLinesCount(chunks.join('\n')) + 1

  for (const file of chunk.files.values()) {
    const publicPath = Helpers.getFilePath(this, config, file.filePath)
    const fileContents = `__sbPundle.registerModule("${publicPath}", function(__filename, __dirname, require, module, exports) {\n${file.contents}\n});`
    chunks.push(fileContents)
    const fileSourceMap = file.sourceMap
    if (config.sourceMap) {
      if (fileSourceMap) {
        const sourceMapPath = Path.join(`$${config.sourceMapNamespace}`, Path.relative(this.config.rootDirectory, file.filePath))
        Helpers.mergeSourceMap(fileSourceMap, chunksMap, `pundle:///${sourceMapPath}`, file.source, linesCount)
      }
      linesCount += Helpers.getLinesCount(fileContents)
    }
  }

  chunks.push(`__sbPundle.registerMappings(${JSON.stringify(outputName.toString())}, ${JSON.stringify(Helpers.getMappings(this, chunk, config))})`)

  const externalEntries = []
  entries.forEach(function(entry) {
    const found = config.chunkMappings.find(mapping => (mapping.module === entry.id))
    if (found) {
      externalEntries.push(found)
    }
  })
  if (externalEntries.length) {
    chunks.push(`__sbPundle.ensure(${JSON.stringify(externalEntries.map(i => i.chunk.toString()))}, '$root', function() {`)
  }
  for (let i = 0, length = entries.length; i < length; i++) {
    invariant(entries[i].resolved, `Entry file '${entries[i].request}' was not resolved`)
    chunks.push(`__sbPundle.require('${Helpers.getFilePath(this, config, entries[i].resolved)}')`)
  }
  if (externalEntries.length) {
    chunks.push('})')
  }
  chunks.push('})();\n')

  const sourceMap = chunksMap.toJSON()
  if (config.sourceMap) {
    if (config.sourceMapPath === 'inline') {
      chunks.push(sourceMapToComment(sourceMap))
    }
  }

  return {
    contents: chunks.join('\n'),
    sourceMap,
    outputName,
    filesGenerated: Array.from(chunk.files.keys()),
  }
}, {
  entry: null,
  wrapper: 'normal',
  pathType: 'filePath',
  sourceMap: false,
  chunkMappings: [],
  sourceMapPath: null,
  sourceNamespace: 'app',
  sourceMapNamespace: 'app',
})
