
module.exports = {
  'name': 'scripts',
  'main': 'lib/scripts.js',
  'optionsSchema': {
    extensions: {
      scripts: {
        type: 'object',
        properties: {
          timeout: { type: 'number' },
          allowedModules: {
            anyOf: [{
              type: 'string',
              '$jsreport-constantOrArray': ['*']
            }, {
              type: 'array',
              items: { type: 'string' }
            }]
          }
        }
      }
    }
  },
  'dependencies': ['templates', 'data'],
  'embeddedSupport': true
}
