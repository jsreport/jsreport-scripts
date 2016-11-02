require('should')
var assert = require('assert')
var q = require('q')
var Reporter = require('jsreport-core')

describe('scripts', function () {
  var reporter
  describe('scritps with dedicated-process strategy', function () {
    beforeEach(function (done) {
      reporter = Reporter().use(require('jsreport-templates')()).use(require('jsreport-jsrender')()).use(require('../')())
      reporter.init().then(function () {
        done()
      }).fail(done)
    })

    common()
    commonSafe()
  })

  describe('scritps with http-server strategy', function () {
    beforeEach(function (done) {
      reporter = Reporter({
        tasks: { strategy: 'http-server' }
      }).use(require('jsreport-templates')()).use(require('jsreport-jsrender')()).use(require('../')())
      reporter.init().then(function () {
        done()
      }).fail(done)
    })

    common()
    commonSafe()
  })

  describe('scritps with in-process strategy', function () {
    beforeEach(function (done) {
      reporter = Reporter({
        tasks: { strategy: 'in-process' },
        scripts: {
          allowedModules: ['./helperA', 'underscore']
        }
      }).use(require('jsreport-templates')()).use(require('jsreport-jsrender')()).use(require('../')())
      reporter.init().then(function () {
        done()
      }).fail(done)
    })

    it('should be able to require local functions', function (done) {
      var req = {
        logger: reporter.logger,
        reporter: reporter,
        template: {
          scripts: [{ content: "function beforeRender(done) { request.template.content = require('./helperA')(); done(); }" }]
        }
      }

      return reporter.scripts.handleBeforeRender(req, {}).then(function (res) {
        req.template.content.should.be.eql('a')
        done()
      }).catch(done)
    })

    common()
  })

  function prepareTemplate (scriptContent) {
    return reporter.documentStore.collection('scripts').insert({ content: scriptContent }).then(function (script) {
      return reporter.documentStore.collection('templates').insert({
        content: 'foo',
        script: { shortid: script.shortid }
      })
    })
  }

  function prepareRequest (scriptContent) {
    return prepareTemplate(scriptContent).then(function (template) {
      return q({
        request: { template: template, reporter: reporter, options: {}, logger: reporter.logger },
        response: {}
      })
    })
  }

  function commonSafe () {
    it('should propagate exception from async back', function (done) {
      prepareRequest('setTimeout(function() { foo; }, 0);').then(function (res) {
        return reporter.scripts.handleBeforeRender(res.request, res.response).then(function () {
          done(new Error('no error was thrown when it should have been'))
        })
      }).catch(function (e) {
        try {
          e.message.should.containEql('foo')
        } catch (e) {
          return done(e)
        }
        done()
      })
    })
  }

  function common () {
    it('should find script by its name', function (done) {
      var req = { template: { script: { name: 'foo' } }, reporter: reporter, logger: reporter.logger }
      var res = {}

      return reporter.documentStore.collection('scripts').insert({
        content: "request.template.content = 'xxx'; done()",
        name: 'foo'
      }).then(function (script) {
        return reporter.scripts.handleBeforeRender(req, res).then(function () {
          assert.equal('xxx', req.template.content)
          done()
        })
      }).catch(done)
    })

    it('should be able to handle multiple scripts in handleBeforeRender', function (done) {
      reporter.documentStore.collection('scripts').insert({
        content: 'function beforeRender(request, response, done) { request.template.content = \'a\'; done(); }',
        shortid: 'a'
      }).then(function () {
        return reporter.documentStore.collection('scripts').insert({
          content: 'function beforeRender(request, response, done) { request.template.content += \'b\'; done(); }',
          shortid: 'b'
        })
      }).then(function () {
        var req = {
          reporter: reporter,
          logger: reporter.logger,
          template: { content: 'foo', scripts: [{ shortid: 'a' }, { shortid: 'b' }] }
        }
        return reporter.scripts.handleBeforeRender(req, {}).then(function () {
          req.template.content.should.be.eql('ab')
          done()
        })
      }).catch(done)
    })

    it('should throw only weak error when script is not found', function () {
      var req = {
        reporter: reporter,
        logger: reporter.logger,
        template: { content: 'foo', scripts: [{ shortid: 'a' }] }
      }

      return reporter.scripts.handleBeforeRender(req, {}).catch(function (e) {
        e.weak.should.be.ok
      })
    })

    it('should be able to handle multiple scripts in afterRender', function (done) {
      reporter.documentStore.collection('scripts').insert({
        content: 'function afterRender(request, response, done) { response.content = \'a\'; done(); }',
        shortid: 'a'
      }).then(function () {
        return reporter.documentStore.collection('scripts').insert({
          content: 'function afterRender(request, response, done) { response.content = new Buffer(response.content).toString() + \'b\'; done(); }',
          shortid: 'b'
        })
      }).then(function () {
        var req = {
          reporter: reporter,
          logger: reporter.logger,
          template: { engine: 'none', recipe: 'html', content: 'foo', scripts: [{ shortid: 'a' }, { shortid: 'b' }] }
        }
        return reporter.render(req, {}).then(function (res) {
          res.content.toString().should.be.eql('ab')
          done()
        })
      }).catch(done)
    })

    it('should prepend global scripts in beforeRender', function (done) {
      reporter.documentStore.collection('scripts').insert({
        content: 'function beforeRender(request, response, done) { request.template.content += \'a\'; done(); }',
        shortid: 'a'
      }).then(function () {
        return reporter.documentStore.collection('scripts').insert({
          content: 'function beforeRender(request, response, done) { request.template.content += \'b\'; done(); }',
          shortid: 'b',
          isGlobal: true
        })
      }).then(function () {
        var req = {
          reporter: reporter,
          logger: reporter.logger,
          template: { content: '', scripts: [{ shortid: 'a' }] }
        }
        return reporter.scripts.handleBeforeRender(req, {}).then(function () {
          req.template.content.should.be.eql('ba')
          done()
        })
      }).catch(done)
    })

    it('should be able to modify request.data', function (done) {
      prepareRequest("request.data = 'xxx'; done()").then(function (res) {
        return reporter.scripts.handleBeforeRender(res.request, res.response).then(function () {
          assert.equal('xxx', res.request.data)
          done()
        })
      }).catch(done)
    })

    it('should be able to modify complex request.data', function (done) {
      prepareRequest("request.data = { a: 'xxx' }; done()").then(function (res) {
        return reporter.scripts.handleBeforeRender(res.request, res.response).then(function () {
          assert.equal('xxx', res.request.data.a)
          done()
        })
      }).catch(done)
    })

    it('should be able to modify request.template.content', function (done) {
      prepareRequest("request.template.content = 'xxx'; done()").then(function (res) {
        return reporter.scripts.handleBeforeRender(res.request, res.response).then(function () {
          assert.equal('xxx', res.request.template.content)
        })
      }).fin(done)
    })

    it('should not be able to read local files', function (done) {
      var scriptContent = "var fs = require('fs'); " +
        "fs.readdir('d:\\', function(err, files) { response.filesLength = files.length; done(); });"

      prepareRequest(scriptContent)
        .then(function (res) {
          return reporter.scripts.handleBeforeRender(res.request, res.response)
        }).then(function () {
          done(new Error('no error was thrown when it should have been'))
        }).catch(function () {
          done()
        })
    })

    it('should be able to processes async function', function (done) {
      prepareRequest("setTimeout(function(){ request.template.content = 'xxx'; done(); }, 10);").then(function (res) {
        return reporter.scripts.handleBeforeRender(res.request, res.response).then(function () {
          assert.equal('xxx', res.request.template.content)
          done()
        })
      }).catch(done)
    })

    it('should be able to processes beforeRender function', function (done) {
      prepareRequest("function beforeRender(request, response, done){ request.template.content = 'xxx'; done(); }").then(function (res) {
        return reporter.scripts.handleBeforeRender(res.request, res.response).then(function () {
          assert.equal('xxx', res.request.template.content)
          done()
        })
      }).catch(done)
    })

    it('should be able to processes afterRender function', function (done) {
      prepareRequest('function afterRender(request, response, done){ response.content[0] = 1; done(); }').then(function (res) {
        return reporter.scripts.handleBeforeRender(res.request, res.response).then(function () {
          res.response.content = new Buffer([1])
          return reporter.scripts.handleAfterRender(res.request, res.response).then(function () {
            assert.equal(1, res.response.content[0])
            done()
          })
        })
      }).catch(done)
    })

    it('res.content in afterRender should be buffer', function () {
      return prepareRequest('function afterRender(req, res, done){ if (!Buffer.isBuffer(res.content)) { return done(new Error(\'not a buffer\')) } done(); }').then(function (res) {
        return reporter.scripts.handleBeforeRender(res.request, res.response).then(function () {
          res.response.content = new Buffer([1])
          return reporter.scripts.handleAfterRender(res.request, res.response)
        })
      })
    })

    it('should be able to add property to request', function (done) {
      prepareRequest("request.foo = 'xxx'; done(); ").then(function (res) {
        return reporter.scripts.handleBeforeRender(res.request, res.response).then(function () {
          assert.equal('xxx', res.request.foo)
          done()
        })
      }).catch(done)
    })

    it('should be able to cancel request', function (done) {
      prepareRequest('request.cancel();').then(function (res) {
        return reporter.scripts.handleBeforeRender(res.request, res.response).then(function () {
          done(new Error('no error was thrown when it should have been'))
        })
      }).catch(function (e) {
        e.canceled.should.be.ok
        done()
      })
    })

    it('should be abble to callback and call reporter.render', function (done) {
      reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html'
      }).then(function (tmpl) {
        var request = {
          logger: reporter.logger,
          template: {
            content: 'original',
            recipe: 'html',
            engine: 'jsrender',
            script: {
              content: "function afterRender(done) { reporter.render({ template: { shortid: '" + tmpl.shortid + "'} }, function(err, resp) { if (err) return done(err); response.content = resp.content; done(); }); };"
            }
          }
        }
        return reporter.render(request).then(function (response) {
          response.content.toString().should.be.eql('foo')
          done()
        })
      }).catch(done)
    })

    it('callback error should be gracefully handled', function (done) {
      var request = {
        logger: reporter.logger,
        template: {
          content: 'original',
          recipe: 'html',
          engine: 'jsrender',
          script: {
            content: 'function afterRender(done) { reporter.render({ }, function(err, resp) { if (err) return done(err); response.content = resp.content; done(); }); };'
          }
        }
      }
      return reporter.render(request).then(function (response) {
        done(new Error('Should have failed.'))
      }).catch(function (e) {
        e.message.should.containEql('template property must')
        done()
      })
    })

    it('should be able to substitute template with another template using callback', function (done) {
      reporter.documentStore.collection('templates').insert({
        name: 'foo',
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html'
      }).then(function (tmpl) {
        var request = {
          template: {
            logger: reporter.logger,
            content: 'original',
            recipe: 'html',
            engine: 'jsrender',
            script: {
              content: "function beforeRender(request, response, done) { reporter.render({ template: { shortid: '" + tmpl.shortid + "'} }, function(err, resp) { if (err) return done(err); " +
              'request.template.content = new Buffer(resp.content).toString(); done(); }); };'
            }
          }
        }
        return reporter.render(request).then(function (response) {
          response.content.toString().should.be.eql('foo')
          done()
        })
      }).catch(done)
    })

    it('should monitor rendering cycles', function (done) {
      this.timeout(5000)
      reporter.documentStore.collection('templates').insert({
        name: 'foo',
        logger: reporter.logger,
        content: 'foo',
        engine: 'jsrender',
        recipe: 'html',
        shortid: 'id',
        script: {
          content: "function beforeRender(request, response, done) { reporter.render({ template: { shortid: 'id'} }, function(err, resp) { if (err) return done(err); " +
          'request.template.content = new Buffer(resp.content).toString(); done(); }); };'
        }
      }).then(function (tmpl) {
        var request = {
          template: {
            shortid: 'id'
          }
        }
        return reporter.render(request).then(function (response) {
          done(new Error('It should have failed'))
        })
      }).catch(function (e) {
        e.message.should.containEql('cycle')
        done()
      })
    })

    it('should be able to require local scripts', function (done) {
      var scriptContent = "function beforeRender(request, response, done) { request.template.content = require('helperA')(); done() }"
      reporter = Reporter({
        scripts: {
          allowedModules: ['helperA']
        }
      }).use(require('jsreport-templates')()).use(require('jsreport-jsrender')()).use(require('../')())

      reporter.init().then(function () {
        return prepareRequest(scriptContent)
          .then(function (res) {
            return reporter.scripts.handleBeforeRender(res.request, res.response).then(function () {
              res.request.template.content.should.be.eql('a')
              done()
            })
          })
      }).catch(done)
    })

    it('should be unblock modules with allowedModules = *', function (done) {
      var scriptContent = "function beforeRender(request, response, done) { request.template.content = require('helperA')(); done() }"
      reporter = Reporter({
        scripts: {
          allowedModules: '*'
        }
      }).use(require('jsreport-templates')()).use(require('jsreport-jsrender')()).use(require('../')())

      reporter.init().then(function () {
        return prepareRequest(scriptContent)
          .then(function (res) {
            return reporter.scripts.handleBeforeRender(res.request, res.response).then(function () {
              res.request.template.content.should.be.eql('a')
              done()
            })
          })
      }).catch(done)
    })

    it('should ignore empty script object', function (done) {
      var req = { template: { script: {} }, reporter: reporter, logger: reporter.logger }
      var res = {}

      return reporter.scripts.handleBeforeRender(req, res).then(function () {
        done()
      }).catch(done)
    })

    it('should be back compatible with single done parameter in beforeRender function', function (done) {
      prepareRequest("function beforeRender(done) { request.template.content = 'xxx'; done()").then(function (res) {
        return reporter.scripts.handleBeforeRender(res.request, res.response).then(function () {
          assert.equal('xxx', res.request.template.content)
        })
      }).fin(done)
    })

    it('should be back compatible with single done parameter in afterRender function', function (done) {
      prepareRequest('function afterRender(done) {  response.content[0] = 1; done();').then(function (res) {
        return reporter.scripts.handleAfterRender(res.request, res.response).then(function () {
          assert.equal(1, res.response.content[0])
          done()
        })
      }).fin(done)
    })

    it('should be possible to declare global request object', function (done) {
      prepareRequest('var request = function () { return 5; } \n function beforeRender(req, res, done) { req.template.content = request(); done() }').then(function (res) {
        return reporter.scripts.handleBeforeRender(res.request, res.response).then(function () {
          res.request.template.content.should.be.eql(5)
          done()
        })
      }).catch(done)
    })

    it('should fire beforeScriptListeners', function (done) {
      prepareRequest('function beforeRender(req, res, done) { done() }').then(function (res) {
        reporter.beforeScriptListeners.add('test', function (def) {
          def.script.should.be.ok
          done()
        })
        return reporter.scripts.handleBeforeRender(res.request, res.response).then(function () {

        })
      }).catch(done)
    })
  }
})

