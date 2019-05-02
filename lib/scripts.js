/*!
 * Copyright(c) 2018 Jan Blaha
 *
 * Extension allowing to add custom javascript hooks into the rendering process.
 */

const path = require('path')
const Promise = require('bluebird')
const defaultProxyHandlers = require('./defaultProxyHandlers')
const proxyHandle = require('./jsreportProxy').handle

class Scripts {
  constructor (reporter, definition) {
    this.reporter = reporter
    this.definition = definition

    this._proxyMethods = []
    this._proxyHandlers = []

    if (reporter.options.allowLocalFilesAccess === true && !definition.options.allowedModules) {
      definition.options.allowedModules = '*'
    }

    reporter.documentStore.registerEntityType('ScriptType', {
      content: {type: 'Edm.String', document: {extension: 'js'}},
      name: {type: 'Edm.String', publicKey: true},
      isGlobal: {type: 'Edm.Boolean'}
    })

    reporter.documentStore.registerComplexType('ScriptRefType', {
      content: {type: 'Edm.String'},
      shortid: {type: 'Edm.String'}
    })

    reporter.documentStore.model.entityTypes['TemplateType'].scripts = {type: 'Collection(jsreport.ScriptRefType)'}
    reporter.documentStore.registerEntitySet('scripts', {
      entityType: 'jsreport.ScriptType',
      splitIntoDirectories: true
    })

    reporter.addRequestContextMetaConfig('_parsedScripts', { sandboxHidden: true })
    reporter.addRequestContextMetaConfig('_scriptRequestCounter', { sandboxHidden: true })
    reporter.addRequestContextMetaConfig('shouldRunAfterRender', { sandboxHidden: true })

    reporter.beforeScriptListeners = reporter.createListenerCollection()
    definition.options.timeout = definition.options.timeout || 30000
    definition.options.allowedModules = definition.options.allowedModules || []
    reporter.options.scripts = definition.options

    reporter.beforeRenderListeners.insert({
      after: 'data',
      before: 'childTemplates'
    }, definition.name, reporter, this.handleBeforeRender.bind(this))

    reporter.afterRenderListeners.add(definition.name, reporter, this.handleAfterRender.bind(this))

    if (reporter.compilation) {
      reporter.compilation.include('scriptEvalChild.js', path.join(__dirname, 'scriptEvalChild.js'))
      reporter.compilation.include('defaultProxyMethods.js', path.join(__dirname, 'defaultProxyMethods.js'))
    }

    if (this.reporter.execution) {
      this.addProxyMethods(this.reporter.execution.resolve('defaultProxyMethods.js'), defaultProxyHandlers)
    } else {
      this.addProxyMethods(path.join(__dirname, 'defaultProxyMethods.js'), defaultProxyHandlers)
    }
  }

  addProxyMethods (modulePath, moduleHandler) {
    this._proxyMethods.push(modulePath)
    this._proxyHandlers.push(moduleHandler)
  }

  async handleBeforeRender (request, response) {
    request.context._parsedScripts = []
    const scripts = await this._findScripts(request)
    return Promise.mapSeries(scripts, (script) => this._executeScript(request, response, script, 'beforeRender'))
  }

  handleAfterRender (request, response) {
    return Promise.mapSeries(request.context._parsedScripts, (script) => this._executeScript(request, response, script, 'afterRender'))
  }

  async _executeScript (request, response, script, method) {
    this.reporter.logger.debug('Executing script ' + (script.name || script.shortid || 'anonymous'), request)
    script = typeof script === 'string' ? script : script.content

    const scriptDef = {
      script: script,
      requestContextMetaConfig: this.reporter.getRequestContextMetaConfig(),
      allowedModules: this.definition.options.allowedModules,
      safeSandboxPath: this.reporter.options.templatingEngines.safeSandboxPath,
      appDirectory: this.reporter.options.appDirectory,
      rootDirectory: this.reporter.options.rootDirectory,
      parentModuleDirectory: this.reporter.options.parentModuleDirectory,
      proxyMethods: this._proxyMethods,
      method: method,
      request: Object.assign({}, request),
      response: Object.assign({}, response),
      timeout: this.definition.options.timeout
    }

    await this.reporter.beforeScriptListeners.fire(scriptDef, request)

    const body = await this.reporter.executeScript(scriptDef, {
      execModulePath: this.reporter.execution ? this.reporter.execution.resolve('scriptEvalChild.js') : path.join(__dirname, 'scriptEvalChild.js'),
      timeout: this.definition.options.timeout,
      timeoutErrorMessage: 'Timeout during execution of user script',
      callback: (spec, cb) => proxyHandle(this.reporter, {
        handlers: this._proxyHandlers,
        request,
        spec
      }, cb)
    }, request)

    if (body.logs) {
      body.logs.forEach((m) => {
        this.reporter.logger[m.level](m.message, {...request, timestamp: m.timestamp})
      })
    }

    if (body.request && body.request.context.shouldRunAfterRender && method === 'beforeRender') {
      request.context._parsedScripts.push(scriptDef.script)
    }

    if (body.error) {
      const error = this.reporter.createError(body.error.message, {
        weak: true
      })

      error.stack = body.error.stack
      throw error
    }

    if (body.cancelRequest) {
      const error = this.reporter.createError(`Rendering request canceled from the script ${body.additionalInfo}`, {
        weak: true
      })

      error.canceled = true
      throw error
    }

    function merge (obj, obj2) {
      for (const key in obj2) {
        if (typeof obj2[key] === 'undefined') {
          continue
        }

        if (typeof obj2[key] !== 'object' || typeof obj[key] === 'undefined') {
          obj[key] = obj2[key]
        } else {
          merge(obj[key], obj2[key])
        }
      }
    }

    if (method === 'beforeRender') {
      request.data = body.request.data
      delete body.request.data
      merge(request, body.request)
    }

    if (method === 'afterRender') {
      response.content = Buffer.from(body.response.content)
      delete body.response.content
      merge(response, body.response)
    }

    return response
  }

  async _findScripts (request) {
    request.template.scripts = request.template.scripts || []

    const items = await Promise.all(request.template.scripts.map(async (script) => {
      if (script.content) {
        return script
      }

      const query = {}
      if (script.shortid) {
        query.shortid = script.shortid
      }

      if (script.name) {
        query.name = script.name
      }

      const items = await this.reporter.documentStore.collection('scripts').find(query, request)
      if (items.length < 1) {
        const error = this.reporter.createError(`Script not found or user not authorized to read it (${
          (script.shortid || script.name)
        })`, {
          weak: true,
          statusCode: 403
        })

        throw error
      }
      return items[0]
    }))

    const globalItems = await this.reporter.documentStore.collection('scripts').find({ isGlobal: true }, request)
    return globalItems.concat(items)
  }
}

module.exports = function (reporter, definition) {
  reporter.scripts = new Scripts(reporter, definition)
}
