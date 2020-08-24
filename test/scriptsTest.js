const should = require('should')
const path = require('path')
const Reporter = require('jsreport-core')
const createRequest = require('jsreport-core/lib/render/request')
// requiring winston that is dep of jsreport-core to be
// able to cleanup transports
const winston = require('winston')

describe('scripts', () => {
  let reporter

  beforeEach(() => {
    if (winston.loggers.has('jsreport')) {
      winston.loggers._delete('jsreport')
    }
  })

  afterEach(() => reporter.close())

  describe('scripts with dedicated-process strategy', () => {
    beforeEach(() => {
      reporter = Reporter()
        .use(require('jsreport-templates')())
        .use(require('jsreport-assets')())
        .use(require('jsreport-jsrender')())
        .use(require('../')({ allowedModules: ['bluebird'], timeout: 4000 }))
      return reporter.init()
    })

    common()
    commonSafe()
  })

  describe('scripts with http-server strategy', () => {
    beforeEach(() => {
      reporter = Reporter({
        templatingEngines: { strategy: 'http-server' }
      }).use(require('jsreport-templates')())
        .use(require('jsreport-jsrender')())
        .use(require('jsreport-assets')())
        .use(require('../')({ allowedModules: ['bluebird'], timeout: 4000 }))

      return reporter.init()
    })

    common()
    commonSafe()
  })

  describe('scripts with in-process strategy', () => {
    beforeEach(() => {
      reporter = Reporter({
        templatingEngines: { strategy: 'in-process' },
        extensions: {
          scripts: {
            allowedModules: ['./helperA', 'underscore', 'bluebird'],
            timeout: 4000
          }
        }
      }).use(require('jsreport-templates')())
        .use(require('jsreport-jsrender')())
        .use(require('jsreport-assets')())
        .use(require('../')())
      return reporter.init()
    })

    it('should be able to require local functions', async () => {
      const req = createRequest({
        template: {
          scripts: [{ content: "function beforeRender(req, res, done) { req.template.content = require('./helperA')(); done(); }" }]
        }
      })

      await reporter.scripts.handleBeforeRender(req, {})
      req.template.content.should.be.eql('a')
    })

    common()
  })

  async function prepareTemplate (scriptContent) {
    const script = await reporter.documentStore.collection('scripts').insert({ name: 'script', content: scriptContent })
    return reporter.documentStore.collection('templates').insert({
      content: 'foo',
      name: 'foo',
      engine: 'none',
      recipe: 'html',
      scripts: [{ shortid: script.shortid }]
    })
  }

  async function prepareRequest (scriptContent) {
    const template = await prepareTemplate(scriptContent)
    return {
      request: createRequest({ template: template, options: {} }),
      response: {}
    }
  }

  function commonSafe () {
    it('should propagate exception from async back', async () => {
      const res = await prepareRequest(`function beforeRender(req, res, done) { setTimeout(function() { foo; }, 0); }`)
      try {
        await reporter.scripts.handleBeforeRender(res.request, res.response)
        throw new Error('Should have fail')
      } catch (e) {
        if (e.message === 'Should have fail') {
          throw e
        }

        e.message.should.containEql('foo')
      }
    })
  }

  function common () {
    it('should find script by its name', async () => {
      const req = createRequest({ template: { scripts: [{ name: 'foo' }] } })
      const res = {}

      await reporter.documentStore.collection('scripts').insert({
        content: `function beforeRender(req, res, done) { req.template.content = 'xxx'; done() }`,
        name: 'foo'
      })

      await reporter.scripts.handleBeforeRender(req, res)
      req.template.content.should.be.eql('xxx')
    })

    it('should be able to handle multiple scripts in handleBeforeRender and execute them in order', async () => {
      await reporter.documentStore.collection('scripts').insert({
        name: 'a',
        content: 'function beforeRender(request, response, done) { request.template.content = \'a\'; done(); }',
        shortid: 'a'
      })
      await reporter.documentStore.collection('scripts').insert({
        content: 'function beforeRender(request, response, done) { request.template.content += \'b\'; done(); }',
        shortid: 'b',
        name: 'b'
      })
      await reporter.documentStore.collection('scripts').insert({
        content: 'function beforeRender(request, response, done) { request.template.content += \'c\'; done(); }',
        shortid: 'c',
        name: 'c'
      })
      await reporter.documentStore.collection('scripts').insert({
        content: 'function beforeRender(request, response, done) { request.template.content += \'d\'; done(); }',
        shortid: 'd',
        name: 'd'
      })

      const req = createRequest({
        template: { content: 'foo', scripts: [{ shortid: 'a' }, { shortid: 'b' }, { shortid: 'c' }, { shortid: 'd' }] }
      })
      await reporter.scripts.handleBeforeRender(req, {})
      req.template.content.should.be.eql('abcd')
    })

    it('should throw only weak error when script is not found', async () => {
      const req = createRequest({
        template: { content: 'foo', scripts: [{ shortid: 'a' }] }
      })

      try {
        await reporter.scripts.handleBeforeRender(req, {})
      } catch (e) {
        e.weak.should.be.ok()
      }
    })

    it('should be able to handle multiple scripts in afterRender and execute them in order', async () => {
      await reporter.documentStore.collection('scripts').insert({
        name: 'a',
        content: 'function afterRender(request, response, done) { response.content = \'a\'; done(); }',
        shortid: 'a'
      })
      await reporter.documentStore.collection('scripts').insert({
        content: 'function afterRender(request, response, done) { response.content = Buffer.from(response.content).toString() + \'b\'; done(); }',
        name: 'b',
        shortid: 'b'
      })
      await reporter.documentStore.collection('scripts').insert({
        content: 'function afterRender(request, response, done) { response.content = Buffer.from(response.content).toString() + \'c\'; done(); }',
        name: 'c',
        shortid: 'c'
      })
      await reporter.documentStore.collection('scripts').insert({
        content: 'function afterRender(request, response, done) { response.content = Buffer.from(response.content).toString() + \'d\'; done(); }',
        name: 'd',
        shortid: 'd'
      })

      const req = createRequest({
        template: { engine: 'none', recipe: 'html', content: 'foo', scripts: [{ shortid: 'a' }, { shortid: 'b' }, { shortid: 'c' }, { shortid: 'd' }] }
      })

      const res = await reporter.render(req)
      res.content.toString().should.be.eql('abcd')
    })

    it('should prepend global scripts in beforeRender', async () => {
      await reporter.documentStore.collection('scripts').insert({
        content: 'function beforeRender(request, response, done) { request.template.content += \'a\'; done(); }',
        name: 'a',
        shortid: 'a'
      })
      await reporter.documentStore.collection('scripts').insert({
        content: 'function beforeRender(request, response, done) { request.template.content += \'b\'; done(); }',
        name: 'b',
        shortid: 'b',
        isGlobal: true
      })

      const req = createRequest({
        template: { content: '', scripts: [{ shortid: 'a' }] }
      })
      await reporter.scripts.handleBeforeRender(req, {})
      req.template.content.should.be.eql('ba')
    })

    it('should not be able to see internal context data in scripts', async () => {
      const res = await prepareRequest(`
        function beforeRender(req, res, done) {
          req.data = req.data || {}
          req.data.beforeRender = {}
          req.data.beforeRender.haveParsedScripts = req.context._parsedScripts != null
          req.data.beforeRender.willRunAfterRender = req.context.shouldRunAfterRender === true
          done()
        }

        function afterRender(req, res, done) {
          res.content = JSON.stringify({
            afterRender: {
              haveParsedScripts: req.context._parsedScripts != null,
              willRunAfterRender: req.context.shouldRunAfterRender === true
            }
          })
          done()
        }
      `)

      await reporter.scripts.handleBeforeRender(res.request, res.response)
      await reporter.scripts.handleAfterRender(res.request, res.response)

      res.request.data.beforeRender.haveParsedScripts.should.be.false()
      res.request.data.beforeRender.willRunAfterRender.should.be.false()

      const resContent = JSON.parse(res.response.content.toString())

      resContent.afterRender.haveParsedScripts.should.be.false()
      resContent.afterRender.willRunAfterRender.should.be.false()
    })

    it('should be able to modify request.data', async () => {
      const res = await prepareRequest(`function beforeRender(req, res, done) { req.data = 'xxx'; done() } `)
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      res.request.data.should.be.eql('xxx')
    })

    it('should be able to modify complex request.data', async () => {
      const res = await prepareRequest(`function beforeRender(req, res, done) { req.data = { a: 'xxx' }; done() }`)
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      res.request.data.a.should.be.eql('xxx')
    })

    it('should be able to modify request.template.content', async () => {
      const res = await prepareRequest(`function beforeRender(req, res, done) { req.template.content = 'xxx'; done() }`)
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      res.request.template.content.should.be.eql('xxx')
    })

    it('should not be able to read local files', async () => {
      const scriptContent = `function beforeRender(req, res, cone) {
         var fs = require('fs');
        fs.readdir('d:\\', function(err, files) { response.filesLength = files.length; done(); });
      }`

      const res = await prepareRequest(scriptContent)
      try {
        await reporter.scripts.handleBeforeRender(res.request, res.response)
        throw new Error('Should have failed')
      } catch (e) {
        if (e.message === 'Should have failed') {
          throw e
        }
      }
    })

    it('should be able to processes async function', async () => {
      const res = await prepareRequest(`function beforeRender(req, res, done) { setTimeout(function(){ req.template.content = 'xxx'; done(); }, 10); }`)
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      res.request.template.content.should.be.eql('xxx')
    })

    it('should be able to processes beforeRender function', async () => {
      const res = await prepareRequest("function beforeRender(request, response, done){ request.template.content = 'xxx'; done(); }")
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      res.request.template.content.should.be.eql('xxx')
    })

    it('should be able to processes afterRender function', async () => {
      const res = await prepareRequest('function afterRender(request, response, done){ response.content[0] = 1; done(); }')
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      res.response.content = Buffer.from([1])
      await reporter.scripts.handleAfterRender(res.request, res.response)
      res.response.content[0].should.be.eql(1)
    })

    it('res.content in afterRender should be buffer', async () => {
      const res = await prepareRequest('function afterRender(req, res, done){ if (!Buffer.isBuffer(res.content)) { return done(new Error(\'not a buffer\')) } done(); }')
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      res.response.content = Buffer.from([1])
      await reporter.scripts.handleAfterRender(res.request, res.response)
    })

    it('should be able to add property to request', async () => {
      const res = await prepareRequest(`function beforeRender(req, res, done) { req.context.foo = 'xxx'; done(); } `)
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      res.request.context.foo.should.be.eql('xxx')
    })

    it('should be able to cancel request', async () => {
      const res = await prepareRequest(`function beforeRender(req, res, done) { req.cancel(); } `)
      try {
        await reporter.scripts.handleBeforeRender(res.request, res.response)
        throw new Error('Should have failed')
      } catch (e) {
        e.canceled.should.be.true()
        e.message.should.not.be.eql('Should have failed')
      }
    })

    it('should be able to cancel request with message', async () => {
      const res = await prepareRequest(`function beforeRender(req, res, done) { req.cancel('custom message'); } `)
      try {
        await reporter.scripts.handleBeforeRender(res.request, res.response)
        throw new Error('Should have failed')
      } catch (e) {
        e.canceled.should.be.true()
        e.message.should.containEql('custom message')
      }
    })

    it('should be able to cancel request with custom http status code', async () => {
      const res = await prepareRequest(`function beforeRender(req, res, done) { req.cancel({ message: 'custom message', statusCode: 406 }); } `)
      try {
        await reporter.scripts.handleBeforeRender(res.request, res.response)
        throw new Error('Should have failed')
      } catch (e) {
        e.canceled.should.be.true()
        e.statusCode.should.be.eql(406)
        e.message.should.containEql('custom message')
      }
    })

    it('should be able to define custom jsreport-proxy method', async () => {
      reporter.scripts.addProxyMethods(path.join(__dirname, 'customProxyMethod.js'), path.join(__dirname, 'customProxyHandler.js'))

      const request = {
        template: {
          content: '{{:message}}',
          recipe: 'html',
          engine: 'jsrender',
          scripts: [{
            content: `
              const jsreport = require('jsreport-proxy')
              async function beforeRender(req, res) {
                req.data = req.data || {}
                req.data.message = await jsreport.custom.sayHello('custom')
              }
            `
          }]
        }
      }

      const response = await reporter.render(request)
      response.content.toString().should.be.eql('hello custom')
    })

    it('should throw when passing invalid jsreport-proxy custom method module', async () => {
      reporter.scripts.addProxyMethods(path.join(__dirname, 'invalidCustomProxy.js'), path.join(__dirname, 'customProxyHandler.js'))

      const request = {
        template: {
          content: 'original',
          recipe: 'html',
          engine: 'jsrender',
          scripts: [{
            content: `
            `
          }]
        }
      }

      return should(reporter.render(request)).be.rejectedWith(/should export a function/)
    })

    it('should throw when passing invalid jsreport-proxy custom method handler module', async () => {
      reporter.scripts.addProxyMethods(path.join(__dirname, 'customProxyMethod.js'), path.join(__dirname, 'invalidCustomProxy.js'))

      const request = {
        template: {
          content: '{{:message}}',
          recipe: 'html',
          engine: 'jsrender',
          scripts: [{
            content: `
              const jsreport = require('jsreport-proxy')
              async function beforeRender(req, res) {
                req.data = req.data || {}
                req.data.message = await jsreport.custom.sayHello('custom')
              }
            `
          }]
        }
      }

      return should(reporter.render(request)).be.rejectedWith(/should export a function/)
    })

    it('should throw when no handler for jsreport-proxy custom method handler', async () => {
      reporter.scripts.addProxyMethods(path.join(__dirname, 'customProxyMethod.js'), path.join(__dirname, 'emptyProxyHandler.js'))

      const request = {
        template: {
          content: '{{:message}}',
          recipe: 'html',
          engine: 'jsrender',
          scripts: [{
            content: `
              const jsreport = require('jsreport-proxy')
              async function beforeRender(req, res) {
                req.data = req.data || {}
                req.data.message = await jsreport.custom.sayHello('custom')
              }
            `
          }]
        }
      }

      return should(reporter.render(request)).be.rejectedWith(/No jsreport-proxy method handler found for action/)
    })

    it('should be able to require jsreport-proxy and render', async () => {
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html'
      })
      const request = {
        template: {
          content: 'original',
          recipe: 'html',
          engine: 'jsrender',
          scripts: [{
            content: `
              const jsreport = require('jsreport-proxy')
              function afterRender(req, res, done) {
                jsreport.render({ template: { name: 'foo' } }).then((resp) => {
                  res.content = resp.content;
                  done();
                }).catch((e) => done(e))
              }`
          }]
        }
      }
      const response = await reporter.render(request)
      response.content.toString().should.be.eql('foo')
    })

    it('should be able to require jsreport-proxy and render and reust the shared context', async () => {
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'none',
        recipe: 'html',
        scripts: [{
          content: `
            async function afterRender(req, res) {
              req.context.shared.text += '2'
            }`
        }]
      })

      const request = {
        template: {
          content: 'original',
          recipe: 'html',
          engine: 'none',
          scripts: [{
            content: `
              const jsreport = require('jsreport-proxy')
              async function afterRender(req, res) {
                req.context.shared.text += '1'
                await jsreport.render({ template: { name: 'foo' } })
                req.context.shared.text += '3'
                res.content = req.context.shared.text
              }`
          }]
        },
        context: {
          shared: {
            text: ''
          }
        }
      }
      const response = await reporter.render(request)
      response.content.toString().should.be.eql('123')
    })

    it('should be able to require jsreport-proxy and render and get logs', async () => {
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: '{{:~sayHi("foo")}}',
        engine: 'jsrender',
        recipe: 'html',
        helpers: `
          function sayHi (name) {
            console.log('using helper "sayHi"')
            return "Hi " + name
          }
        `
      })

      const request = {
        template: {
          content: 'original',
          recipe: 'html',
          engine: 'jsrender',
          scripts: [{
            content: `
              const jsreport = require('jsreport-proxy')
              function afterRender(req, res, done) {
                console.log('message from script')

                jsreport.render({ template: { name: 'foo' } }).then((resp) => {
                  res.content = resp.content;
                  done();
                }).catch((e) => done(e))
              }`
          }]
        }
      }

      const response = await reporter.render(request)

      response.content.toString().should.be.eql('Hi foo')

      const logs = response.meta.logs.map((i) => i.message)

      logs.should.matchAny(/Rendering template { name: foo/)
      logs.should.matchAny(/message from script/)
      logs.should.matchAny(/using helper "sayHi"/)
    })

    it('should not be able to override context when rendering with jsreport-proxy', async () => {
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html'
      })

      const request = {
        template: {
          content: 'original',
          recipe: 'html',
          engine: 'jsrender',
          scripts: [{
            content: `
              const jsreport = require('jsreport-proxy')

              async function beforeRender (req, res) {
                req.data = req.data || {}
                req.data.some = true
                req.context.another = true
              }

              async function afterRender(req, res) {
                const resp = await jsreport.render({
                  template: { name: 'foo' },
                  context: { user: { name: 'Jan' } }
                })

                res.content = resp.content;
              }`
          }]
        },
        context: {
          user: { name: 'Boris' }
        }
      }

      let contextChangedInsideProxyRender
      let contextUserPropChangedInsideScript
      let contextAnotherPropChangedInsideScript

      reporter.afterRenderListeners.add('testing', (req, res) => {
        if (req.context.isChildRequest) {
          contextChangedInsideProxyRender = req.context.user.name !== 'Boris'
        } else {
          contextUserPropChangedInsideScript = req.context.user.name !== 'Boris'
          contextAnotherPropChangedInsideScript = req.context.another === true
        }
      })

      const response = await reporter.render(request)

      response.content.toString().should.be.eql('foo')
      contextChangedInsideProxyRender.should.be.eql(false)
      contextUserPropChangedInsideScript.should.be.eql(false)
      contextAnotherPropChangedInsideScript.should.be.eql(true)
    })

    it('should be able to require jsreport-proxy and find collection', async () => {
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html'
      })

      await reporter.documentStore.collection('templates').insert({
        name: 'hello',
        content: 'hello',
        engine: 'jsrender',
        recipe: 'html'
      })

      const request = {
        template: {
          content: 'original',
          recipe: 'html',
          engine: 'jsrender',
          scripts: [{
            content: `
              const jsreport = require('jsreport-proxy')
              function beforeRender(req, res, done) {
                jsreport.documentStore.collection('templates').find({name: 'hello'}).then((result) => {
                  req.template.content = result[0].content
                  done();
                }).catch((e) => done(e))
              }`
          }]
        }
      }
      const response = await reporter.render(request)
      response.content.toString().should.be.eql('hello')
    })

    it('should be able to require jsreport-proxy and findOne collection', async () => {
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html'
      })

      await reporter.documentStore.collection('templates').insert({
        name: 'hello',
        content: 'hello',
        engine: 'jsrender',
        recipe: 'html'
      })

      const request = {
        template: {
          content: 'original',
          recipe: 'html',
          engine: 'jsrender',
          scripts: [{
            content: `
              const jsreport = require('jsreport-proxy')
              function beforeRender(req, res, done) {
                jsreport.documentStore.collection('templates').findOne({name: 'hello'}).then((result) => {
                  req.template.content = result.content
                  done();
                }).catch((e) => done(e))
              }`
          }]
        }
      }
      const response = await reporter.render(request)
      response.content.toString().should.be.eql('hello')
    })

    it('should be able to require jsreport-proxy, find collection with parsed buffers', async () => {
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html'
      })

      await reporter.documentStore.collection('assets').insert({
        name: 'hello',
        content: Buffer.from(JSON.stringify({ a: 'foo' }))
      })

      const request = {
        template: {
          content: 'original',
          recipe: 'html',
          engine: 'jsrender',
          scripts: [{
            content: `
              const jsreport = require('jsreport-proxy')
              function beforeRender(req, res, done) {
                jsreport.documentStore.collection('assets').find({name: 'hello'}).then((result) => {
                  req.template.content = JSON.parse(result[0].content.toString()).a
                  done();
                }).catch((e) => done(e))
              }`
          }]
        }
      }
      const response = await reporter.render(request)
      response.content.toString().should.be.eql('foo')
    })

    it('should be able to require jsreport-proxy, findOne collection with parsed buffers', async () => {
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html'
      })

      await reporter.documentStore.collection('assets').insert({
        name: 'hello',
        content: Buffer.from(JSON.stringify({ a: 'foo' }))
      })

      const request = {
        template: {
          content: 'original',
          recipe: 'html',
          engine: 'jsrender',
          scripts: [{
            content: `
              const jsreport = require('jsreport-proxy')
              function beforeRender(req, res, done) {
                jsreport.documentStore.collection('assets').findOne({name: 'hello'}).then((result) => {
                  req.template.content = JSON.parse(result.content.toString()).a
                  done();
                }).catch((e) => done(e))
              }`
          }]
        }
      }
      const response = await reporter.render(request)
      response.content.toString().should.be.eql('foo')
    })

    it('should be able to catch errors inside script when using jsreport-proxy documentStore', async () => {
      const request = {
        template: {
          content: '{{:errorFromStore}}',
          recipe: 'html',
          engine: 'jsrender',
          scripts: [{
            content: `
              const jsreport = require('jsreport-proxy')

              async function beforeRender(req, res) {
                try {
                  await jsreport.documentStore.collection('unknown').find()
                } catch (err) {
                  req.data = req.data || {}
                  req.data.errorFromStore = 'catched'
                }
              }`
          }]
        }
      }
      const response = await reporter.render(request)
      response.content.toString().should.be.eql('catched')
    })

    it('callback error should be gracefully handled', async () => {
      const request = {
        template: {
          content: 'original',
          recipe: 'html',
          engine: 'jsrender',
          scripts: [{
            content: `
              const jsreport = require('jsreport-proxy')
              function afterRender(req, res, done) {
                jsreport.render({ template: {} }).then((resp) => {
                  res.content = resp.content;
                  done();
                }).catch((e) => done(e))
              }`
          }]
        }
      }
      try {
        await reporter.render(request)
        throw new Error('Should have failed.')
      } catch (e) {
        e.message.should.containEql('Template must')
      }
    })

    it('should be able to substitute template with another template using callback', async () => {
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html'
      })

      const request = {
        template: {
          content: 'original',
          recipe: 'html',
          engine: 'jsrender',
          scripts: [{
            content: `
              const jsreport = require('jsreport-proxy')
              function beforeRender(req, res, done) {
                jsreport.render({ template: { name: 'foo' } }).then((resp) => {
                  req.template.content = Buffer.from(resp.content).toString();
                  done();
                }).catch((e) => done(e))
              }`
          }]
        }
      }
      const response = await reporter.render(request)
      response.content.toString().should.be.eql('foo')
    })

    it('should monitor rendering cycles', async function () {
      this.timeout(8000)
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html',
        shortid: 'id',
        scripts: [{
          content: `
              const jsreport = require('jsreport-proxy')
              async function beforeRender(req, res) {
                const resp = await jsreport.render({ template: { name: 'foo' } })
                req.template.content = Buffer.from(resp.content).toString();
              }`
        }]
      })

      const request = {
        template: {
          shortid: 'id'
        }
      }

      try {
        await reporter.render(request)
        throw new Error('It should have failed')
      } catch (e) {
        e.message.should.containEql('cycle')
      }
    })

    it('should fail with script that tries to avoid sandbox (using global context)', async () => {
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html',
        shortid: 'id',
        scripts: [{
          content: `
              function beforeRender(req, res, done) {
                const ForeignFunction = this.constructor.constructor;
                const process1 = ForeignFunction("return process")();
                const require1 = process1.mainModule.require;
                const console1 = require1("console");
                const fs1 = require1("fs");
                console1.log(fs1.statSync('.'))
                done()
              }
          `
        }]
      })

      const request = {
        template: {
          shortid: 'id'
        }
      }

      try {
        await reporter.render(request)
        throw new Error('It should have failed')
      } catch (e) {
        e.message.should.containEql('is not defined')
      }
    })

    it('should fail with script that tries to avoid sandbox (using objects exposed in global context)', async () => {
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html',
        shortid: 'id',
        scripts: [{
          content: `
              function beforeRender(req, res, done) {
                const ForeignFunction = require.constructor
                const process1 = ForeignFunction("return process")()
                const require1 = process1.mainModule.require;
                const console1 = require1("console");
                const fs1 = require1("fs");
                console1.log(fs1.statSync('.'))
                done()
              }
          `
        }]
      })

      const request = {
        template: {
          shortid: 'id'
        }
      }

      try {
        await reporter.render(request)
        throw new Error('It should have failed')
      } catch (e) {
        e.message.should.containEql('is not defined')
      }
    })

    it('should be able to require local scripts', async () => {
      await reporter.close()
      const scriptContent = "function beforeRender(request, response, done) { request.template.content = require('helperA')(); done() }"
      reporter = Reporter({
        extensions: {
          scripts: {
            allowedModules: ['helperA']
          }
        }
      }).use(require('jsreport-templates')()).use(require('jsreport-jsrender')()).use(require('../')())

      await reporter.init()
      const res = await prepareRequest(scriptContent)
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      res.request.template.content.should.be.eql('a')
    })

    it('should be unblock modules with allowedModules = *', async () => {
      await reporter.close()

      const scriptContent = "function beforeRender(request, response, done) { request.template.content = require('helperA')(); done() }"
      reporter = Reporter({
        extensions: {
          scripts: {
            allowedModules: '*'
          }
        }
      }).use(require('jsreport-templates')()).use(require('jsreport-jsrender')()).use(require('../')())

      await reporter.init()
      const res = await prepareRequest(scriptContent)
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      res.request.template.content.should.be.eql('a')
    })

    it('should be possible to declare global request object', async () => {
      const res = await prepareRequest('var request = function () { return 5; } \n function beforeRender(req, res, done) { req.template.content = request(); done() }')
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      res.request.template.content.should.be.eql(5)
    })

    it('should fire beforeScriptListeners', async () => {
      const res = await prepareRequest('function beforeRender(req, res, done) { done() }')
      let called = false
      reporter.beforeScriptListeners.add('test', (def) => {
        def.script.should.be.ok()
        called = true
      })
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      called.should.be.true()
    })

    it('should terminate execution with endless loop after timeout', async () => {
      const res = await prepareRequest('function beforeRender(req, res, done) { while(true) { }; done() }')
      try {
        await reporter.scripts.handleBeforeRender(res.request, res.response)
        throw new Error('should have failed')
      } catch (e) {
        e.message.should.not.be.eql('should have failed')
      }
    })

    it('should support returning promise from beforeRender', async () => {
      const res = await prepareRequest("function beforeRender(req, res) { return new Promise((resolve) => { req.data = 'xxx'; resolve() }) }")
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      res.request.data.should.be.eql('xxx')
    })

    it('should support returning promise from afterRender', async () => {
      const res = await prepareRequest("function afterRender(req, res) { return new Promise((resolve) => { res.content = Buffer.from('foo'); resolve() }) }")
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      await reporter.scripts.handleAfterRender(res.request, res.response)
      res.response.content.toString().should.be.eql('foo')
    })

    it('should support resolve void result from beforeRender when no done parameter is accepted', async () => {
      const res = await prepareRequest("function beforeRender(req, res) { req.template.content = 'foo' }")
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      res.request.template.content.should.be.eql('foo')
    })

    it('should support async beforeRender', async () => {
      const res = await prepareRequest("async function beforeRender(req, res) { await new Promise((resolve) => { req.data = 'xxx'; resolve() }) }")
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      res.request.data.should.be.eql('xxx')
    })

    it('should write console.log to the logger', async () => {
      const res = await prepareRequest("function beforeRender(req, res) { console.log('foo') }")
      let logged
      reporter.logger.debug = (msg) => (logged = msg === 'foo')
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      logged.should.be.true()
    })

    it('should dump objects to logger from console.log', async () => {
      const res = await prepareRequest('function beforeRender(req, res) { console.log({a: 1}) }')
      let logged
      reporter.logger.debug = (msg) => (logged = msg === '{ a: 1 }')
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      logged.should.be.true()
    })

    it('should fail with proper Error', async () => {
      const res = await prepareRequest(`function beforeRender(req, res, done) { done(new Error('foo')) } `)
      try {
        await reporter.scripts.handleBeforeRender(res.request, res.response)
      } catch (e) {
        e.should.be.Error()
        e.message.should.be.eql('foo')
      }
    })

    it('should disallow throwing values that are not errors (promise usage)', async () => {
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html',
        shortid: 'id',
        scripts: [{
          content: `
            async function beforeRender(req, res) {
              throw 2
            }
          `
        }]
      })

      const request = {
        template: {
          shortid: 'id'
        }
      }

      try {
        await reporter.render(request)
        throw new Error('It should have failed')
      } catch (e) {
        e.message.should.containEql('Script threw with non-Error')
      }
    })

    it('should disallow throwing values that are not errors (callback usage)', async () => {
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html',
        shortid: 'id',
        scripts: [{
          content: `
            function beforeRender(req, res, done) {
              done(2)
            }
          `
        }]
      })

      const request = {
        template: {
          shortid: 'id'
        }
      }

      try {
        await reporter.render(request)
        throw new Error('It should have failed')
      } catch (e) {
        e.message.should.containEql('Script threw with non-Error')
      }
    })

    it('should not break when using different Promise implementation inside script', async () => {
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html',
        shortid: 'id',
        scripts: [{
          content: `
            const Promise = require('bluebird')

            function beforeRender(req, res) {

            }
          `
        }]
      })

      const request = {
        template: {
          shortid: 'id'
        }
      }

      await reporter.render(request)
    })
  }
})
