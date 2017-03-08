import React, { Component } from 'react'
import { TextEditor } from 'jsreport-studio'

export default class ScriptEditor extends Component {
  static propTypes = {
    entity: React.PropTypes.object.isRequired,
    onUpdate: React.PropTypes.func.isRequired
  }

  render () {
    const { entity, onUpdate } = this.props

    return (<TextEditor
      name={entity._id}
      mode='javascript'
      value={entity.content}
      onUpdate={(v) => onUpdate(Object.assign({}, entity, {content: v}))}
      />)
  }
}
