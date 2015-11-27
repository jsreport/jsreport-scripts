define(['app', 'underscore', 'marionette', 'core/view.base', 'core/utils'], function (app, _, Marionette, ViewBase, Utils) {
  return ViewBase.extend({
    tagName: 'li',
    template: 'scripts-template-standard',

    initialize: function () {
      _.bindAll(this, 'isFilled', 'getItems', 'getItemsLength')
    },

    isFilled: function () {
      return this.model.get('scripts').length > 0
    },

    getItems: function () {
      return this.model.items
    },

    getItemsLength: function () {
      return this.model.items.length
    },

    onClose: function () {
      this.model.templateModel.unbind('api-overrides', this.model.apiOverride, this.model)
    },

    onDomRefresh: function () {
      var orderCount = 0
      var self = this

      var multiselect = this.$el.find('#scripts').multiselect({
        onChange: function (option, checked) {
          var script = self.model.orderedScripts[option[0].value]
          if (checked) {
            orderCount++
          }
          script.order = checked ? orderCount : null
          multiselect.multiselect('updateButtonText')
          self.model.trigger('change')
        },
        buttonText: function (options) {
          if (options.length === 0) {
            return 'None selected'
          } else {
            if (options.length > 4) {
              return options.length + ' selected'
            }
          }

          var selected = []
          options.each(function (i, o) {
            selected.push([self.model.orderedScripts[o.value].name, self.model.orderedScripts[o.value].order])
          })

          selected.sort(function (a, b) {
            return a[1] - b[1]
          })

          var text = ''
          for (var i = 0; i < selected.length; i++) {
            text += selected[i][0] + ', '
          }

          return text.substr(0, text.length - 2)
        }
      })
    }
  })
})
