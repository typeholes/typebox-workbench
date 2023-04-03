import { TypeScriptToJsonSchema, TypeScriptToTypeBox } from '../codegen/index.mjs'
import { Monaco } from '../monaco/index.mjs'
import { Storage } from '../storage/index.mjs'
import { Debounce } from '../async/index.mjs'
import { Share } from '../share/index.mjs'
import * as Layouts from '../layout/index.js'
import * as monaco from 'monaco-editor'

import * as React from 'react'

export interface EditorProperties {
  code?: string
}

export function Editor(props: EditorProperties) {
  const [state, setState] = React.useState(Storage.getTransformTargetType())
  const { current: debounce } = React.useRef(new Debounce(500, true))
  const sourceEditor = React.useRef<null | monaco.editor.IStandaloneCodeEditor>(null)
  const targetEditor = React.useRef<null | monaco.editor.IStandaloneCodeEditor>(null)
  const sourceEditorRef = React.useRef(null)
  const targetEditorRef = React.useRef(null)
  React.useEffect(() => {
    setupEditors()
    return () => disposeEditors()
  }, [])
  function setupEditors() {
    setupSourceEditor()
    setupTargetEditor()
    transformCode()
  }
  function disposeEditors() {
    disposeSourceEditor()
    disposeTargetEditor()
  }
  function setupSourceEditor() {
    if (sourceEditorRef.current === null) return
    const code = props.code || Storage.getTransformSourceCode()
    const editor = Monaco.create(sourceEditorRef.current, code, (content) => {
      Share.set(content)
      Storage.setTransformSourceCode(content)
      transformCode()
    })
    editor.onKeyUp(() => debounce.run(() => transformCode()))
    sourceEditor.current = editor
  }
  function setupTargetEditor() {
    if (targetEditorRef.current === null) return
    const editor = Monaco.create(targetEditorRef.current, '')
    targetEditor.current = editor
  }
  function disposeSourceEditor() {
    if (sourceEditor.current === null) return
    sourceEditor.current.dispose()
  }
  function disposeTargetEditor() {
    if (targetEditor.current === null) return
    targetEditor.current.dispose()
  }
  function transformCode() {
    if (sourceEditor.current === null || targetEditor.current === null) return
    Storage.setTransformSourceCode(sourceEditor.current.getValue())
    const transform = Storage.getTransformTargetType() === 'jsonschema' ? TypeScriptToJsonSchema.Generate(Storage.getTransformSourceCode()) : TypeScriptToTypeBox.Generate(Storage.getTransformSourceCode())
    targetEditor.current.setValue(transform)
  }
  function onTypeBoxTransform() {
    Storage.setTransformTargetType('typebox')
    transformCode()
    setState('typebox')
  }
  function onJsonSchemaTransform() {
    Storage.setTransformTargetType('jsonschema')
    transformCode()
    setState('jsonschema')
  }
  const typeboxControlClassName = state === 'typebox' ? 'control selected' : 'control'
  const jsonschemaControlClassName = state === 'jsonschema' ? 'control selected' : 'control'
  return (
    <div className="editor">
      <Layouts.Splitter id="editor-seperator">
        <div className="source-container">
          <div ref={sourceEditorRef} className="source-editor"></div>
        </div>
        <div className="target-container">
          <div className="target-controls">
            <div className={typeboxControlClassName} title="TypeBox Transform" onClick={onTypeBoxTransform}></div>
            <div className={jsonschemaControlClassName} title="JSON Schema Transform" onClick={onJsonSchemaTransform}></div>
          </div>
          <div ref={targetEditorRef} className="target-editor"></div>
        </div>
      </Layouts.Splitter>
    </div>
  )
}
