import './index.css'

import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import { Share } from './share/index.mjs'
import { Editor } from './editor/index'

const code = Share.get()

export function App() {
  return (
    <div className="app">
      <div className="header">
        <h2>TypeBox Workbench</h2>
        <p>Transform TypeScript Types to TypeBox or JSON Schema</p>
      </div>
      <div className="body">
        <Editor code={code} />
      </div>
      <div className="footer">
        <p>sinclair 2023</p>
      </div>
    </div>
  )
}

const root = ReactDOM.createRoot(document.getElementById('container')!)
root.render(<App />)
