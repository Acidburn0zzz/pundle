/* @flow */

import OS from 'os'
import FS from 'sb-fs'
import Path from 'path'
import Crypto from 'crypto'
import invariant from 'assert'
import type Compilation from 'pundle/src/compilation'

import type { ServerConfig, ServerConfigInput } from '../types'

export const browserFile = require.resolve('./browser')
export function fillConfig(given: ServerConfigInput): ServerConfig {
  const config = {}

  if (given.hmrHost) {
    invariant(typeof given.hmrHost === 'string', 'config.hmrHost must be a string')
    config.hmrHost = given.hmrHost
  } else config.hmrHost = null
  if (given.hmrPath) {
    invariant(typeof given.hmrPath === 'string', 'config.hmrPath must be a string')
    config.hmrPath = given.hmrPath
  } else config.hmrHost = '__sb_pundle_hmr'
  if (typeof given.useCache !== 'undefined') {
    config.useCache = !!given.useCache
  } else config.useCache = true
  if (typeof given.hmrReports !== 'undefined') {
    config.hmrReports = !!given.hmrReports
  } else config.hmrReports = true
  if (given.bundlePath) {
    invariant(typeof given.bundlePath === 'string', 'config.bundlePath must be a string')
    config.bundlePath = given.bundlePath
  } else config.bundlePath = '/bundle.js'
  if (typeof given.sourceMap !== 'undefined') {
    config.sourceMap = !!given.sourceMap
  } else config.sourceMap = true
  if (given.sourceMapPath) {
    invariant(typeof given.sourceMapPath === 'string', 'config.sourceMapPath must be a string')
    config.sourceMapPath = given.sourceMapPath
  } else config.sourceMapPath = `${config.bundlePath}.map`

  invariant(given.port && typeof given.port === 'number', 'config.port must be a valid number')
  invariant(given.rootDirectory && typeof given.rootDirectory === 'string', 'config.rootDirectory must be a valid string')
  config.port = given.port
  config.rootDirectory = given.rootDirectory
  config.redirectNotFoundToIndex = !!given.redirectNotFoundToIndex

  return config
}

export async function getCacheFilePath(directory: string): Promise<string> {
  const stateDirectory = Path.join(OS.homedir(), '.pundle')
  try {
    await FS.stat(stateDirectory)
  } catch (error) {
    if (error.code === 'ENOENT') {
      await FS.mkdir(stateDirectory)
    } else throw error
  }

  const inputHash = Crypto.createHash('sha1').update(directory).digest('hex')
  return Path.join(stateDirectory, `${inputHash}.json`)
}

export function isCompilationRegistered(compilation: Compilation): boolean {
  return compilation.config.entry.indexOf(browserFile) !== -1 ||
         compilation.config.replaceVariables.SB_PUNDLE_HMR_PATH ||
         compilation.config.replaceVariables.SB_PUNDLE_HMR_PATH
}

export function registerCompilation(compilation: Compilation, config: ServerConfig): void {
  compilation.config.entry.unshift(browserFile)
  compilation.config.replaceVariables.SB_PUNDLE_HMR_PATH = JSON.stringify(config.hmrPath)
  compilation.config.replaceVariables.SB_PUNDLE_HMR_HOST = JSON.stringify(config.hmrHost)
}

export function unregisterCompilation(compilation: Compilation): void {
  delete compilation.config.replaceVariables.SB_PUNDLE_HMR_PATH
  delete compilation.config.replaceVariables.SB_PUNDLE_HMR_HOST
  const browserFileIndex = compilation.config.entry.indexOf(browserFile)
  if (browserFileIndex !== -1) {
    compilation.config.entry.splice(browserFileIndex, 1)
  }
}

export function deferPromise(): Object {
  let reject
  let resolve
  const promise = new Promise(function(givenResolve, givenReject) {
    reject = givenReject
    resolve = givenResolve
  })
  return { reject, resolve, promise }
}

export function getWssServer(): Function {
  try {
    // eslint-disable-next-line global-require
    return require('uws').Server
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      throw error
    }
    // eslint-disable-next-line global-require
    return require('ws').Server
  }
}
