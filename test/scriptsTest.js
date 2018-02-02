require('should')
const Reporter = require('jsreport-core')
const createRequest = require('jsreport-core/lib/render/request')

describe('scripts', () => {
  let reporter

  afterEach(() => reporter.close())

  describe('scritps with dedicated-process strategy', () => {
    beforeEach(() => {
      reporter = Reporter()
        .use(require('jsreport-templates')())
        .use(require('jsreport-jsrender')())
        .use(require('../')({ timeout: 2000 }))
      return reporter.init()
    })

    common()
    commonSafe()
  })

  describe('scritps with http-server strategy', () => {
    beforeEach(() => {
      reporter = Reporter({
        tasks: { strategy: 'http-server' }
      }).use(require('jsreport-templates')())
        .use(require('jsreport-jsrender')())
        .use(require('../')({ timeout: 2000 }))
      return reporter.init()
    })

    common()
    commonSafe()
  })

  describe('scritps with in-process strategy', () => {
    beforeEach(() => {
      reporter = Reporter({
        tasks: { strategy: 'in-process' },
        scripts: {
          allowedModules: ['./helperA', 'underscore'],
          timeout: 2000
        }
      }).use(require('jsreport-templates')())
        .use(require('jsreport-jsrender')())
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
    const script = await reporter.documentStore.collection('scripts').insert({ content: scriptContent })
    return reporter.documentStore.collection('templates').insert({
      content: 'foo',
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
        content: 'function beforeRender(request, response, done) { request.template.content = \'a\'; done(); }',
        shortid: 'a'
      })
      await reporter.documentStore.collection('scripts').insert({
        content: 'function beforeRender(request, response, done) { request.template.content += \'b\'; done(); }',
        shortid: 'b'
      })
      await reporter.documentStore.collection('scripts').insert({
        content: 'function beforeRender(request, response, done) { request.template.content += \'c\'; done(); }',
        shortid: 'c'
      })
      await reporter.documentStore.collection('scripts').insert({
        content: 'function beforeRender(request, response, done) { request.template.content += \'d\'; done(); }',
        shortid: 'd'
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
        content: 'function afterRender(request, response, done) { response.content = \'a\'; done(); }',
        shortid: 'a'
      })
      await reporter.documentStore.collection('scripts').insert({
        content: 'function afterRender(request, response, done) { response.content = Buffer.from(response.content).toString() + \'b\'; done(); }',
        shortid: 'b'
      })
      await reporter.documentStore.collection('scripts').insert({
        content: 'function afterRender(request, response, done) { response.content = Buffer.from(response.content).toString() + \'c\'; done(); }',
        shortid: 'c'
      })
      await reporter.documentStore.collection('scripts').insert({
        content: 'function afterRender(request, response, done) { response.content = Buffer.from(response.content).toString() + \'d\'; done(); }',
        shortid: 'd'
      })

      const req = createRequest({
        template: { engine: 'none', recipe: 'html', content: 'foo', scripts: [{ shortid: 'a' }, { shortid: 'b' }, { shortid: 'c' }, { shortid: 'd' }] }
      })
      const res = await reporter.render(req, {})
      res.content.toString().should.be.eql('abcd')
    })

    it('should prepend global scripts in beforeRender', async () => {
      await reporter.documentStore.collection('scripts').insert({
        content: 'function beforeRender(request, response, done) { request.template.content += \'a\'; done(); }',
        shortid: 'a'
      })
      await reporter.documentStore.collection('scripts').insert({
        content: 'function beforeRender(request, response, done) { request.template.content += \'b\'; done(); }',
        shortid: 'b',
        isGlobal: true
      })

      const req = createRequest({
        template: { content: '', scripts: [{ shortid: 'a' }] }
      })
      await reporter.scripts.handleBeforeRender(req, {})
      req.template.content.should.be.eql('ba')
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
      const res = await prepareRequest(`function beforeRender(req, res, done) { req.foo = 'xxx'; done(); } `)
      await reporter.scripts.handleBeforeRender(res.request, res.response)
      res.request.foo.should.be.eql('xxx')
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

    it('should be able to require jsreport-proxy and query collection', async () => {
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
      this.timeout(5000)
      await reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html',
        shortid: 'id',
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

    it('should be able to require local scripts', async () => {
      await reporter.close()
      const scriptContent = "function beforeRender(request, response, done) { request.template.content = require('helperA')(); done() }"
      reporter = Reporter({
        scripts: {
          allowedModules: ['helperA']
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
        scripts: {
          allowedModules: '*'
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
  }
})
