import PropTypes from 'prop-types'
import React, { Component } from 'react'
import { TextEditor } from 'jsreport-studio'

export default class ScriptEditor extends Component {
  render () {
    const { entity, onUpdate } = this.props

    return (
      <TextEditor
        name={entity._id}
        mode='javascript'
        value={entity.content}
        onUpdate={(v) => onUpdate(Object.assign({}, entity, {content: v}))}
      />
    )
  }
}

ScriptEditor.propTypes = {
  entity: PropTypes.object.isRequired,
  onUpdate: PropTypes.func.isRequired
}
