import React, { Component } from 'react'

export default class TemplateScriptProperties extends Component {
  selectScripts (entities) {
    return Object.keys(entities).filter((k) => entities[k].__entitySet === 'scripts' && !entities[k].isGlobal).map((k) => entities[k])
  }

  static getSelectedScripts (entity, entities) {
    const getName = (s) => {
      const foundScripts = Object.keys(entities).map((k) => entities[k]).filter((sc) => sc.shortid === s.shortid)

      return foundScripts.length ? foundScripts[0].name : ''
    }

    return (entity.scripts || []).map((s) => ({
      ...s,
      name: getName(s)
    }))
  }

  renderOrder () {
    const scripts = TemplateScriptProperties.getSelectedScripts(this.props.entity, this.props.entities)

    return <span>{scripts.map((s) => <span key={s.shortid}>{s.name + ' '}</span>)}</span>
  }

  componentDidMount () {
    this.removeInvalidScriptReferences()
  }

  componentDidUpdate () {
    this.removeInvalidScriptReferences()
  }

  static title (entity, entities) {
    if (!entity.scripts || !entity.scripts.length) {
      return 'scripts'
    }

    return 'scripts: ' + TemplateScriptProperties.getSelectedScripts(entity, entities).map((s) => s.name).join(', ')
  }

  removeInvalidScriptReferences () {
    const { entity, entities, onChange } = this.props

    if (!entity.scripts) {
      return
    }

    const updatedScripts = entity.scripts.filter((s) => Object.keys(entities).filter((k) => entities[k].__entitySet === 'scripts' && entities[k].shortid === s.shortid).length)

    if (updatedScripts.length !== entity.scripts.length) {
      onChange({ _id: entity._id, scripts: updatedScripts })
    }
  }

  render () {
    const { entity, entities, onChange } = this.props
    const scripts = this.selectScripts(entities)

    const selectValues = (event, ascripts) => {
      const el = event.target
      let scripts = Object.assign([], ascripts)

      for (var i = 0; i < el.options.length; i++) {
        if (el.options[i].selected) {
          if (!scripts.filter((s) => s.shortid === el.options[i].value).length) {
            scripts.push({ shortid: el.options[i].value })
          }
        } else {
          if (scripts.filter((s) => s.shortid === el.options[i].value).length) {
            scripts = scripts.filter((s) => s.shortid !== el.options[i].value)
          }
        }
      }

      return scripts
    }

    return (
      <div className='properties-section'>
        <div className='form-group'>
          <select
            title='Use CTRL to deselect item and also to select multiple options. The order of selected scripts is reflected on the server'
            multiple size='7' value={entity.scripts ? entity.scripts.map((s) => s.shortid) : []}
            onChange={(v) => onChange({_id: entity._id, scripts: selectValues(v, entity.scripts)})}>
            {scripts.map((s) => <option key={s.shortid} value={s.shortid}>{s.name}</option>)}
          </select>
          {(entity.scripts && entity.scripts.length) ? <div><span>Run order:</span>{this.renderOrder()}</div> : <div />}
        </div>
      </div>
    )
  }
}
