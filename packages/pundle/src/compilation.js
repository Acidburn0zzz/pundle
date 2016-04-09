'use strict'

/* @flow */

import { CompositeDisposable, Emitter, Disposable } from 'sb-event-kit'
import { watch } from 'chokidar'
import sourceMapToComment from 'source-map-to-comment'
import { generateBundle, generateSourceMap } from './processor/generator'
import transform from './processor/transformer'
import { normalizeWatcherOptions } from './helpers'
import type { Pundle$Module, Pundle$Watcher$Options$User } from './types'
import type Pundle from './index.js'

export default class Compilation {
  pundle: Pundle;
  modules: Map<string, Pundle$Module>;
  emitter: Emitter;
  subscriptions: CompositeDisposable;

  constructor(pundle: Pundle) {
    this.pundle = pundle
    this.modules = new Map()
    this.emitter = new Emitter()
    this.subscriptions = new CompositeDisposable()

    this.subscriptions.add(this.emitter)
  }
  async compile(): Promise {
    await Promise.all(this.pundle.config.entry.map(entry => this.read(entry)))
  }
  async read(filePath: string): Promise {
    await this.push(filePath, await this.pundle.fileSystem.readFile(this.pundle.path.out(filePath)))
  }
  async push(givenFilePath: string, contents: string): Promise {
    let event
    const filePath = this.pundle.path.in(givenFilePath)
    const oldModule = this.modules.get(filePath)
    if (oldModule && oldModule.sources === contents) {
      return
    }
    event = { filePath, contents, sourceMap: null, imports: [] }
    await this.emitter.emit('before-compile', event)
    const processed = await transform(filePath, this.pundle, event)
    event = { filePath, contents: processed.contents, sourceMap: processed.sourceMap, imports: processed.imports }
    await this.emitter.emit('after-compile', event)
    this.modules.set(filePath, {
      imports: event.imports,
      sources: contents,
      contents: event.contents,
      filePath,
      sourceMap: event.sourceMap
    })
    try {
      await Promise.all(event.imports.map(importId => {
        if (!this.modules.has(importId)) {
          return this.read(importId)
        }
        return null
      }))
    } catch (_) {
      if (oldModule) {
        this.modules.set(filePath, oldModule)
      } else this.modules.delete(filePath)
      throw _
    }
    if (oldModule && oldModule.imports.join('') !== event.imports.join('')) {
      this.garbageCollect()
    }
  }
  generate(): string {
    return generateBundle(this.pundle, this.pundle.config.entry, this.getAllModuleImports())
  }
  generateSourceMap(asComment: boolean = false): string {
    const sourceMap = generateSourceMap(this.pundle, this.getAllModuleImports())
    if (asComment) {
      return sourceMapToComment(sourceMap)
    }
    return JSON.stringify(sourceMap)
  }
  getAllModuleImports(): Array<Pundle$Module> {
    const countedIn = new Set()
    const moduleImports = []
    for (const entry of this.pundle.config.entry) {
      this.getModuleImports(this.pundle.path.in(entry), moduleImports, countedIn)
    }
    return moduleImports
  }
  getModuleImports(
    moduleId: string,
    moduleImports: Array<Pundle$Module> = [],
    countedIn: Set<string> = new Set()
  ): Array<Pundle$Module> {
    const module = this.modules.get(moduleId)
    if (!module) {
      throw new Error(`Module '${moduleId}' not found`)
    }
    countedIn.add(moduleId)
    moduleImports.push(module)
    for (const entry of module.imports) {
      if (!countedIn.has(entry)) {
        this.getModuleImports(entry, moduleImports, countedIn)
      }
    }
    return moduleImports
  }
  garbageCollect() {
    const toRemove = []
    const modules = new Set(this.getAllModuleImports())
    for (const [key, value] of this.modules) {
      if (!modules.has(value)) {
        toRemove.push(key)
      }
    }
    for (const entry of toRemove) {
      this.modules.delete(entry)
    }
  }
  watch(givenOptions: Pundle$Watcher$Options$User): { disposable: Disposable, queue: Promise } {
    const options = normalizeWatcherOptions(givenOptions)
    const watcher = watch(this.pundle.config.rootDirectory, {
      depth: 10,
      ignored: options.ignored,
      ignoreInitial: true,
      followSymlinks: false,
      ignorePermissionErrors: true
    })
    const toReturn = {
      queue: Promise.resolve(),
      disposable: new Disposable(() => {
        this.subscriptions.remove(toReturn.disposable)
        watcher.close()
      })
    }
    watcher.on('ready', () => {
      toReturn.queue.then(() => {
        if (options.onReady) {
          options.onReady.call(this)
        }
      })
    })
    watcher.on('change', filePath => {
      toReturn.queue = toReturn.queue.then(() => {
        if (options.onBeforeCompile) {
          options.onBeforeCompile.call(this, filePath)
        }
        return this.read(filePath).then(function() {
          if (options.onAfterCompile) {
            options.onAfterCompile.call(this, filePath, null)
          }
        }, function(error) {
          if (options.onAfterCompile) {
            options.onAfterCompile.call(this, filePath, error)
          }
        })
      }).catch(options.onError)
    })

    this.subscriptions.add(toReturn.disposable)
    return toReturn
  }
  needsGeneration(): boolean {
    try {
      this.getAllModuleImports()
      return false
    } catch (_) {
      return true
    }
  }
  onBeforeCompile(callback: Function): Disposable {
    return this.emitter.on('before-compile', callback)
  }
  onAfterCompile(callback: Function): Disposable {
    return this.emitter.on('after-compile', callback)
  }
  onDidDestroy(callback: Function): Disposable {
    return this.emitter.on('did-destroy', callback)
  }
  dispose() {
    this.emitter.emit('did-destroy')
    this.subscriptions.dispose()
  }
}
