/*!
 * Copyright(c) 2014 Jan Blaha
 *
 * Extension allowing to add custom javascript hooks into the rendering process.
 */

var shortid = require('shortid')
var path = require('path')
var q = require('q')

var Scripts = function (reporter, definition) {
  this.reporter = reporter
  this.definition = definition
  this.definition.options.timeout = this.definition.options.timeout || 30000

  this._defineEntities()

  this.reporter.beforeRenderListeners.insert({
    after: 'data',
    before: 'childTemplates'
  }, definition.name, this, Scripts.prototype.handleBeforeRender)
  this.reporter.afterRenderListeners.add(definition.name, this, Scripts.prototype.handleAfterRender)

  this.allowedModules = this.definition.options.allowedModules || []
}

Scripts.prototype.handleAfterRender = function (request, response) {
  var self = this
  return request._parsedScripts.map(function (script) {
    return function () {
      return self._handleOneAfterRender(request, response, script)
    }
  }).reduce(q.when, q())
}

Scripts.prototype._handleOneAfterRender = function (request, response, script) {
  var self = this

  return q.ninvoke(request.reporter.scriptManager, 'execute', {
    script: script,
    allowedModules: self.allowedModules,
    appDirectory: self.reporter.options.appDirectory,
    rootDirectory: self.reporter.options.rootDirectory,
    parentModuleDirectory: self.reporter.options.parentModuleDirectory,
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
    }
  }, {
    callback: function (req, cb) {
      self._handleCallback(request, req, cb)
    },
    execModulePath: path.join(__dirname, 'scriptEvalChild.js'),
    timeout: self.definition.options.timeout
  }).then(function (body) {
    if (body.logs) {
      body.logs.forEach(function (m) {
        request.logger[m.level](m.message, {timestamp: new Date(m.timestamp)})
      })
    }

    if (body.error) {
      body.error.weak = true
      return q.reject(body.error)
    }

    response.headers = body.response.headers
    response.content = new Buffer(body.response.content)
  })
}

Scripts.prototype.handleBeforeRender = function (request, response) {
  var self = this
  request._parsedScripts = []
  return this._findScripts(request).then(function (scripts) {
    return scripts.map(function (script) {
      return function () {
        return self._handleOneBeforeRender(request, response, script)
      }
    }).reduce(q.when, q())
  })
}

Scripts.prototype._findScripts = function (request) {
  var self = this

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

  return q.all(request.template.scripts.map(function (script) {
    if (script.content) {
      return q(script)
    }

    var query = {}
    if (script.shortid) {
      query.shortid = script.shortid
    }

    if (script.name) {
      query.name = script.name
    }

    return self.reporter.documentStore.collection('scripts').find(query, request).then(function (items) {
      if (items.length < 1) {
        throw new Error('Script not found or user not authorized to read it (' + (script.shortid || script.name) + ')')
      }
      return items[0]
    })
  }))
}

Scripts.prototype._handleOneBeforeRender = function (request, response, script) {
  var self = this
  request.logger.debug('Executing script ' + (script.shortid || script.name || 'anonymous'))
  script = script.content || script

  return q.ninvoke(request.reporter.scriptManager, 'execute', {
    script: script,
    allowedModules: self.allowedModules,
    appDirectory: self.reporter.options.appDirectory,
    rootDirectory: self.reporter.options.rootDirectory,
    parentModuleDirectory: self.reporter.options.parentModuleDirectory,
    method: 'beforeRender',
    request: {
      data: request.data,
      template: request.template,
      headers: request.headers,
      options: request.options
    },
    response: response
  }, {
    execModulePath: path.join(__dirname, 'scriptEvalChild.js'),
    timeout: self.definition.options.timeout,
    callback: function (req, cb) {
      self._handleCallback(request, req, cb)
    }
  }).then(function (body) {
    if (body.logs) {
      body.logs.forEach(function (m) {
        request.logger[m.level](m.message, {timestamp: new Date(m.timestamp)})
      })
    }

    if (body.error) {
      body.error.weak = true
      return q.reject(body.error)
    }

    if (body.cancelRequest) {
      var error = new Error('Rendering request canceled  from the script ' + body.additionalInfo)
      error.canceled = true
      error.weak = true
      return q.reject(error)
    }

    if (body.shouldRunAfterRender) {
      request._parsedScripts.push(script)
    }

    function merge (obj, obj2) {
      for (var key in obj2) {
        if (typeof obj2[key] === undefined) {
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
  })
}

Scripts.prototype._handleCallback = function (originalReq, req, cb) {
  req.user = req.user || originalReq.user

  originalReq._scriptRequestCounter = originalReq._scriptRequestCounter || 0
  originalReq._scriptRequestCounter++
  req._scriptRequestCounter = originalReq._scriptRequestCounter

  if (originalReq._scriptRequestCounter > 3) {
    return cb(new Error('Reached maximum number of script rendering requests. Verify reporter.render is not causing cycle.'))
  }

  this.reporter.render(req).then(function (res) {
    var serializableResponse = {
      headers: res.headers,
      content: res.content
    }

    cb(null, serializableResponse)
  }).catch(function (e) {
    cb(e)
  })
}

Scripts.prototype._defineEntities = function () {
  var self = this
  this.reporter.documentStore.registerEntityType('ScriptType', {
    _id: {type: 'Edm.String', key: true},
    shortid: {type: 'Edm.String'},
    creationDate: {type: 'Edm.DateTimeOffset'},
    modificationDate: {type: 'Edm.DateTimeOffset'},
    content: {type: 'Edm.String', document: {extension: 'js'}},
    name: {type: 'Edm.String', publicKey: true}
  })

  this.reporter.documentStore.registerComplexType('ScriptRefType', {
    content: {type: 'Edm.String'},
    shortid: {type: 'Edm.String'}
  })

  this.reporter.documentStore.model.entityTypes['TemplateType'].scriptId = {type: 'Edm.String'}
  this.reporter.documentStore.model.entityTypes['TemplateType'].script = {type: 'jsreport.ScriptRefType'}
  this.reporter.documentStore.model.entityTypes['TemplateType'].scripts = {type: 'Collection(jsreport.ScriptRefType)'}
  this.reporter.documentStore.registerEntitySet('scripts', {
    entityType: 'jsreport.ScriptType',
    humanReadableKey: 'shortid',
    splitIntoDirectories: true
  })

  this.reporter.initializeListeners.add('scripts', function () {
    var col = self.reporter.documentStore.collection('scripts')
    col.beforeUpdateListeners.add('scripts', function (query, update) {
      update.$set.modificationDate = new Date()
    })
    col.beforeInsertListeners.add('scripts', function (doc) {
      doc.shortid = doc.shortid || shortid.generate()
      doc.creationDate = new Date()
      doc.modificationDate = new Date()
    })
  })
}

module.exports = function (reporter, definition) {
  reporter[definition.name] = new Scripts(reporter, definition)
}
