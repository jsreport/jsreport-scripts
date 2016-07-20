import ScriptEditor from './ScriptEditor.js'
import Properties from './ScriptProperties.js'
import Studio from 'jsreport-studio'

Studio.addEntitySet({ name: 'scripts', faIcon: 'fa-cogs', visibleName: 'script', helpUrl: 'http://jsreport.net/learn/scripts' })
Studio.addPropertiesComponent(Properties.title, Properties, (entity) => entity.__entitySet === 'templates')

Studio.addEditorComponent('scripts', ScriptEditor, (reformatter, entity) => ({ content: reformatter(entity.content, 'js') }))

Studio.addApiSpec({
  template: {
    scripts: [{
      shortid: '...',
      content: 'function beforeRender...'
    }]
  }
})

Studio.previewListeners.push((request, entities) => {
  if (!request.template.scripts) {
    return
  }

  request.template.scripts = request.template.scripts.map((s) => {
    const script = Studio.getEntityByShortid(s.shortid, false)

    if (!script) {
      return s
    }

    return script
  }).filter((s) => !s.__isNew || s.content)
})
