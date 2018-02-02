/*!
 * Copyright(c) 2018 Jan Blaha
 *
 * Extension allowing to add custom javascript hooks into the rendering process.
 */

const nanoid = require('nanoid')
const path = require('path')
const Promise = require('bluebird')

class Scripts {
  constructor (reporter, definition) {
    this.reporter = reporter
    this.definition = definition
    this.scriptManagerExecute = Promise.promisify(reporter.scriptManager.execute).bind(reporter.scriptManager)

    reporter.documentStore.registerEntityType('ScriptType', {
      _id: {type: 'Edm.String', key: true},
      shortid: {type: 'Edm.String'},
      creationDate: {type: 'Edm.DateTimeOffset'},
      modificationDate: {type: 'Edm.DateTimeOffset'},
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
      humanReadableKey: 'shortid',
      splitIntoDirectories: true
    })

    reporter.initializeListeners.add('scripts', () => {
      const col = reporter.documentStore.collection('scripts')
      col.beforeUpdateListeners.add('scripts', (query, update) => (update.$set.modificationDate = new Date()))
      col.beforeInsertListeners.add('scripts', (doc) => {
        doc.shortid = doc.shortid || nanoid(7)
        doc.creationDate = new Date()
        doc.modificationDate = new Date()
      })
    })

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
    }
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
    this.reporter.logger.debug('Executing script ' + (script.shortid || script.name || 'anonymous'), request)
    script = script.content || script

    const scriptDef = {
      script: script,
      allowedModules: this.definition.options.allowedModules,
      appDirectory: this.reporter.options.appDirectory,
      rootDirectory: this.reporter.options.rootDirectory,
      parentModuleDirectory: this.reporter.options.parentModuleDirectory,
      method: method,
      request: Object.assign({}, request),
      response: Object.assign({}, response),
      timeout: this.definition.options.timeout
    }

    await this.reporter.beforeScriptListeners.fire(scriptDef, request)
    const body = await this.scriptManagerExecute(scriptDef, {
      execModulePath: this.reporter.execution ? this.reporter.execution.resolve('scriptEvalChild.js') : path.join(__dirname, 'scriptEvalChild.js'),
      timeout: this.definition.options.timeout,
      callback: (req, cb) => {
        this._handleCallback(request, req, cb)
      }
    })

    if (body.logs) {
      body.logs.forEach(function (m) {
        request.logger[m.level](m.message, { timestamp: new Date(m.timestamp) })
      })
    }

    if (body.request && body.request.shouldRunAfterRender) {
      request.context._parsedScripts.push(scriptDef.script)
    }

    if (body.error) {
      body.error.weak = true
      throw body.error
    }

    if (body.cancelRequest) {
      const error = new Error('Rendering request canceled  from the script ' + body.additionalInfo)
      error.canceled = true
      error.weak = true
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
        const error = new Error('Script not found or user not authorized to read it (' + (script.shortid || script.name) + ')')
        error.weak = true
        throw error
      }
      return items[0]
    }))

    const globalItems = await this.reporter.documentStore.collection('scripts').find({ isGlobal: true }, request)
    return globalItems.concat(items)
  }

  async _handleCallback (originalReq, spec, cb) {
    if (spec.action === 'render') {
      spec.data.req.user = spec.data.req.user || originalReq.user

      originalReq._scriptRequestCounter = originalReq._scriptRequestCounter || 0
      originalReq._scriptRequestCounter++
      spec.data.req._scriptRequestCounter = originalReq._scriptRequestCounter

      if (originalReq._scriptRequestCounter > 3) {
        return cb(new Error('Reached maximum number of script rendering requests. Verify reporter.render is not causing cycle.'))
      }

      try {
        const res = await this.reporter.render(spec.data.req)
        cb(null, {
          content: res.content,
          meta: res.meta
        })
      } catch (e) {
        cb(e)
      }
    }
  }
}

module.exports = function (reporter, definition) {
  reporter.scripts = new Scripts(reporter, definition)
}
