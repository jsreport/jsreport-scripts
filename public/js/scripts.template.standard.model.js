define(['app', 'jquery', 'core/basicModel', 'underscore'], function (app, $, ModelBase, _) {
  return ModelBase.extend({

    fetchStandard: function (options) {
      var self = this

      var scripts = self.templateModel.get('scripts')

      if (!scripts) {
        var script = self.templateModel.get('script')

        if (self.templateModel.get('scriptId')) {
          script = {shortid: self.templateModel.get('scriptId')}
        }

        if (script) {
          scripts = [script]
        }
      }

      scripts = scripts || []

      this.templateModel.set('scripts', scripts, {silent: true})

      scripts = scripts.map(function (s) {
        return s.shortid
      })

      this.set('scripts', scripts, {silent: true})

      self.orderedScripts = {}

      return app.dataProvider.get('odata/scripts').then(function (items) {
        self.items = items

        self.items.forEach(function (s) {
          self.orderedScripts[s.shortid] = s
          self.orderedScripts[s.shortid].order = scripts.indexOf(s.shortid)
        })
        options.success()
      })
    },

    fetchEmbed: function (options) {
      var self = this

      function processItems (items) {
        self.items = items

        var script = self.templateModel.get('script')

        if (!script) {
          script = {}

          // back compatibility
          if (self.templateModel.get('scriptId')) {
            script.shortid = self.templateModel.get('scriptId')
          }

          self.templateModel.set('script', script, {silent: true})
        }

        var custom
        if (app.options.scripts.allowCustom) {
          custom = {name: '- custom -', shortid: 'custom', content: script.content}
          self.items.unshift(custom)
        }

        var empty = {name: '- not selected -', shortid: null}
        self.items.unshift(empty)

        if (!script.content && !script.shortid) {
          self.set(custom || empty, {silent: true})
        }

        if (script.shortid) {
          self.set(_.findWhere(items, {shortid: script.shortid}), {silent: true})
        }

        if (script.content) {
          self.set(custom || empty, {silent: true})
        }

        return options.success()
      }

      if (app.options.scripts.allowSelection) {
        return app.dataProvider.get('odata/scripts').then(processItems)
      } else {
        processItems([])
      }
    },

    fetch: function (options) {
      if (app.options.studio !== 'embed') {
        this.fetchStandard(options)
      } else {
        this.fetchEmbed(options)
      }
    },

    setTemplate: function (templateModel) {
      this.templateModel = templateModel
      this.listenTo(templateModel, 'api-overrides', this.apiOverride)
    },

    apiOverride: function (req) {
      req.template.script = {shortid: this.get('shortid') || '...', content: '....'}
    },

    newCustomScript: function () {

    },

    initialize: function () {
      var self = this

      if (app.options.studio !== 'embed') {
        this.listenTo(this, 'change', function () {
          var scripts = self.get('scripts') || []
          scripts = scripts.map(function (s) {
            return $.extend({}, self.orderedScripts[s])
          })
          scripts.sort(function (a, b) {
            return a.order - b.order
          })
          scripts = scripts.map(function (s) {
            return {shortid: s.shortid}
          })
          self.templateModel.set('scripts', scripts)
        })
      } else {
        this.listenTo(this, 'change:shortid', function () {
          self.templateModel.get('script').shortid = self.get('shortid') !== 'custom' ? self.get('shortid') : undefined
          self.templateModel.get('script').content = self.get('shortid') === 'custom' ? self.get('content') : undefined
          self.set(_.findWhere(self.items, {shortid: self.get('shortid')}))
        })

        this.listenTo(this, 'change:content', function () {
          if (self.get('shortid') === 'custom') {
            self.templateModel.get('script').content = self.get('content')
            _.findWhere(self.items, {shortid: 'custom'}).content = self.get('content')
          }
        })
      }
    }
  })
})
