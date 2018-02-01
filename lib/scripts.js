/*!
 * Copyright(c) 2018 Jan Blaha
 *
 * Extension allowing to add custom javascript hooks into the rendering process.
 */

const nanoid = require('nanoid')
const path = require('path')
const Promise = require('bluebird')

function handleAfterRender (reporter) {
  return (request, response) =>
    Promise.mapSeries(request.context._parsedScripts, (script) => handleOneAfterRender(reporter, request, response, script))
}

async function handleOneAfterRender (reporter, request, response, script) {
  const executeScript = Promise.promisify(reporter.scriptManager.execute).bind(reporter.scriptManager)
  const body = await executeScript({
    script: script,
    allowedModules: (reporter.options.scripts || {}).allowedModules,
    appDirectory: reporter.options.appDirectory,
    rootDirectory: reporter.options.rootDirectory,
    parentModuleDirectory: reporter.options.parentModuleDirectory,
    method: 'afterRender',
    request: {
      data: request.data,
      template: request.template,
      options: request.options,
      headers: request.headers
    },
    response: {
      headers: response.headers,
      content: response.content
    },
    timeout: (reporter.options.scripts || {}).timeout
  }, {
    callback: function (req, cb) {
      handleCallback(reporter, request, req, cb)
    },
    execModulePath: reporter.execution ? reporter.execution.resolve('scriptEvalChild.js') : path.join(__dirname, 'scriptEvalChild.js'),
    timeout: (reporter.options.scripts || {}).timeout
  })

  if (body.logs) {
    body.logs.forEach(function (m) {
      request.logger[m.level](m.message, {timestamp: new Date(m.timestamp)})
    })
  }

  if (body.error) {
    body.error.weak = true
    return Promise.reject(body.error)
  }

  response.headers = body.response.headers
  response.content = Buffer.from(body.response.content)
  return response
}

function handleBeforeRender (reporter) {
  return async (request, response) => {
    request.context._parsedScripts = []
    const scripts = await findScripts(reporter, request)
    return Promise.mapSeries(scripts, (script) => handleOneBeforeRender(reporter, request, response, script))
  }
}

async function findScripts (reporter, request) {
  // old format scriptId in template
  if (!request.template.scripts && !request.template.script && request.template.scriptId) {
    request.template.scripts = [{shortid: request.template.scriptId}]
  }

  // old format in script
  if (!request.template.scripts && request.template.script && (request.template.script.content || request.template.script.shortid || request.template.script.name)) {
    request.template.scripts = [request.template.script]
  }

  // no scripts
  if (!request.template.scripts) {
    request.template.scripts = []
  }

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

    const items = await reporter.documentStore.collection('scripts').find(query, request)
    if (items.length < 1) {
      const error = new Error('Script not found or user not authorized to read it (' + (script.shortid || script.name) + ')')
      error.weak = true
      throw error
    }
    return items[0]
  }))

  const globalItems = await reporter.documentStore.collection('scripts').find({ isGlobal: true }, request)
  return globalItems.concat(items)
}

async function handleOneBeforeRender (reporter, request, response, script) {
  const executeScript = Promise.promisify(reporter.scriptManager.execute).bind(reporter.scriptManager)
  reporter.logger.debug('Executing script ' + (script.shortid || script.name || 'anonymous'), request)
  script = script.content || script

  const scriptDef = {
    script: script,
    allowedModules: (reporter.options.scripts || {}).allowedModules,
    appDirectory: reporter.options.appDirectory,
    rootDirectory: reporter.options.rootDirectory,
    parentModuleDirectory: reporter.options.parentModuleDirectory,
    method: 'beforeRender',
    request: {
      data: request.data,
      template: request.template,
      headers: request.headers,
      options: request.options
    },
    response: response,
    timeout: (reporter.options.scripts || {}).timeout
  }

  await reporter.beforeScriptListeners.fire(scriptDef, request)
  const body = await executeScript(scriptDef, {
    execModulePath: reporter.execution ? reporter.execution.resolve('scriptEvalChild.js') : path.join(__dirname, 'scriptEvalChild.js'),
    timeout: (reporter.options.scripts || {}).timeout,
    callback: function (req, cb) {
      handleCallback(reporter, request, req, cb)
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

  request.data = body.request.data
  delete body.request.data

  merge(request, body.request)

  return response
}

async function handleCallback (reporter, originalReq, req, cb) {
  req.user = req.user || originalReq.user

  originalReq._scriptRequestCounter = originalReq._scriptRequestCounter || 0
  originalReq._scriptRequestCounter++
  req._scriptRequestCounter = originalReq._scriptRequestCounter

  if (originalReq._scriptRequestCounter > 3) {
    return cb(new Error('Reached maximum number of script rendering requests. Verify reporter.render is not causing cycle.'))
  }

  try {
    const res = await reporter.render(req)
    const serializableResponse = {
      headers: res.headers,
      content: res.content
    }

    cb(null, serializableResponse)
  } catch (e) {
    cb(e)
  }
}

function defineEntities (reporter) {
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

  reporter.documentStore.model.entityTypes['TemplateType'].scriptId = {type: 'Edm.String'}
  reporter.documentStore.model.entityTypes['TemplateType'].script = {type: 'jsreport.ScriptRefType'}
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
}

module.exports = function (reporter, definition) {
  reporter.beforeScriptListeners = reporter.createListenerCollection()
  defineEntities(reporter)
  definition.options.timeout = definition.options.timeout || 30000
  definition.options.allowedModules = definition.options.allowedModules || []
  reporter.options.scripts = definition.options

  reporter.beforeRenderListeners.insert({
    after: 'data',
    before: 'childTemplates'
  }, definition.name, reporter, handleBeforeRender(reporter))

  reporter.afterRenderListeners.add(definition.name, reporter, handleAfterRender(reporter))

  if (reporter.compilation) {
    reporter.compilation.include('scriptEvalChild.js', path.join(__dirname, 'scriptEvalChild.js'))
  }

  reporter.scripts = {
    handleAfterRender: handleAfterRender(reporter),
    handleBeforeRender: handleBeforeRender(reporter)
  }
}
